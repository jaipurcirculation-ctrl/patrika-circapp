'use strict';

/**
 * Patrika Vitran Suite — REST API server (Node.js / Express)
 * Port of server.py (FastAPI + psycopg2) to Express + pg
 */

const express = require('express');
const cors = require('cors');
const pg = require('pg');
const { Pool } = pg;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ── Configuration (from .env) ─────────────────────────────────────────────────
const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'patrika_vitran',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:8123').split(',');

const API_PORT = parseInt(process.env.API_PORT || '8000', 10);

// ── pg type parsers ───────────────────────────────────────────────────────────
pg.types.setTypeParser(1700, parseFloat); // NUMERIC → float
pg.types.setTypeParser(20, Number);        // BIGINT  → number

const pool = new Pool(DB_CONFIG);

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Look up user id from mobile number.
 * `runner` is either the pool or a pg PoolClient so this works inside
 * both plain reads and transactions.
 */
async function userIdFromMobile(runner, mobile) {
  if (!mobile) return null;
  const { rows } = await runner.query(
    'SELECT id FROM users WHERE mobile = $1',
    [mobile]
  );
  return rows.length ? rows[0].id : null;
}

/** Two-letter avatar from full name */
function _avatar(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '??';
}

/**
 * Convert a pg result row so dates become ISO strings.
 * NUMERIC and BIGINT are already handled by the type parsers above;
 * this cleans up any remaining Date objects from timestamp columns.
 */
function _clean(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

/** Haversine distance in km between two lat/lon points */
function _haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371.0;
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(parseFloat(lat1));
  const p2 = toRad(parseFloat(lat2));
  const dp = toRad(parseFloat(lat2) - parseFloat(lat1));
  const dl = toRad(parseFloat(lon2) - parseFloat(lon1));
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 100) / 100;
}

// ── RBAC metadata ─────────────────────────────────────────────────────────────
const LEVEL_META = {
  1:  { roleLabel: 'Admin — Board View',   role: 'admin',            dashboard: true,  modules: ['agent','hawker','dcr','survey','taxi'] },
  2:  { roleLabel: 'Edition Incharge',     role: 'edition_incharge', dashboard: true,  modules: ['agent','dcr','survey'] },
  3:  { roleLabel: 'Circulation Incharge', role: 'circ_incharge',    dashboard: true,  modules: ['agent','dcr'] },
  4:  { roleLabel: 'Zonal Head',           role: 'zonal_head',       dashboard: true,  modules: ['agent','dcr','survey'] },
  5:  { roleLabel: 'VP Circulation',       role: 'vp',               dashboard: true,  modules: ['agent','dcr','survey','taxi'] },
  7:  { roleLabel: 'Field Executive',      role: 'executive',        dashboard: false, modules: ['dcr','survey'] },
  9:  { roleLabel: 'Newspaper Agent',      role: 'agent',            dashboard: false, modules: ['agent'] },
  10: { roleLabel: 'Hawker',               role: 'hawker',           dashboard: false, modules: ['hawker'] },
};

/** Map hierarchy level → column name in hierarchy_mapping */
const LEVEL_COL = {
  5: 'vp_circulation_code',
  4: 'zonal_head_code',
  3: 'circ_incharge_code',
  2: 'edtn_incharge_code',
};

/**
 * Return the list of unit_codes visible to this user, or null for admin (all).
 * Returns an empty array if no matching units are found.
 */
async function getScopeUnitCodes(personCode, hierarchyLevel) {
  if (hierarchyLevel === 1 || !personCode) return null;

  const col = LEVEL_COL[hierarchyLevel];
  if (col) {
    const { rows } = await pool.query(
      `SELECT DISTINCT unit_code FROM hierarchy_mapping WHERE ${col} = $1`,
      [String(personCode)]
    );
    return rows.map((r) => r.unit_code);
  }

  // For levels 7, 9, 10 and any other non-mapped level: look up own unit
  const { rows } = await pool.query(
    'SELECT unit_code FROM hierarchy_master WHERE person_code = $1 AND is_active = TRUE',
    [String(personCode)]
  );
  const row = rows[0];
  return row && row.unit_code ? [row.unit_code] : [];
}

/**
 * Translate unit_codes into taxi unit names used in taxi_delay_log /
 * taxi_drop_point_log tables.
 */
