'use strict';

/**
 * Patrika Vitran Suite — REST API server (Node.js / Express + MySQL)
 */

const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ── Configuration ─────────────────────────────────────────────────────────────
const DB_CONFIG = {
  host:        process.env.MYSQL_HOST     || 'localhost',
  port:        parseInt(process.env.MYSQL_PORT || '3306', 10),
  database:    process.env.MYSQL_DB       || 'patrika_vitran',
  user:        process.env.MYSQL_USER     || 'root',
  password:    process.env.MYSQL_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    10,
  dateStrings: true,   // return DATE/DATETIME as 'YYYY-MM-DD' strings
};

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:8123').split(',');
const API_PORT     = parseInt(process.env.API_PORT || '8000', 10);

const pool = mysql.createPool(DB_CONFIG);

// pool.execute() returns [rows, fields] — this wrapper gives a pg-like { rows } interface
async function q(sql, params) {
  const [rows] = await pool.execute(sql, params || []);
  return { rows };
}
// For transactions, get a raw connection
async function getConn() { return pool.getConnection(); }

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
  const [rows] = await runner.execute('SELECT id FROM users WHERE mobile = ?', [mobile]);
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
    const { rows } = await q(
      `SELECT DISTINCT unit_code FROM hierarchy_mapping WHERE ${col} = ?`,
      [String(personCode)]
    );
    return rows.map((r) => r.unit_code);
  }

  const { rows } = await q(
    'SELECT unit_code FROM hierarchy_master WHERE person_code = ? AND is_active = 1',
    [String(personCode)]
  );
  const row = rows[0];
  return row && row.unit_code ? [row.unit_code] : [];
}

async function scopeToTaxiNames(unitCodes) {
  if (!unitCodes || unitCodes.length === 0) return [];
  const ph = unitCodes.map(() => '?').join(',');
  const { rows } = await q(
    `SELECT DISTINCT tdl.unit_name
     FROM taxi_delay_log tdl
     JOIN units u ON (tdl.unit_name = u.unit_name OR tdl.unit_name = CONCAT(u.unit_name, ' RP'))
     WHERE u.unit_code IN (${ph})`,
    unitCodes
  );
  return rows.map((r) => r.unit_name);
}