async function scopeToTaxiNames(unitCodes) {
  if (!unitCodes || unitCodes.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT tdl.unit_name
     FROM taxi_delay_log tdl
     JOIN units u ON (tdl.unit_name = u.unit_name OR tdl.unit_name = u.unit_name || ' RP')
     WHERE u.unit_code = ANY($1)`,
    [unitCodes]
  );
  return rows.map((r) => r.unit_name);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/health
app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
    res.json({ status: 'ok', users: Number(rows[0].n) });
  } catch (e) {
    res.status(503).json({ status: 'db_error', detail: String(e) });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const mobile = String(req.body.mobile || '').trim().replace(/\s/g, '');
    const { password } = req.body;
    const { rows } = await pool.query(
      `SELECT id, mobile, name, role, district FROM users
       WHERE mobile = $1 AND password = $2 AND is_active = TRUE`,
      [mobile, password]
    );
    if (!rows.length) {
      return res.status(401).json({ detail: 'Invalid mobile number or password' });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/customers
app.get('/api/customers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM customers ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/customers
app.post('/api/customers', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { name, address, phone, plan } = req.body;
    const { rows } = await client.query(
      `INSERT INTO customers (name, address, mobile, edition, copies, agent_id)
       VALUES ($1, $2, $3, $4, 1, $5) RETURNING id`,
      [name, address, phone, plan, uid]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Customer created ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/stops
app.get('/api/stops', async (req, res) => {
  try {
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(pool, mobile);
    if (!uid) return res.json([]);
    const { rows } = await pool.query(
      'SELECT * FROM stops WHERE hawker_id = $1 AND trip_date = CURRENT_DATE ORDER BY id',
      [uid]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/stops/:stop_id/mark
app.post('/api/stops/:stop_id/mark', async (req, res) => {
  try {
    const stopId = parseInt(req.params.stop_id, 10);
    const { status } = req.body;
    await pool.query(
      'UPDATE stops SET status = $1, marked_at = NOW() WHERE id = $2',
      [status, stopId]
    );
    res.json({ message: 'Stop updated ✓' });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/payments
app.get('/api/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM payments ORDER BY collected_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/payments
app.post('/api/payments', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { customer_name, amount, method, notes = '' } = req.body;
    const { rows } = await client.query(
      `INSERT INTO payments (amount, collected_by, method, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [amount, uid, method, `${customer_name} · ${notes}`]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Payment recorded ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/complaints
app.get('/api/complaints', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM complaints ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/complaints
app.post('/api/complaints', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { customer_name, complaint_type, route, priority, description = '' } = req.body;
    const fullDesc = `Customer: ${customer_name} | Route: ${route} | Priority: ${priority} | ${description}`;
    const { rows } = await client.query(
      `INSERT INTO complaints (type, description, raised_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [complaint_type, fullDesc, uid]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Complaint logged ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/visits
app.get('/api/visits', async (req, res) => {
  try {
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(pool, mobile);
    if (!uid) return res.json([]);
    const { rows } = await pool.query(
      `SELECT * FROM dcr_visits
       WHERE dcr_id = $1 AND visit_date = CURRENT_DATE
       ORDER BY created_at DESC`,
      [uid]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/visits
app.post('/api/visits', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { visit_type, target, outcome, amount = 0, notes = '' } = req.body;
    let note = outcome;
    if (amount) note += ` · collected ₹${amount}`;
    if (notes) note += ` · ${notes}`;
    const { rows } = await client.query(
      `INSERT INTO dcr_visits (dcr_id, outlet_name, purpose, outcome)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [uid, target, visit_type, note]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Visit saved ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/leads
app.get('/api/leads', async (req, res) => {
  try {
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(pool, mobile);
    if (!uid) return res.json([]);
    const { rows } = await pool.query(
      'SELECT * FROM leads WHERE surveyor_id = $1 ORDER BY created_at DESC',
      [uid]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/leads
app.post('/api/leads', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { name, mobile: leadMobile, area, publication, interest, notes = '' } = req.body;
    const interestLevel = interest.startsWith('High')
      ? 'hot'
      : interest.startsWith('Low')
      ? 'cold'
      : 'medium';
    const { rows } = await client.query(
      `INSERT INTO leads (surveyor_id, name, mobile, address, edition, interest)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [uid, name, leadMobile, area, publication, interestLevel]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Lead saved ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/trips
app.get('/api/trips', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM trips
       WHERE trip_date = CURRENT_DATE
       ORDER BY created_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/trips
app.post('/api/trips', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mobile = req.headers['x-user-mobile'];
    const uid = await userIdFromMobile(client, mobile);
    const { vehicle_no, route, bundles = 0 } = req.body;
    const { rows } = await client.query(
      `INSERT INTO trips (driver_id, vehicle_no, route, bundles)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [uid, vehicle_no, route, bundles]
    );
    await client.query('COMMIT');
    res.json({ id: rows[0].id, message: 'Trip logged ✓' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ detail: String(e) });
  } finally {
    client.release();
  }
});

// GET /api/hierarchy/users
app.get('/api/hierarchy/users', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT hm.id, hm.person_code, hm.person_name, hm.hierarchy_level,
             hm.unit_code, COALESCE(u.unit_name, hm.unit_code) AS unit_name,
             hm.reporting_to, hm.employee_code
      FROM hierarchy_master hm
      LEFT JOIN units u ON u.unit_code = hm.unit_code
      WHERE hm.is_active = TRUE
      ORDER BY hm.hierarchy_level, hm.person_name
    `);
    const users = rows.map((r) => {
      const lvl = r.hierarchy_level;
      const meta = LEVEL_META[lvl] || {
        roleLabel: `Level ${lvl}`,
        role: 'user',
        dashboard: false,
        modules: [],
      };
      const unitLabel = r.unit_name || r.unit_code || '';
      return {
        id: r.id,
        person_code: r.person_code,
        name: r.person_name,
        hierarchyLevel: lvl,
        unit_code: r.unit_code,
        scopeLabel: unitLabel,
        roleLabel: meta.roleLabel,
        role: meta.role,
        dashboard: meta.dashboard,
        modules: meta.modules,
        avatar: _avatar(r.person_name),
        employee_code: r.employee_code,
        reporting_to: r.reporting_to,
      };
    });
    res.json({ users, total: users.length });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// ── Date-range helpers ────────────────────────────────────────────────────────

/**
 * Resolve ?from=&to= (range) or ?date= (single day) query params.
 * Returns { from, to } or null when neither is provided (caller falls back
 * to the latest date in its table).
 */
function resolveRange(query) {
  const ok = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const { date, from, to } = query;
  if (ok(from) && ok(to)) {
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (ok(from)) return { from, to: from };
  if (ok(date)) return { from: date, to: date };
  return null;
}

/** Human label for a range: single date or "from to to". */
function rangeLabel(r) {
  return r.from === r.to ? r.from : `${r.from} to ${r.to}`;
}

// ── Dashboard: Delivery ───────────────────────────────────────────────────────

// GET /api/dashboard/delivery
app.get('/api/dashboard/delivery', async (req, res) => {
  try {
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM taxi_delay_log"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : new Date().toISOString().slice(0, 10);
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    const taxiNames = unitCodes === null ? null : await scopeToTaxiNames(unitCodes);

    if (taxiNames !== null && taxiNames.length === 0) {
      return res.json({
        date, from: range.from, to: range.to,
        summary: {
          total_routes: 0, total_supply: 0, on_time: 0, delayed: 0,
          otd_pct: 0, planned_km: 0, actual_km: 0, delivered_drops: 0,
          active_routes: 0, planned_drops: 0, missed_drops: 0,
        },
        units: [],
      });
    }

    // ── Summary query ──
    const summaryParams = [range.from, range.to];
    let scopeFilter = '';
    if (taxiNames !== null) {
      summaryParams.push(taxiNames);
      scopeFilter = `AND unit_name = ANY($${summaryParams.length})`;
    }
    const { rows: [summaryRow] } = await pool.query(`
      SELECT COUNT(*) AS total_routes,
        COALESCE(SUM(supply), 0)::float AS total_supply,
        COALESCE(SUM(CASE WHEN taxi_delayed <= interval '0' THEN 1 ELSE 0 END), 0) AS on_time,
        COALESCE(SUM(CASE WHEN taxi_delayed  > interval '0' THEN 1 ELSE 0 END), 0) AS delayed,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN taxi_delayed <= interval '0' THEN 1 ELSE 0 END)::numeric
          / NULLIF(COUNT(*),0), 1), 0)::float AS otd_pct,
        COALESCE(SUM(route_master_km), 0)::float AS planned_km,
        COALESCE(SUM(total_app_km), 0)::float AS actual_km
      FROM taxi_delay_log WHERE report_date BETWEEN $1 AND $2 ${scopeFilter}
    `, summaryParams);

    // ── Delivered drops + active routes ──
    const dropsParams = [range.from, range.to];
    let dropsScopeFilter = '';
    if (taxiNames !== null) {
      dropsParams.push(taxiNames);
      dropsScopeFilter = `AND unit_name = ANY($${dropsParams.length})`;
    }
    const { rows: [dropsRow] } = await pool.query(`
      SELECT COUNT(*) AS delivered_drops,
             COUNT(DISTINCT route_code) AS active_routes
      FROM taxi_drop_point_log WHERE sup_date BETWEEN $1 AND $2 ${dropsScopeFilter}
    `, dropsParams);

    // ── Planned drops ──
    const plannedParams = [range.from, range.to];
    let plannedScopeFilter = '';
    if (taxiNames !== null) {
      plannedParams.push(taxiNames);
      plannedScopeFilter = `AND unit_name = ANY($${plannedParams.length})`;
    }
    const { rows: [plannedRow] } = await pool.query(`
      SELECT COUNT(*) AS planned_drops
      FROM drop_points_master
      WHERE route_code IN (
        SELECT DISTINCT route_code
        FROM taxi_drop_point_log
        WHERE sup_date BETWEEN $1 AND $2 ${plannedScopeFilter}
      )
    `, plannedParams);

    // ── Per-unit breakdown ──
    // The inner subquery (taxi_drop_point_log) and the outer WHERE (taxi_delay_log)
    // each need their own date-range + optional scope param, so params differ by case.
    let unitsRows;
    if (taxiNames !== null) {
      // params: $1,$2=range(inner), $3=taxiNames(inner), $4,$5=range(outer), $6=taxiNames(outer)
      const { rows } = await pool.query(`
        SELECT d.unit_name,
          COUNT(*) AS routes,
          COALESCE(SUM(d.supply), 0)::float AS supply,
          SUM(CASE WHEN d.taxi_delayed <= interval '0' THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE WHEN d.taxi_delayed  > interval '0' THEN 1 ELSE 0 END) AS delayed,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN d.taxi_delayed <= interval '0' THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(*),0), 1), 0)::float AS otd_pct,
          COALESCE(SUM(d.total_app_km), 0)::float AS actual_km,
          COALESCE(dp_agg.delivered_drops, 0) AS delivered_drops
        FROM taxi_delay_log d
        LEFT JOIN (
          SELECT unit_name, COUNT(*) AS delivered_drops
          FROM taxi_drop_point_log
          WHERE sup_date BETWEEN $1 AND $2 AND unit_name = ANY($3)
          GROUP BY unit_name
        ) dp_agg ON dp_agg.unit_name = d.unit_name
        WHERE d.report_date BETWEEN $4 AND $5 AND d.unit_name = ANY($6)
        GROUP BY d.unit_name, dp_agg.delivered_drops
        ORDER BY delayed DESC, d.unit_name
      `, [range.from, range.to, taxiNames, range.from, range.to, taxiNames]);
      unitsRows = rows;
    } else {
      // Admin: no scope filter; params: $1,$2=range(inner), $3,$4=range(outer)
      const { rows } = await pool.query(`
        SELECT d.unit_name,
          COUNT(*) AS routes,
          COALESCE(SUM(d.supply), 0)::float AS supply,
          SUM(CASE WHEN d.taxi_delayed <= interval '0' THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE WHEN d.taxi_delayed  > interval '0' THEN 1 ELSE 0 END) AS delayed,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN d.taxi_delayed <= interval '0' THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(*),0), 1), 0)::float AS otd_pct,
          COALESCE(SUM(d.total_app_km), 0)::float AS actual_km,
          COALESCE(dp_agg.delivered_drops, 0) AS delivered_drops
        FROM taxi_delay_log d
        LEFT JOIN (
          SELECT unit_name, COUNT(*) AS delivered_drops
          FROM taxi_drop_point_log
          WHERE sup_date BETWEEN $1 AND $2
          GROUP BY unit_name
        ) dp_agg ON dp_agg.unit_name = d.unit_name
        WHERE d.report_date BETWEEN $3 AND $4
        GROUP BY d.unit_name, dp_agg.delivered_drops
        ORDER BY delayed DESC, d.unit_name
      `, [range.from, range.to, range.from, range.to]);
      unitsRows = rows;
    }

    const summary = _clean(summaryRow) || {};
    const drops = _clean(dropsRow) || {};
    const planned = _clean(plannedRow) || {};
    const missed = Math.max(
      0,
      parseInt(planned.planned_drops || 0) - parseInt(drops.delivered_drops || 0)
    );

    res.json({
      date, from: range.from, to: range.to,
      summary: { ...summary, ...drops, ...planned, missed_drops: missed },
      units: unitsRows.map(_clean),
    });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/dashboard/routes
app.get('/api/dashboard/routes', async (req, res) => {
  try {
    let { unit_name } = req.query;
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM taxi_delay_log"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null) {
      const taxiNames = await scopeToTaxiNames(unitCodes);
      if (!taxiNames.length || !taxiNames.includes(unit_name)) {
        return res.json({ date, unit_name, routes: [] });
      }
    }

    const { rows } = await pool.query(`
      SELECT report_date::text AS report_date,
             route_name, sub_route_name, taxi_type, bundles, supply, vehicle_no, is_regular,
             scheduled_departure::text, actual_departure::text,
             ROUND(EXTRACT(EPOCH FROM COALESCE(taxi_delayed, interval '0'))/60, 0)::float AS delay_minutes,
             COALESCE(route_master_km, 0)::float AS planned_km,
             COALESCE(total_app_km, 0)::float AS actual_km,
             (taxi_delayed > interval '0') AS is_delayed
      FROM taxi_delay_log
      WHERE report_date BETWEEN $1 AND $2 AND unit_name = $3
      ORDER BY report_date DESC, is_delayed DESC, route_name
    `, [range.from, range.to, unit_name]);

    res.json({ date, from: range.from, to: range.to, unit_name, routes: rows.map(_clean) });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/dashboard/drop-points
app.get('/api/dashboard/drop-points', async (req, res) => {
  try {
    let { route_code } = req.query;
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(sup_date)::text AS max FROM taxi_drop_point_log"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const routeName = route_code;

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null) {
      const taxiNames = await scopeToTaxiNames(unitCodes);
      const { rows: rrows } = await pool.query(
        'SELECT unit_name FROM taxi_delay_log WHERE route_name = $1 LIMIT 1',
        [routeName]
      );
      if (rrows.length && !taxiNames.includes(rrows[0].unit_name)) {
        return res.json({
          date, route_name: routeName,
          delivered_count: 0, missed_count: 0, drop_points: [],
        });
      }
    }

    const { rows } = await pool.query(`
      SELECT sup_date::text AS sup_date, drop_point_name,
             scheduled_arrival::text, actual_arrival::text,
             ROUND(EXTRACT(EPOCH FROM COALESCE(time_diff, interval '0'))/60, 0)::float AS diff_minutes,
             actual_lat::float, actual_long::float,
             CASE WHEN actual_lat IS NOT NULL AND actual_long IS NOT NULL
                  THEN 'delivered' ELSE 'missed' END AS status
      FROM taxi_drop_point_log
      WHERE sup_date BETWEEN $1 AND $2 AND route_name = $3
      ORDER BY sup_date DESC, actual_arrival NULLS LAST, scheduled_arrival NULLS LAST
    `, [range.from, range.to, routeName]);

    const allDrops = rows.map(_clean);
    let prevLat = null;
    let prevLon = null;
    for (const dp of allDrops) {
      dp.km_from_prev = _haversineKm(prevLat, prevLon, dp.actual_lat, dp.actual_long);
      if (dp.actual_lat != null) {
        prevLat = dp.actual_lat;
        prevLon = dp.actual_long;
      }
    }

    const delivered = allDrops.filter((r) => r.status === 'delivered');
    const missed = allDrops.filter((r) => r.status === 'missed');
    const totalKm = Math.round(
      allDrops.reduce((s, r) => s + (r.km_from_prev || 0), 0) * 100
    ) / 100;

    res.json({
      date, from: range.from, to: range.to,
      route_name: routeName,
      delivered_count: delivered.length,
      missed_count: missed.length,
      total_km: totalKm,
      drop_points: [...delivered, ...missed],
    });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// ── Dashboard: Outstanding ────────────────────────────────────────────────────

// GET /api/dashboard/outstanding
app.get('/api/dashboard/outstanding', async (req, res) => {
  try {
    const range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    // Outstanding is a snapshot (closing balances) — for a range, use the
    // latest report available within it rather than summing snapshots.
    let date;
    if (range) {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM agency_outstanding WHERE report_date BETWEEN $1 AND $2",
        [range.from, range.to]
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    } else {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM agency_outstanding"
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    }
    if (!date) return res.json({ date, summary: {}, units: [] });

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    let scopeFilter = '';
    let scopeParams = []; // will be [] or [aoNames]

    if (unitCodes === null) {
      // Admin: no filter
    } else if (unitCodes.length === 0) {
      return res.json({ date, summary: {}, units: [] });
    } else {
      // Resolve unit names used in agency_outstanding table
      const placeholders = unitCodes.map((_, i) => `$${i + 1}`).join(',');
      const { rows: aoRows } = await pool.query(`
        SELECT DISTINCT ao.unit_name FROM agency_outstanding ao
        JOIN units u ON (
          ao.unit_name = u.unit_name OR ao.unit_name = u.unit_name || ' RP'
          OR ao.unit_name = u.unit_name || ' PT' OR ao.unit_name = u.unit_name || ' DN'
        )
        WHERE u.unit_code IN (${placeholders})
      `, unitCodes);
      const aoNames = aoRows.map((r) => r.unit_name);
      if (!aoNames.length) return res.json({ date, summary: {}, units: [] });
      scopeFilter = 'AND unit_name = ANY($2)';
      scopeParams = [aoNames];
    }

    // queryParams: [date, ...scopeParams]  →  [date] or [date, aoNames]
    const queryParams = [date, ...scopeParams];

    const { rows: [summaryRow] } = await pool.query(`
      SELECT COUNT(*) AS total_agencies,
          SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END) AS outstanding_agencies,
          COALESCE(SUM(closing_debit), 0)::float AS total_outstanding,
          COALESCE(SUM(closing_credit), 0)::float AS total_advance,
          COALESCE(SUM(bill_amount), 0)::float AS total_bill,
          COALESCE(SUM(receipt_amount), 0)::float AS total_collected,
          COALESCE(ROUND(AVG(collection_pct), 1), 0)::float AS avg_collection_pct
      FROM agency_outstanding WHERE report_date = $1 ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await pool.query(`
      SELECT unit_name,
          COUNT(*) AS agency_count,
          SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END) AS outstanding_count,
          COALESCE(SUM(closing_debit), 0)::float AS outstanding,
          COALESCE(SUM(closing_credit), 0)::float AS advance,
          COALESCE(SUM(bill_amount), 0)::float AS bill_amount,
          COALESCE(SUM(receipt_amount), 0)::float AS collected,
          COALESCE(ROUND(AVG(collection_pct), 1), 0)::float AS avg_collection_pct
      FROM agency_outstanding WHERE report_date = $1 ${scopeFilter}
      GROUP BY unit_name ORDER BY outstanding DESC
    `, queryParams);

    res.json({
      date,
      summary: _clean(summaryRow) || {},
      units: unitsRows.map(_clean),
    });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/dashboard/outstanding/agencies