/** Build  IN (?,?,?)  clause + params array for MySQL from an array value */
function inClause(arr) {
  return { sql: `IN (${arr.map(() => '?').join(',')})`, params: arr };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/health
app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await q('SELECT COUNT(*) AS n FROM users');
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
    const { rows } = await q(
      'SELECT id, mobile, name, role, district FROM users WHERE mobile = ? AND password = ? AND is_active = 1',
      [mobile, password]
    );
    if (!rows.length) return res.status(401).json({ detail: 'Invalid mobile number or password' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/customers
app.get('/api/customers', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM customers ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/customers
app.post('/api/customers', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { name, address, phone, plan } = req.body;
    const [result] = await conn.execute(
      'INSERT INTO customers (name, address, mobile, edition, copies, agent_id) VALUES (?,?,?,?,1,?)',
      [name, address, phone, plan, uid]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Customer created ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/stops
app.get('/api/stops', async (req, res) => {
  try {
    const uid = await userIdFromMobile(pool, req.headers['x-user-mobile']);
    if (!uid) return res.json([]);
    const { rows } = await q('SELECT * FROM stops WHERE hawker_id = ? AND trip_date = CURDATE() ORDER BY id', [uid]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/stops/:stop_id/mark
app.post('/api/stops/:stop_id/mark', async (req, res) => {
  try {
    await q('UPDATE stops SET status = ?, marked_at = NOW() WHERE id = ?', [req.body.status, parseInt(req.params.stop_id, 10)]);
    res.json({ message: 'Stop updated ✓' });
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// GET /api/payments
app.get('/api/payments', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM payments ORDER BY collected_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/payments
app.post('/api/payments', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { customer_name, amount, method, notes = '' } = req.body;
    const [result] = await conn.execute(
      'INSERT INTO payments (amount, collected_by, method, notes) VALUES (?,?,?,?)',
      [amount, uid, method, `${customer_name} · ${notes}`]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Payment recorded ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/complaints
app.get('/api/complaints', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM complaints ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/complaints
app.post('/api/complaints', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { customer_name, complaint_type, route, priority, description = '' } = req.body;
    const fullDesc = `Customer: ${customer_name} | Route: ${route} | Priority: ${priority} | ${description}`;
    const [result] = await conn.execute(
      'INSERT INTO complaints (type, description, raised_by) VALUES (?,?,?)',
      [complaint_type, fullDesc, uid]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Complaint logged ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/visits
app.get('/api/visits', async (req, res) => {
  try {
    const uid = await userIdFromMobile(pool, req.headers['x-user-mobile']);
    if (!uid) return res.json([]);
    const { rows } = await q(
      'SELECT * FROM dcr_visits WHERE dcr_id = ? AND visit_date = CURDATE() ORDER BY created_at DESC',
      [uid]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/visits
app.post('/api/visits', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { visit_type, target, outcome, amount = 0, notes = '' } = req.body;
    let note = outcome;
    if (amount) note += ` · collected ₹${amount}`;
    if (notes) note += ` · ${notes}`;
    const [result] = await conn.execute(
      'INSERT INTO dcr_visits (dcr_id, outlet_name, purpose, outcome) VALUES (?,?,?,?)',
      [uid, target, visit_type, note]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Visit saved ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/leads
app.get('/api/leads', async (req, res) => {
  try {
    const uid = await userIdFromMobile(pool, req.headers['x-user-mobile']);
    if (!uid) return res.json([]);
    const { rows } = await q('SELECT * FROM leads WHERE surveyor_id = ? ORDER BY created_at DESC', [uid]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/leads
app.post('/api/leads', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { name, mobile: leadMobile, area, publication, interest } = req.body;
    const lvl = interest.startsWith('High') ? 'hot' : interest.startsWith('Low') ? 'cold' : 'medium';
    const [result] = await conn.execute(
      'INSERT INTO leads (surveyor_id, name, mobile, address, edition, interest) VALUES (?,?,?,?,?,?)',
      [uid, name, leadMobile, area, publication, lvl]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Lead saved ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/trips
app.get('/api/trips', async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM trips WHERE trip_date = CURDATE() ORDER BY created_at DESC LIMIT 20');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ detail: String(e) });
  }
});

// POST /api/trips
app.post('/api/trips', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const uid = await userIdFromMobile(conn, req.headers['x-user-mobile']);
    const { vehicle_no, route, bundles = 0 } = req.body;
    const [result] = await conn.execute(
      'INSERT INTO trips (driver_id, vehicle_no, route_code, bundles) VALUES (?,?,?,?)',
      [uid, vehicle_no, route, bundles]
    );
    await conn.commit();
    res.json({ id: result.insertId, message: 'Trip logged ✓' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ detail: String(e) });
  } finally { conn.release(); }
});

// GET /api/hierarchy/users
app.get('/api/hierarchy/users', async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT hm.id, hm.person_code, hm.person_name, hm.hierarchy_level,
             hm.unit_code, COALESCE(u.unit_name, hm.unit_code) AS unit_name,
             hm.reporting_to, hm.employee_code
      FROM hierarchy_master hm
      LEFT JOIN units u ON u.unit_code = hm.unit_code
      WHERE hm.is_active = 1
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
      const { rows } = await q('SELECT DATE_FORMAT(MAX(report_date),\'%Y-%m-%d\') AS max FROM taxi_delay_log');
      const d = (rows[0] && rows[0].max) ? rows[0].max : new Date().toISOString().slice(0, 10);
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    const taxiNames = unitCodes === null ? null : await scopeToTaxiNames(unitCodes);

    if (taxiNames !== null && taxiNames.length === 0) {
      return res.json({
        date, from: range.from, to: range.to,
        summary: { total_routes:0, total_supply:0, on_time:0, delayed:0, otd_pct:0, planned_km:0, actual_km:0, delivered_drops:0, active_routes:0, planned_drops:0, missed_drops:0 },
        units: [],
      });
    }

    // taxi_delayed is INT (signed seconds): <= 0 = on-time, > 0 = delayed
    const nameFilter = taxiNames !== null ? inClause(taxiNames) : null;

    const sFilter = nameFilter ? `AND unit_name ${nameFilter.sql}` : '';
    const sParams = nameFilter ? nameFilter.params : [];

    const { rows: [summaryRow] } = await q(`
      SELECT COUNT(*) AS total_routes,
        COALESCE(SUM(supply), 0) AS total_supply,
        COALESCE(SUM(CASE WHEN COALESCE(taxi_delayed,1) <= 0 THEN 1 ELSE 0 END), 0) AS on_time,
        COALESCE(SUM(CASE WHEN COALESCE(taxi_delayed,1)  > 0 THEN 1 ELSE 0 END), 0) AS delayed,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN COALESCE(taxi_delayed,1) <= 0 THEN 1 ELSE 0 END)
          / NULLIF(COUNT(*),0), 1), 0) AS otd_pct,
        COALESCE(SUM(route_master_km), 0) AS planned_km,
        COALESCE(SUM(total_app_km), 0) AS actual_km
      FROM taxi_delay_log WHERE report_date BETWEEN ? AND ? ${sFilter}
    `, [range.from, range.to, ...sParams]);

    const dFilter = nameFilter ? `AND unit_name ${nameFilter.sql}` : '';
    const dParams = nameFilter ? nameFilter.params : [];

    const { rows: [dropsRow] } = await q(`
      SELECT COUNT(*) AS delivered_drops, COUNT(DISTINCT route_code) AS active_routes
      FROM taxi_drop_point_log WHERE sup_date BETWEEN ? AND ? ${dFilter}
    `, [range.from, range.to, ...dParams]);

    const { rows: [plannedRow] } = await q(`
      SELECT COUNT(*) AS planned_drops
      FROM drop_points_master
      WHERE route_code IN (
        SELECT DISTINCT route_code FROM taxi_drop_point_log
        WHERE sup_date BETWEEN ? AND ? ${dFilter}
      )
    `, [range.from, range.to, ...dParams]);

    let unitsRows;
    if (taxiNames !== null) {
      const ph = inClause(taxiNames);
      const { rows } = await q(`
        SELECT d.unit_name,
          COUNT(*) AS routes,
          COALESCE(SUM(d.supply), 0) AS supply,
          SUM(CASE WHEN COALESCE(d.taxi_delayed,1) <= 0 THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE WHEN COALESCE(d.taxi_delayed,1)  > 0 THEN 1 ELSE 0 END) AS delayed,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN COALESCE(d.taxi_delayed,1) <= 0 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0), 1), 0) AS otd_pct,
          COALESCE(SUM(d.total_app_km), 0) AS actual_km,
          COALESCE(dp_agg.delivered_drops, 0) AS delivered_drops
        FROM taxi_delay_log d
        LEFT JOIN (
          SELECT unit_name, COUNT(*) AS delivered_drops
          FROM taxi_drop_point_log
          WHERE sup_date BETWEEN ? AND ? AND unit_name ${ph.sql}
          GROUP BY unit_name
        ) dp_agg ON dp_agg.unit_name = d.unit_name
        WHERE d.report_date BETWEEN ? AND ? AND d.unit_name ${ph.sql}
        GROUP BY d.unit_name, dp_agg.delivered_drops
        ORDER BY delayed DESC, d.unit_name
      `, [range.from, range.to, ...ph.params, range.from, range.to, ...ph.params]);
      unitsRows = rows;
    } else {
      const { rows } = await q(`
        SELECT d.unit_name,
          COUNT(*) AS routes,
          COALESCE(SUM(d.supply), 0) AS supply,
          SUM(CASE WHEN COALESCE(d.taxi_delayed,1) <= 0 THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE WHEN COALESCE(d.taxi_delayed,1)  > 0 THEN 1 ELSE 0 END) AS delayed,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN COALESCE(d.taxi_delayed,1) <= 0 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0), 1), 0) AS otd_pct,
          COALESCE(SUM(d.total_app_km), 0) AS actual_km,
          COALESCE(dp_agg.delivered_drops, 0) AS delivered_drops
        FROM taxi_delay_log d
        LEFT JOIN (
          SELECT unit_name, COUNT(*) AS delivered_drops
          FROM taxi_drop_point_log WHERE sup_date BETWEEN ? AND ?
          GROUP BY unit_name
        ) dp_agg ON dp_agg.unit_name = d.unit_name
        WHERE d.report_date BETWEEN ? AND ?
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
      const { rows } = await q("SELECT DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS max FROM taxi_delay_log");
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

    const { rows } = await q(`
      SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS report_date,
             route_name, sub_route_name, taxi_type, bundles, supply, vehicle_no, is_regular,
             TIME_FORMAT(scheduled_departure,'%H:%i') AS scheduled_departure,
             TIME_FORMAT(actual_departure,'%H:%i') AS actual_departure,
             ROUND(COALESCE(taxi_delayed, 0) / 60, 0) AS delay_minutes,
             COALESCE(route_master_km, 0) AS planned_km,
             COALESCE(total_app_km, 0) AS actual_km,
             (COALESCE(taxi_delayed, 0) > 0) AS is_delayed
      FROM taxi_delay_log
      WHERE report_date BETWEEN ? AND ? AND unit_name = ?
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
      const { rows } = await q("SELECT DATE_FORMAT(MAX(sup_date),'%Y-%m-%d') AS max FROM taxi_drop_point_log");
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const routeName = route_code;

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null) {
      const taxiNames = await scopeToTaxiNames(unitCodes);
      const { rows: rrows } = await q('SELECT unit_name FROM taxi_delay_log WHERE route_name = ? LIMIT 1', [routeName]);
      if (rrows.length && !taxiNames.includes(rrows[0].unit_name)) {
        return res.json({ date, route_name: routeName, delivered_count: 0, missed_count: 0, drop_points: [] });
      }
    }

    const { rows } = await q(`
      SELECT DATE_FORMAT(sup_date,'%Y-%m-%d') AS sup_date, drop_point_name,
             TIME_FORMAT(scheduled_arrival,'%H:%i') AS scheduled_arrival,
             TIME_FORMAT(actual_arrival,'%H:%i') AS actual_arrival,
             ROUND(COALESCE(time_diff, 0) / 60, 0) AS diff_minutes,
             actual_lat, actual_long,
             CASE WHEN actual_lat IS NOT NULL AND actual_long IS NOT NULL
                  THEN 'delivered' ELSE 'missed' END AS status
      FROM taxi_drop_point_log
      WHERE sup_date BETWEEN ? AND ? AND route_name = ?
      ORDER BY sup_date DESC,
               CASE WHEN actual_arrival IS NULL THEN 1 ELSE 0 END,
               actual_arrival,
               CASE WHEN scheduled_arrival IS NULL THEN 1 ELSE 0 END,
               scheduled_arrival
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

    let date;
    if (range) {
      const { rows } = await q(
        "SELECT DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS max FROM agency_outstanding WHERE report_date BETWEEN ? AND ?",
        [range.from, range.to]
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    } else {
      const { rows } = await q("SELECT DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS max FROM agency_outstanding");
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    }
    if (!date) return res.json({ date, summary: {}, units: [] });

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    let scopeFilter = '';
    let scopeParams = [];

    if (unitCodes === null) {
      // Admin: no filter
    } else if (unitCodes.length === 0) {
      return res.json({ date, summary: {}, units: [] });
    } else {
      const ph = inClause(unitCodes);
      const { rows: aoRows } = await q(`
        SELECT DISTINCT ao.unit_name FROM agency_outstanding ao
        JOIN units u ON (
          ao.unit_name = u.unit_name OR ao.unit_name = CONCAT(u.unit_name, ' RP')
          OR ao.unit_name = CONCAT(u.unit_name, ' PT') OR ao.unit_name = CONCAT(u.unit_name, ' DN')
        )
        WHERE u.unit_code ${ph.sql}
      `, ph.params);
      const aoNames = aoRows.map((r) => r.unit_name);
      if (!aoNames.length) return res.json({ date, summary: {}, units: [] });
      const nph = inClause(aoNames);
      scopeFilter = `AND unit_name ${nph.sql}`;
      scopeParams = nph.params;
    }

    const queryParams = [date, ...scopeParams];

    const { rows: [summaryRow] } = await q(`
      SELECT COUNT(*) AS total_agencies,
          SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END) AS outstanding_agencies,
          COALESCE(SUM(closing_debit), 0) AS total_outstanding,
          COALESCE(SUM(closing_credit), 0) AS total_advance,
          COALESCE(SUM(bill_amount), 0) AS total_bill,
          COALESCE(SUM(receipt_amount), 0) AS total_collected,
          COALESCE(ROUND(AVG(collection_pct), 1), 0) AS avg_collection_pct
      FROM agency_outstanding WHERE report_date = ? ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await q(`
      SELECT unit_name,
          COUNT(*) AS agency_count,
          SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END) AS outstanding_count,
          COALESCE(SUM(closing_debit), 0) AS outstanding,
          COALESCE(SUM(closing_credit), 0) AS advance,
          COALESCE(SUM(bill_amount), 0) AS bill_amount,
          COALESCE(SUM(receipt_amount), 0) AS collected,
          COALESCE(ROUND(AVG(collection_pct), 1), 0) AS avg_collection_pct
      FROM agency_outstanding WHERE report_date = ? ${scopeFilter}
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

    let date;
    if (range) {
      const { rows } = await q(
        "SELECT DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS max FROM agency_outstanding WHERE report_date BETWEEN ? AND ?",
        [range.from, range.to]
      );
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    } else {
      const { rows } = await q("SELECT DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS max FROM agency_outstanding");
      date = (rows[0] && rows[0].max) ? rows[0].max : '';
    }
    if (!date) return res.json({ date, unit_name, agencies: [] });

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null && unitCodes.length > 0) {
      const ph = inClause(unitCodes);
      const { rows: checkRows } = await q(`
        SELECT 1 FROM agency_outstanding ao
        JOIN units u ON (
          ao.unit_name = u.unit_name OR ao.unit_name = CONCAT(u.unit_name, ' RP')
          OR ao.unit_name = CONCAT(u.unit_name, ' PT') OR ao.unit_name = CONCAT(u.unit_name, ' DN')
        )
        WHERE ao.unit_name = ? AND u.unit_code ${ph.sql} LIMIT 1
      `, [unit_name, ...ph.params]);
      if (!checkRows.length) return res.json({ date, unit_name, agencies: [] });
    }

    const { rows } = await q(`
      SELECT ag_code, agency_name, executive, status, drop_point, district, zonal_head,
             total_copies, daily_copies,
             COALESCE(security_deposit, 0) AS security_deposit,
             COALESCE(required_security, 0) AS required_security,
             COALESCE(security_diff, 0) AS security_diff,
             COALESCE(opening_debit, 0) AS opening_debit,
             COALESCE(opening_credit, 0) AS opening_credit,
             COALESCE(bill_amount, 0) AS bill_amount,
             COALESCE(other_debits, 0) AS other_debits,
             COALESCE(receipt_amount, 0) AS receipt_amount,
             COALESCE(other_credits, 0) AS other_credits,
             COALESCE(closing_debit, 0) AS closing_debit,
             COALESCE(closing_credit, 0) AS closing_credit,
             COALESCE(collection_pct, 0) AS collection_pct,
             mobile_no, agency_type,
             DATE_FORMAT(supply_start_date,'%Y-%m-%d') AS supply_start_date, supply_days,
             DATE_FORMAT(last_supply_date,'%Y-%m-%d') AS last_supply_date, last_supply_post
      FROM agency_outstanding
      WHERE report_date = ? AND unit_name = ?
      ORDER BY CASE WHEN closing_debit IS NULL THEN 1 ELSE 0 END, closing_debit DESC, agency_name
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
      const { rows } = await q("SELECT DATE_FORMAT(MAX(supply_date),'%Y-%m-%d') AS max FROM daily_supply");
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
      const ph = inClause(unitCodes);
      const { rows: scopeRows } = await q(`
        SELECT DISTINCT ds.unit_name FROM daily_supply ds
        JOIN units u ON (
          ds.unit_name = u.unit_name OR ds.unit_name = CONCAT(u.unit_name, ' RP')
          OR ds.unit_name = CONCAT(u.unit_name, ' PT') OR ds.unit_name = CONCAT(u.unit_name, ' DN')
        )
        WHERE u.unit_code ${ph.sql}
      `, ph.params);
      const scopeNames = scopeRows.map((r) => r.unit_name);
      if (!scopeNames.length) return res.json({ date, summary: {}, units: [] });
      const nph = inClause(scopeNames);
      scopeFilter = `AND unit_name ${nph.sql}`;
      scopeParams = nph.params;
    }

    const queryParams = [range.from, range.to, ...scopeParams];

    const { rows: [summaryRow] } = await q(`
      SELECT COUNT(DISTINCT ag_code) AS total_agencies,
          COALESCE(SUM(copies_supplied), 0) AS total_copies,
          COALESCE(AVG(copies_supplied), 0) AS avg_copies,
          COUNT(DISTINCT CASE WHEN copies_supplied > 0 THEN ag_code END) AS active_agencies
      FROM daily_supply WHERE supply_date BETWEEN ? AND ? ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await q(`
      SELECT unit_name,
          COUNT(DISTINCT ag_code) AS agencies,
          COALESCE(SUM(copies_supplied), 0) AS total_copies,
          COALESCE(AVG(copies_supplied), 0) AS avg_copies
      FROM daily_supply WHERE supply_date BETWEEN ? AND ? ${scopeFilter}
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
      const { rows } = await q("SELECT DATE_FORMAT(MAX(supply_date),'%Y-%m-%d') AS max FROM daily_supply");
      const d = (rows[0] && rows[0].max) ? rows[0].max : '';
      range = { from: d, to: d };
    }
    const date = rangeLabel(range);

    const unitCodes = await getScopeUnitCodes(personCode, hl);
    if (unitCodes !== null && unitCodes.length > 0) {
      const ph = inClause(unitCodes);
      const { rows: checkRows } = await q(`
        SELECT 1 FROM daily_supply ds
        JOIN units u ON (
          ds.unit_name = u.unit_name OR ds.unit_name = CONCAT(u.unit_name, ' RP')
          OR ds.unit_name = CONCAT(u.unit_name, ' PT') OR ds.unit_name = CONCAT(u.unit_name, ' DN')
        )
        WHERE ds.unit_name = ? AND u.unit_code ${ph.sql} LIMIT 1
      `, [unit_name, ...ph.params]);
      if (!checkRows.length) return res.json({ date, unit_name, agencies: [] });
    }

    const { rows } = await q(`
      SELECT ag_code, MAX(agency_name) AS agency_name, MAX(executive) AS executive,
             MAX(zonal_head) AS zonal_head,
             COALESCE(SUM(copies_supplied), 0) AS copies_supplied
      FROM daily_supply
      WHERE supply_date BETWEEN ? AND ? AND unit_name = ?
      GROUP BY ag_code
      ORDER BY CASE WHEN copies_supplied IS NULL THEN 1 ELSE 0 END, copies_supplied DESC, agency_name
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
      const { rows } = await q("SELECT DATE_FORMAT(MAX(collection_date),'%Y-%m-%d') AS max FROM daily_collection");
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
      const ph = inClause(unitCodes);
      const { rows: scopeRows } = await q(`
        SELECT DISTINCT dc.unit_name FROM daily_collection dc
        JOIN units u ON (
          dc.unit_name = u.unit_name OR dc.unit_name = CONCAT(u.unit_name, ' RP')
          OR dc.unit_name = CONCAT(u.unit_name, ' PT') OR dc.unit_name = CONCAT(u.unit_name, ' DN')
        )
        WHERE u.unit_code ${ph.sql}
      `, ph.params);
      const scopeNames = scopeRows.map((r) => r.unit_name);
      if (!scopeNames.length) return res.json({ date, summary: {}, units: [] });
      const nph = inClause(scopeNames);
      scopeFilter = `AND unit_name ${nph.sql}`;
      scopeParams = nph.params;
    }

    const queryParams = [range.from, range.to, ...scopeParams];

    const { rows: [summaryRow] } = await q(`
      SELECT COUNT(*) AS total_transactions,
          COALESCE(SUM(amount), 0) AS total_collected,
          COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0) AS credit_collection,
          COALESCE(SUM(CASE WHEN sale_type='CASH' THEN amount END), 0) AS cash_collection,
          COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT')
            THEN amount END), 0) AS digital_collection,
          COALESCE(SUM(CASE WHEN payment_mode='CASH' THEN amount END), 0) AS physical_cash,
          COUNT(DISTINCT ag_code) AS agencies_paid
      FROM daily_collection WHERE collection_date BETWEEN ? AND ? ${scopeFilter}
    `, queryParams);

    const { rows: unitsRows } = await q(`
      SELECT unit_name,
          COUNT(*) AS transactions,
          COALESCE(SUM(amount), 0) AS total_collected,
          COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0) AS credit_collection,
          COALESCE(SUM(CASE WHEN sale_type='CASH' THEN amount END), 0) AS cash_collection,
          COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT')
            THEN amount END), 0) AS digital_collection,
          COUNT(DISTINCT ag_code) AS agencies_paid
      FROM daily_collection WHERE collection_date BETWEEN ? AND ? ${scopeFilter}
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