app.get('/api/dashboard/outstanding/agencies', async (req, res) => {
  try {
    let { unit_name } = req.query;
    const range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    // Snapshot data: use latest report within the range (or overall latest)
    let date;
    if (range) {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM agency_outstanding WHERE report_date BETWEEN $1 AND $2",
        [range.from, range.to]
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    } else {
      const { rows } = await pool.query(
        "SELECT MAX(report_date)::text AS max FROM agency_outstanding"
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    }
    if (!date) return res.json({ date, unit_name, agencies: [] });

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null && unitCodes.length > 0) {
      // $1 = unit_name, $2..$N = unitCodes
      const placeholders = unitCodes.map((_, i) => `$${i + 2}`).join(',');
      const { rows: checkRows } = await pool.query(`
        SELECT 1 FROM agency_outstanding ao
        JOIN units u ON (
          ao.unit_name = u.unit_name OR ao.unit_name = u.unit_name || ' RP'
          OR ao.unit_name = u.unit_name || ' PT' OR ao.unit_name = u.unit_name || ' DN'
        )
        WHERE ao.unit_name = $1 AND u.unit_code IN (${placeholders}) LIMIT 1
      `, [unit_name, ...unitCodes]);
      if (!checkRows.length) return res.json({ date, unit_name, agencies: [] });
    }

    const { rows } = await pool.query(`
      SELECT ag_code, agency_name, executive, status, drop_point, district, zonal_head,
             total_copies, daily_copies,
             COALESCE(security_deposit, 0)::float AS security_deposit,
             COALESCE(required_security, 0)::float AS required_security,
             COALESCE(security_diff, 0)::float AS security_diff,
             COALESCE(opening_debit, 0)::float AS opening_debit,
             COALESCE(opening_credit, 0)::float AS opening_credit,
             COALESCE(bill_amount, 0)::float AS bill_amount,
             COALESCE(other_debits, 0)::float AS other_debits,
             COALESCE(receipt_amount, 0)::float AS receipt_amount,
             COALESCE(other_credits, 0)::float AS other_credits,
             COALESCE(closing_debit, 0)::float AS closing_debit,
             COALESCE(closing_credit, 0)::float AS closing_credit,
             COALESCE(collection_pct, 0)::float AS collection_pct,
             mobile_no, agency_type,
             supply_start_date::text, supply_days,
             last_supply_date::text, last_supply_post
      FROM agency_outstanding
      WHERE report_date = $1 AND unit_name = $2
      ORDER BY closing_debit DESC NULLS LAST, agency_name
    `, [date, unit_name]);

    res.json({ date, unit_name, agencies: rows.map(_clean) });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// ── Dashboard: Supply ─────────────────────────────────────────────────────────

// GET /api/dashboard/supply
app.get('/api/dashboard/supply', async (req, res) => {
  try {
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(supply_date)::text AS max FROM daily_supply"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      if (!d) return res.json({ date: '', summary: {}, units: [] });
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    let scopeFilter = '';
    let scopeParams = [];

    if (unitCodes === null) {
      // Admin
    } else if (unitCodes.length === 0) {
      return res.json({ date, summary: {}, units: [] });
    } else {
      const placeholders = unitCodes.map((_, i) => `$${i + 1}`).join(',');
      const { rows: scopeRows } = await pool.query(`
        SELECT DISTINCT ds.unit_name FROM daily_supply ds
        JOIN units u ON (
          ds.unit_name = u.unit_name OR ds.unit_name = u.unit_name || ' RP'
          OR ds.unit_name = u.unit_name || ' PT' OR ds.unit_name = u.unit_name || ' DN'
        )
        WHERE u.unit_code IN (${placeholders})
      `, unitCodes);
      const scopeNames = scopeRows.map((r) => r.unit_name);
      if (!scopeNames.length) return res.json({ date, summary: {}, units: [] });
      scopeFilter = 'AND unit_name = ANY($3)';
      scopeParams = [scopeNames];
    }

    const queryParams = [range.from, range.to, ...scopeParams];

    const { rows: [summaryRow] } = await pool.query(`
      SELECT COUNT(DISTINCT ag_code) AS total_agencies,
          COALESCE(SUM(copies_supplied), 0)::float AS total_copies,
          COALESCE(AVG(copies_supplied), 0)::float AS avg_copies,
          COUNT(DISTINCT CASE WHEN copies_supplied > 0 THEN ag_code END) AS active_agencies
      FROM daily_supply WHERE supply_date BETWEEN $1 AND $2 ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await pool.query(`
      SELECT unit_name,
          COUNT(DISTINCT ag_code) AS agencies,
          COALESCE(SUM(copies_supplied), 0)::float AS total_copies,
          COALESCE(AVG(copies_supplied), 0)::float AS avg_copies
      FROM daily_supply WHERE supply_date BETWEEN $1 AND $2 ${scopeFilter}
      GROUP BY unit_name ORDER BY total_copies DESC
    `, queryParams);

    res.json({
      date, from: range.from, to: range.to,
      summary: _clean(summaryRow) || {},
      units: unitsRows.map(_clean),
    });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/dashboard/supply/agencies
app.get('/api/dashboard/supply/agencies', async (req, res) => {
  try {
    let { unit_name } = req.query;
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(supply_date)::text AS max FROM daily_supply"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null && unitCodes.length > 0) {
      const placeholders = unitCodes.map((_, i) => `$${i + 2}`).join(',');
      const { rows: checkRows } = await pool.query(`
        SELECT 1 FROM daily_supply ds
        JOIN units u ON (
          ds.unit_name = u.unit_name OR ds.unit_name = u.unit_name || ' RP'
          OR ds.unit_name = u.unit_name || ' PT' OR ds.unit_name = u.unit_name || ' DN'
        )
        WHERE ds.unit_name = $1 AND u.unit_code IN (${placeholders}) LIMIT 1
      `, [unit_name, ...unitCodes]);
      if (!checkRows.length) return res.json({ date, unit_name, agencies: [] });
    }

    const { rows } = await pool.query(`
      SELECT ag_code, MAX(agency_name) AS agency_name, MAX(executive) AS executive,
             MAX(zonal_head) AS zonal_head,
             COALESCE(SUM(copies_supplied), 0)::float AS copies_supplied
      FROM daily_supply
      WHERE supply_date BETWEEN $1 AND $2 AND unit_name = $3
      GROUP BY ag_code
      ORDER BY copies_supplied DESC NULLS LAST, agency_name
    `, [range.from, range.to, unit_name]);

    res.json({ date, from: range.from, to: range.to, unit_name, agencies: rows.map(_clean) });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// ── Dashboard: Collection ─────────────────────────────────────────────────────

// GET /api/dashboard/collection
app.get('/api/dashboard/collection', async (req, res) => {
  try {
    let range = resolveRange(req.query);
    const personCode = req.headers['x-person-code'] || '';
    const hlRaw = req.headers['x-hierarchy-level'];
    const hl = hlRaw && /^\d+$/.test(hlRaw) ? parseInt(hlRaw, 10) : 1;

    if (!range) {
      const { rows } = await pool.query(
        "SELECT MAX(collection_date)::text AS max FROM daily_collection"
      );
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      if (!d) return res.json({ date: '', summary: {}, units: [] });
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    let scopeFilter = '';
    let scopeParams = [];

    if (unitCodes === null) {
      // Admin
    } else if (unitCodes.length === 0) {
      return res.json({ date, summary: {}, units: [] });
    } else {
      const placeholders = unitCodes.map((_, i) => `$${i + 1}`).join(',');
      const { rows: scopeRows } = await pool.query(`
        SELECT DISTINCT dc.unit_name FROM daily_collection dc
        JOIN units u ON (
          dc.unit_name = u.unit_name OR dc.unit_name = u.unit_name || ' RP'
          OR dc.unit_name = u.unit_name || ' PT' OR dc.unit_name = u.unit_name || ' DN'
        )
        WHERE u.unit_code IN (${placeholders})
      `, unitCodes);
      const scopeNames = scopeRows.map((r) => r.unit_name);
      if (!scopeNames.length) return res.json({ date, summary: {}, units: [] });
      scopeFilter = 'AND unit_name = ANY($3)';
      scopeParams = [scopeNames];
    }

    const queryParams = [range.from, range.to, ...scopeParams];

    const { rows: [summaryRow] } = await pool.query(`
      SELECT COUNT(*) AS total_transactions,
          COALESCE(SUM(amount), 0)::float AS total_collected,
          COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0)::float AS credit_collection,
          COALESCE(SUM(CASE WHEN sale_type='CASH' THEN amount END), 0)::float AS cash_collection,
          COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT')
            THEN amount END), 0)::float AS digital_collection,
          COALESCE(SUM(CASE WHEN payment_mode='CASH' THEN amount END), 0)::float AS physical_cash,
          COUNT(DISTINCT ag_code) AS agencies_paid
      FROM daily_collection WHERE collection_date BETWEEN $1 AND $2 ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await pool.query(`
      SELECT unit_name,
          COUNT(*) AS transactions,
          COALESCE(SUM(amount), 0)::float AS total_collected,
          COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0)::float AS credit_collection,
          COALESCE(SUM(CASE WHEN sale_type='CASH' THEN amount END), 0)::float AS cash_collection,
          COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT')
            THEN amount END), 0)::float AS digital_collection,
          COUNT(DISTINCT ag_code) AS agencies_paid
      FROM daily_collection WHERE collection_date BETWEEN $1 AND $2 ${scopeFilter}
      GROUP BY unit_name ORDER BY total_collected DESC
    `, queryParams);

    res.json({
      date, from: range.from, to: range.to,
      summary: _clean(summaryRow) || {},
      units: unitsRows.map(_clean),
    });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`Patrika Vitran API running on http://0.0.0.0:${API_PORT}`);
  });
}

module.exports = app;
