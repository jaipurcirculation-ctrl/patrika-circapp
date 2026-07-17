'use strict';

const XLSX = require('xlsx');
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ─── DB config (read from .env) ───────────────────────────────────────────────
const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'patrika_vitran',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

// ─── Input directory (relative to this file → api/../Input Reports/) ─────────
const INPUT_DIR = path.resolve(__dirname, '..', 'Input Reports');

// ─── Helper: clean string ─────────────────────────────────────────────────────
function s(v) {
  if (v === null || v === undefined) return null;
  const str = String(v).replace(/\xa0/g, ' ').trim();
  return str === '' ? null : str;
}

// ─── Helper: parse int ────────────────────────────────────────────────────────
function toInt(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const n = parseInt(String(v).replace(/,/g, '').trim(), 10);
  return isNaN(n) ? null : n;
}

// ─── Helper: parse float ──────────────────────────────────────────────────────
function toFloat(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

// ─── Helper: parse date → "YYYY-MM-DD" or null ───────────────────────────────
function toDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(v).trim();
  if (!str) return null;

  // DD/MM/YYYY
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = m[2].padStart(2, '0');
    return `${m[3]}-${mon}-${day}`;
  }
  // YYYY-MM-DD HH:MM:SS
  m = str.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}$/);
  if (m) return m[1];
  // YYYY-MM-DD
  m = str.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return m[1];
  // MM/DD/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mon = m[1].padStart(2, '0');
    const day = m[2].padStart(2, '0');
    return `${m[3]}-${mon}-${day}`;
  }
  // Try JS Date parse as last resort
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }
  return null;
}

// ─── Helper: parse time → "HH:MM:SS" or null ─────────────────────────────────
function toTime(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const h = String(v.getUTCHours()).padStart(2, '0');
    const mi = String(v.getUTCMinutes()).padStart(2, '0');
    const sc = String(v.getUTCSeconds()).padStart(2, '0');
    return `${h}:${mi}:${sc}`;
  }
  if (typeof v === 'number') {
    // Excel fraction of a day
    const totalSec = Math.round(Math.abs(v) * 86400);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mi = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const sc = String(totalSec % 60).padStart(2, '0');
    return `${h}:${mi}:${sc}`;
  }
  const str = String(v).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = m[1].padStart(2, '0');
    const mi = m[2];
    const sc = m[3] ? m[3] : '00';
    return `${h}:${mi}:${sc}`;
  }
  return null;
}

// ─── Helper: parse interval → "HH:MM:SS" or "-HH:MM:SS" or null ─────────────
function toInterval(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const h = String(v.getUTCHours()).padStart(2, '0');
    const mi = String(v.getUTCMinutes()).padStart(2, '0');
    const sc = String(v.getUTCSeconds()).padStart(2, '0');
    return `${h}:${mi}:${sc}`;
  }
  if (typeof v === 'number') {
    const neg = v < 0;
    const totalSec = Math.round(Math.abs(v) * 86400);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mi = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const sc = String(totalSec % 60).padStart(2, '0');
    return `${neg ? '-' : ''}${h}:${mi}:${sc}`;
  }
  const str = String(v).trim();
  if (!str) return null;
  const neg = str.startsWith('-');
  const abs = neg ? str.slice(1).trim() : str;
  const mMatch = abs.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (mMatch) {
    // Normalise overflow minutes/seconds (e.g. 00:68 → 01:08)
    const totalSec = parseInt(mMatch[1], 10) * 3600
                   + parseInt(mMatch[2], 10) * 60
                   + (mMatch[3] ? parseInt(mMatch[3], 10) : 0);
    const h  = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mi = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const sc = String(totalSec % 60).padStart(2, '0');
    return `${neg ? '-' : ''}${h}:${mi}:${sc}`;
  }
  // numeric string (fraction of a day)
  const n = parseFloat(abs);
  if (!isNaN(n)) {
    const totalSec = Math.round(n * 86400);
    const h  = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mi = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const sc = String(totalSec % 60).padStart(2, '0');
    return `${neg ? '-' : ''}${h}:${mi}:${sc}`;
  }
  return null;
}

// ─── Helper: regular/casual → bool ────────────────────────────────────────────
function toBoolRN(v) {
  if (v === null || v === undefined) return true;
  return String(v).trim().toUpperCase() !== 'CASUAL';
}

// ─── Read Excel sheet → array of arrays ──────────────────────────────────────
function readSheet(filename) {
  const filePath = path.join(INPUT_DIR, filename);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
}

// ─── Batch insert helper (chunked individual rows in a loop) ──────────────────
async function insertBatch(client, sql, rows) {
  for (const row of rows) {
    await client.query(sql, row);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. import_hierarchy_master
// ═══════════════════════════════════════════════════════════════════════════════
async function import_hierarchy_master(client) {
  const rows = readSheet('Hieararchy Mast.xlsx');
  const unitPairs = new Map(); // unit_code → comp_code
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[0])) continue;

    const comp_code      = s(r[0]);
    const unit_code      = s(r[1]);
    const person_code    = s(r[2]);
    const person_name    = s(r[3]);
    const hierarchy_code = s(r[5]);
    const hierarchy_level= toInt(r[6]);
    const reporting_to   = s(r[7]);
    const is_active      = s(r[8]) === 'Y';
    const employee_code  = s(r[9]);

    if (unit_code && comp_code) unitPairs.set(unit_code, comp_code);

    dataRows.push([comp_code, unit_code, person_code, person_name,
                   hierarchy_code, hierarchy_level, reporting_to,
                   is_active, employee_code]);
  }

  // Upsert units
  let unitCount = 0;
  for (const [unit_code, comp_code] of unitPairs) {
    await client.query(
      `INSERT INTO units (unit_code, comp_code) VALUES ($1,$2)
       ON CONFLICT (unit_code) DO NOTHING`,
      [unit_code, comp_code]
    );
    unitCount++;
  }

  // Upsert hierarchy_master
  const sql = `
    INSERT INTO hierarchy_master
      (comp_code, unit_code, person_code, person_name,
       hierarchy_code, hierarchy_level, reporting_to,
       is_active, employee_code)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (comp_code, unit_code, person_code) DO UPDATE SET
      person_name     = EXCLUDED.person_name,
      hierarchy_code  = EXCLUDED.hierarchy_code,
      hierarchy_level = EXCLUDED.hierarchy_level,
      reporting_to    = EXCLUDED.reporting_to,
      is_active       = EXCLUDED.is_active,
      employee_code   = EXCLUDED.employee_code,
      updated_at      = NOW()
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  hierarchy_master: ${dataRows.length} rows upserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. import_hierarchy_mapping
// ═══════════════════════════════════════════════════════════════════════════════
async function import_hierarchy_mapping(client) {
  const rows = readSheet('HierMapping.xlsx');
  const unitRows = [];
  const mappingRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[0])) continue;

    const comp_code            = s(r[1]);
    const unit_code            = s(r[2]);
    let   unit_name            = s(r[3]);
    const exec_code            = s(r[4]);
    const exec_desc            = s(r[5]);
    const exec_desig           = s(r[6]);
    const edtn_incharge        = s(r[7]);
    const edtn_incharge_name   = s(r[8]);
    const circ_incharge        = s(r[9]);
    const circ_incharge_name   = s(r[10]);
    const zonal_head           = s(r[11]);
    const zonal_head_name      = s(r[12]);
    const vp_circulation       = s(r[13]);
    const vp_circulation_name  = s(r[14]);

    // Treat formula strings as null
    if (unit_name && unit_name.startsWith('=')) unit_name = null;

    unitRows.push([comp_code, unit_code, unit_name]);
    mappingRows.push([comp_code, unit_code, exec_code, exec_desc, exec_desig,
                      edtn_incharge, edtn_incharge_name,
                      circ_incharge, circ_incharge_name,
                      zonal_head, zonal_head_name,
                      vp_circulation, vp_circulation_name]);
  }

  // Full refresh
  await client.query('DELETE FROM hierarchy_mapping');

  // Build unit_name lookup from what we read from the file
  const unitNameMap = {};
  for (const [, unit_code, unit_name] of unitRows) {
    if (unit_code && unit_name) unitNameMap[unit_code] = unit_name;
  }

  // Upsert units (only update unit_name if not null)
  for (const [comp_code, unit_code, unit_name] of unitRows) {
    if (!unit_code) continue;
    await client.query(
      `INSERT INTO units (unit_code, comp_code, unit_name)
       VALUES ($1,$2,$3)
       ON CONFLICT (unit_code) DO UPDATE SET
         unit_name = CASE WHEN EXCLUDED.unit_name IS NOT NULL
                          THEN EXCLUDED.unit_name
                          ELSE units.unit_name END`,
      [unit_code, comp_code, unit_name]
    );
  }

  // Also pull any unit_names we didn't get from the file (already in DB)
  const dbNames = await client.query('SELECT unit_code, unit_name FROM units WHERE unit_name IS NOT NULL');
  for (const row of dbNames.rows) {
    if (!unitNameMap[row.unit_code]) unitNameMap[row.unit_code] = row.unit_name;
  }

  // Insert hierarchy_mapping — resolve unit_name in JS to avoid type-inference issues
  const sql = `
    INSERT INTO hierarchy_mapping
      (comp_code, unit_code, unit_name,
       exec_code, exec_name, exec_desig,
       edtn_incharge_code, edtn_incharge_name,
       circ_incharge_code, circ_incharge_name,
       zonal_head_code, zonal_head_name,
       vp_circulation_code, vp_circulation_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `;
  for (const [comp_code, unit_code, exec_code, exec_name, exec_desig,
              edtn_code, edtn_name, circ_code, circ_name,
              zonal_code, zonal_name, vp_code, vp_name] of mappingRows) {
    const unit_name = unitNameMap[unit_code] || null;
    await client.query(sql, [comp_code, unit_code, unit_name,
                              exec_code, exec_name, exec_desig,
                              edtn_code, edtn_name, circ_code, circ_name,
                              zonal_code, zonal_name, vp_code, vp_name]);
  }
  console.log(`  hierarchy_mapping: ${mappingRows.length} rows inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. import_drop_points_master
// ═══════════════════════════════════════════════════════════════════════════════
async function import_drop_points_master(client) {
  const rows = readSheet('Taxi Drop Points.xlsx');
  const routeMap = new Map(); // route_code → route_name
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[10])) continue; // drop_point_code required

    const unit_code          = s(r[0]);
    const unit_name          = s(r[1]);
    const driver_mobile      = s(r[2]);
    const driver_name        = s(r[3]);
    const taxi_id            = s(r[4]);
    const vehicle_no         = s(r[5]);
    const route_code         = s(r[6]);
    const route_name         = s(r[7]);
    const sub_route_code     = s(r[8]);
    const sub_route_name     = s(r[9]);
    const drop_point_code    = s(r[10]);
    const drop_point_name    = s(r[11]);
    const latitude           = toFloat(r[12]);
    const longitude          = toFloat(r[13]);
    const arrival_time       = toTime(r[14]);
    const reg_lat_lang_datetime = toDate(r[15]);

    if (route_code) routeMap.set(route_code, route_name);

    dataRows.push([drop_point_code, drop_point_name, unit_code, unit_name,
                   driver_mobile, driver_name, taxi_id, vehicle_no,
                   route_code, route_name, sub_route_code, sub_route_name,
                   latitude, longitude, arrival_time, reg_lat_lang_datetime]);
  }

  // Upsert routes
  for (const [route_code, route_name] of routeMap) {
    await client.query(
      `INSERT INTO routes (route_code, route_name)
       VALUES ($1,$2)
       ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name`,
      [route_code, route_name]
    );
  }

  // Upsert drop_points_master
  const sql = `
    INSERT INTO drop_points_master
      (drop_point_code, drop_point_name, unit_code, unit_name,
       driver_mobile, driver_name, taxi_id, vehicle_no,
       route_code, route_name, sub_route_code, sub_route_name,
       latitude, longitude, scheduled_arrival, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (drop_point_code) DO UPDATE SET
      drop_point_name   = EXCLUDED.drop_point_name,
      unit_code         = EXCLUDED.unit_code,
      unit_name         = EXCLUDED.unit_name,
      driver_mobile     = EXCLUDED.driver_mobile,
      driver_name       = EXCLUDED.driver_name,
      taxi_id           = EXCLUDED.taxi_id,
      vehicle_no        = EXCLUDED.vehicle_no,
      route_code        = EXCLUDED.route_code,
      route_name        = EXCLUDED.route_name,
      sub_route_code    = EXCLUDED.sub_route_code,
      sub_route_name    = EXCLUDED.sub_route_name,
      latitude          = EXCLUDED.latitude,
      longitude         = EXCLUDED.longitude,
      scheduled_arrival = EXCLUDED.scheduled_arrival,
      last_seen_at      = EXCLUDED.last_seen_at
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  drop_points_master: ${dataRows.length} rows upserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. import_taxi_delay_log
// ═══════════════════════════════════════════════════════════════════════════════
async function import_taxi_delay_log(client, reportDateOverride = null) {
  const rows = readSheet('Taxi Delay Report.xlsx');
  const datesSeen = new Set();
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[0])) continue;

    const unit_name        = s(r[0]);
    const report_date      = reportDateOverride || toDate(r[1]);
    const route_name       = s(r[2]);
    const sub_route_name   = s(r[3]);
    const taxi_type        = s(r[4]);
    const bundles          = toInt(r[5]);
    const supply           = toInt(r[6]);
    const vehicle_no       = s(r[7]);
    const is_regular       = toBoolRN(r[8]);
    const casual_reason    = s(r[9]);
    const vehicle_name     = s(r[10]);
    const vehicle_owner    = s(r[11]);
    const mobile           = s(r[12]);
    const start_location   = s(r[13]);
    const sched_departure  = toTime(r[14]);
    const actual_departure = toTime(r[15]);
    const last_location    = s(r[16]);
    const reached_time     = toTime(r[17]);
    const allowed_time     = toInterval(r[18]);
    const time_taken       = toInterval(r[19]);
    const taxi_delayed     = toInterval(r[20]);
    const route_master_km  = toFloat(r[21]);
    const total_app_km     = toFloat(r[22]);

    if (report_date) datesSeen.add(report_date);

    dataRows.push([unit_name, report_date, route_name, sub_route_name,
                   taxi_type, bundles, supply, vehicle_no, is_regular,
                   casual_reason, vehicle_name, vehicle_owner, mobile,
                   start_location, sched_departure, actual_departure,
                   last_location, reached_time, allowed_time, time_taken,
                   taxi_delayed, route_master_km, total_app_km]);
  }

  // Delete existing records for these dates
  for (const d of datesSeen) {
    await client.query('DELETE FROM taxi_delay_log WHERE report_date = $1', [d]);
  }

  const sql = `
    INSERT INTO taxi_delay_log
      (unit_name, report_date, route_name, sub_route_name,
       taxi_type, bundles, supply, vehicle_no, is_regular,
       casual_reason, vehicle_name, vehicle_owner, driver_mobile,
       start_location, scheduled_departure, actual_departure,
       last_location, reached_time, allowed_time, time_taken,
       taxi_delayed, route_master_km, total_app_km)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  taxi_delay_log: ${dataRows.length} rows inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. import_drop_point_log
// ═══════════════════════════════════════════════════════════════════════════════
async function import_drop_point_log(client, reportDateOverride = null) {
  const rows = readSheet('App Taxi Drop Point Wise Report.xlsx');
  const routeMap = new Map();
  const datesSeen = new Set();
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[0])) continue;

    const unit_name        = s(r[0]);
    const sup_date         = reportDateOverride || toDate(r[1]);
    const driver_mobile    = s(r[2]);
    const vehicle          = s(r[3]);
    const taxi_route_type  = s(r[4]);
    const route_code       = s(r[5]);
    const route_name       = s(r[6]);
    const sub_route_code   = s(r[7]);
    const sub_route_name   = s(r[8]);
    const drop_point_name  = s(r[9]);
    const no_of_packets    = toInt(r[10]);
    const packet_drop_date = toDate(r[11]);
    const scheduled_arrival= toTime(r[12]);
    const actual_arrival   = toTime(r[13]);
    const time_diff        = toInterval(r[14]);
    const taxi_id          = s(r[15]);
    const reg_lat          = toFloat(r[16]);
    const reg_long         = toFloat(r[17]);
    const actual_lat       = toFloat(r[18]);
    const actual_long      = toFloat(r[19]);
    const dist_diff        = toFloat(r[20]);
    const route_master_km  = toFloat(r[21]);
    const return_km        = toFloat(r[22]);
    const actual_km        = toFloat(r[23]);
    const total_distance   = toFloat(r[24]);
    const duration         = toInterval(r[25]);
    const lat_long_addr    = s(r[26]);
    const api_distance     = toFloat(r[27]);
    const vehicle_sharing  = s(r[28]) !== 'N';
    const last_drop_point  = s(r[29]);
    const dropping_lat_long= s(r[30]);

    if (route_code) routeMap.set(route_code, route_name);
    if (sup_date) datesSeen.add(sup_date);

    dataRows.push([unit_name, sup_date, driver_mobile, vehicle, taxi_route_type,
                   route_code, route_name, sub_route_code, sub_route_name,
                   drop_point_name, no_of_packets, packet_drop_date,
                   scheduled_arrival, actual_arrival, time_diff,
                   taxi_id, reg_lat, reg_long, actual_lat, actual_long,
                   dist_diff, route_master_km, return_km, actual_km,
                   total_distance, duration, lat_long_addr, api_distance,
                   vehicle_sharing, last_drop_point, dropping_lat_long]);
  }

  // Upsert routes
  for (const [route_code, route_name] of routeMap) {
    await client.query(
      `INSERT INTO routes (route_code, route_name)
       VALUES ($1,$2)
       ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name`,
      [route_code, route_name]
    );
  }

  // Delete for dates seen
  for (const d of datesSeen) {
    await client.query('DELETE FROM taxi_drop_point_log WHERE sup_date = $1', [d]);
  }

  const sql = `
    INSERT INTO taxi_drop_point_log
      (unit_name, sup_date, driver_mobile, vehicle_no, taxi_route_type,
       route_code, route_name, sub_route_code, sub_route_name,
       drop_point_name, no_of_packets, packet_drop_date,
       scheduled_arrival, actual_arrival, time_diff,
       taxi_id, reg_lat, reg_long, actual_lat, actual_long,
       dist_diff, route_master_km, return_km, actual_km,
       total_distance, duration, lat_long_addr, api_distance,
       vehicle_sharing, last_drop_point, dropping_lat_long)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  drop_point_log: ${dataRows.length} rows inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. import_agency_outstanding
// ═══════════════════════════════════════════════════════════════════════════════
async function import_agency_outstanding(client) {
  const rows = readSheet('Agency Outstanding.xlsx');
  const dataRows = [];
  let maxDate = null;

  // First pass: find report_date from max of col 31
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[3])) continue;
    const d = toDate(r[31]);
    if (d && (!maxDate || d > maxDate)) maxDate = d;
  }

  const report_date = maxDate;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[3])) continue;

    const state_region        = s(r[1]);
    const unit_name           = s(r[2]);
    const ag_code             = s(r[3]);
    const agency_name         = s(r[4]);
    const executive           = s(r[5]);
    const status              = s(r[6]);
    const zonal_head          = s(r[8]);
    const state               = s(r[9]);
    const district            = s(r[10]);
    const drop_point          = s(r[11]);
    const total_copies        = toInt(r[12]);
    const daily_copies        = toInt(r[13]);
    const security_deposit    = toFloat(r[14]);
    const required_security   = toFloat(r[15]);
    const security_diff       = toFloat(r[16]);
    const opening_debit       = toFloat(r[17]);
    const opening_credit      = toFloat(r[18]);
    const bill_amount         = toFloat(r[19]);
    const other_debits        = toFloat(r[20]);
    const receipt_amount      = toFloat(r[21]);
    const other_credits       = toFloat(r[22]);
    // col 23 = net receipt (skipped, not in DB)
    const closing_debit       = toFloat(r[24]);
    const closing_credit      = toFloat(r[25]);
    const collection_pct      = toFloat(r[26]);
    const mobile_no           = s(r[27]);
    const agency_type         = s(r[28]);
    const supply_start_date   = toDate(r[29]);
    const supply_days         = toInt(r[30]);
    const last_supply_date    = toDate(r[31]);
    const last_supply_post    = toInt(r[32]);

    dataRows.push([report_date, state_region, unit_name, ag_code, agency_name,
                   executive, status, zonal_head, state, district, drop_point,
                   total_copies, daily_copies,
                   security_deposit, required_security, security_diff,
                   opening_debit, opening_credit, bill_amount, other_debits,
                   receipt_amount, other_credits, closing_debit, closing_credit,
                   collection_pct, mobile_no, agency_type, supply_start_date,
                   supply_days, last_supply_date, last_supply_post]);
  }

  if (report_date) {
    await client.query(
      'DELETE FROM agency_outstanding WHERE report_date = $1',
      [report_date]
    );
  }

  const sql = `
    INSERT INTO agency_outstanding
      (report_date, state_region, unit_name, ag_code, agency_name,
       executive, status, zonal_head, state, district, drop_point,
       total_copies, daily_copies,
       security_deposit, required_security, security_diff,
       opening_debit, opening_credit, bill_amount, other_debits,
       receipt_amount, other_credits, closing_debit, closing_credit,
       collection_pct, mobile_no, agency_type, supply_start_date,
       supply_days, last_supply_date, last_supply_post)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
    ON CONFLICT (report_date, ag_code) DO UPDATE SET
      state_region      = EXCLUDED.state_region,
      unit_name         = EXCLUDED.unit_name,
      agency_name       = EXCLUDED.agency_name,
      executive         = EXCLUDED.executive,
      status            = EXCLUDED.status,
      zonal_head        = EXCLUDED.zonal_head,
      state             = EXCLUDED.state,
      district          = EXCLUDED.district,
      drop_point        = EXCLUDED.drop_point,
      total_copies      = EXCLUDED.total_copies,
      daily_copies      = EXCLUDED.daily_copies,
      security_deposit  = EXCLUDED.security_deposit,
      required_security = EXCLUDED.required_security,
      security_diff     = EXCLUDED.security_diff,
      opening_debit     = EXCLUDED.opening_debit,
      opening_credit    = EXCLUDED.opening_credit,
      bill_amount       = EXCLUDED.bill_amount,
      other_debits      = EXCLUDED.other_debits,
      receipt_amount    = EXCLUDED.receipt_amount,
      other_credits     = EXCLUDED.other_credits,
      closing_debit     = EXCLUDED.closing_debit,
      closing_credit    = EXCLUDED.closing_credit,
      collection_pct    = EXCLUDED.collection_pct,
      mobile_no         = EXCLUDED.mobile_no,
      agency_type       = EXCLUDED.agency_type,
      supply_start_date = EXCLUDED.supply_start_date,
      supply_days       = EXCLUDED.supply_days,
      last_supply_date  = EXCLUDED.last_supply_date,
      last_supply_post  = EXCLUDED.last_supply_post
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  agency_outstanding: ${dataRows.length} rows upserted (report_date=${report_date})`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. import_daily_supply
// ═══════════════════════════════════════════════════════════════════════════════
const MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};

function parseDDMONYYYY(str) {
  // "15JUL2026"
  const m = String(str).match(/^(\d{1,2})([A-Z]{3})(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (mon === undefined) return null;
  const y = parseInt(m[3], 10);
  const d = parseInt(m[1], 10);
  return new Date(y, mon, d);
}

function dateToISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function import_daily_supply(client, rptDate = null) {
  const rows = readSheet('Supply.xlsx');
  if (rows.length === 0) return;

  const header = rows[0];
  // Detect date columns — strip quotes (Excel text-prefix cells), normalise to uppercase
  const dateCols = [];
  for (let c = 0; c < header.length; c++) {
    if (header[c] instanceof Date) continue;          // skip cells xlsx parsed as Date
    const cell = String(header[c] || '').replace(/\xa0/g, ' ').trim()
                   .replace(/^['"`]+|['"`]+$/g, '')   // strip surrounding quotes
                   .toUpperCase();
    if (/^\d{1,2}[A-Z]{3}\d{4}$/.test(cell)) {
      const dt = parseDDMONYYYY(cell);
      if (dt) dateCols.push({ col: c, date: dateToISO(dt) });
    }
  }
  if (dateCols.length === 0) {
    console.log('  daily_supply: no date columns found in header — skipping');
    console.log('  Header preview:', header.slice(0, 25).map(String));
    return;
  }
  console.log('  Supply.xlsx date columns:', dateCols.map(d => d.date));

  const datesSeen = new Set();
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!s(r[6])) continue; // ag_code required

    const state_region  = s(r[1]);
    const unit_name     = s(r[2]);
    const zonal_head    = s(r[3]);
    const edition_name  = s(r[4]);
    const agency_type   = s(r[5]);
    const ag_code       = s(r[6]);
    const agency_name   = s(r[8]);
    const executive     = s(r[9]);
    const district      = s(r[12]);
    const city          = s(r[13]);
    const drop_point    = s(r[14]);
    const mobile_no     = s(r[18]);

    for (const { col, date } of dateCols) {
      const supply_date = rptDate || date;
      const copies_supplied = toInt(r[col]);

      if (supply_date) datesSeen.add(supply_date);

      // column order must match INSERT below
      dataRows.push([supply_date, ag_code, agency_name, unit_name, executive,
                     zonal_head, state_region, copies_supplied,
                     district, city, drop_point, edition_name, agency_type, mobile_no]);
    }
  }

  // Delete for dates seen
  for (const d of datesSeen) {
    await client.query('DELETE FROM daily_supply WHERE supply_date = $1', [d]);
  }

  const sql = `
    INSERT INTO daily_supply
      (supply_date, ag_code, agency_name, unit_name, executive,
       zonal_head, state_region, copies_supplied,
       district, city, drop_point, edition_name, agency_type, mobile_no)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (supply_date, ag_code) DO UPDATE SET
      agency_name     = EXCLUDED.agency_name,
      unit_name       = EXCLUDED.unit_name,
      executive       = EXCLUDED.executive,
      zonal_head      = EXCLUDED.zonal_head,
      state_region    = EXCLUDED.state_region,
      copies_supplied = EXCLUDED.copies_supplied,
      district        = EXCLUDED.district,
      city            = EXCLUDED.city,
      drop_point      = EXCLUDED.drop_point,
      edition_name    = EXCLUDED.edition_name,
      agency_type     = EXCLUDED.agency_type,
      mobile_no       = EXCLUDED.mobile_no
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  daily_supply: ${dataRows.length} rows upserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. import_daily_collection
// ═══════════════════════════════════════════════════════════════════════════════
const PAYMENT_MODE_MAP = {
  'NEFT/RTGS':                    'NEFT',
  'UPI/IMPS':                     'UPI',
  'QR CODE':                      'UPI',
  'PAYMENT GATWWAY':              'GATEWAY',
  'AGENT DEPOSIT CASH IN BANK':   'CASH',
  'EXECUTIVE CASH':               'CASH',
  'CHEQUE CMS':                   'CHEQUE',
};

function normalizePaymentMode(v) {
  const raw = s(v);
  if (!raw) return raw;
  const upper = raw.toUpperCase();
  return PAYMENT_MODE_MAP[upper] || raw;
}

async function import_daily_collection(client, rptDate = null) {
  const rows = readSheet('Collection Register.xlsx');
  const datesSeen = new Set();
  const dataRows = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Skip if date (col 5) empty or amount (col 17) null
    const coll_date_raw = r[5];
    if (!coll_date_raw) continue;
    const amount = toFloat(r[17]);
    if (amount === null) continue;

    const state        = s(r[1]);
    const district     = s(r[2]);
    const unit_name    = s(r[3]);
    const zonal_head   = s(r[4]);
    const coll_date    = rptDate || toDate(coll_date_raw);
    const receipt_no   = s(r[7]);
    const ag_code      = s(r[8]);
    const customer_name= s(r[10]);
    const drop_point   = s(r[11]);
    const payment_mode = normalizePaymentMode(r[12]);
    const mobile_no    = s(r[25]);
    const sale_type    = 'CREDIT';

    if (coll_date) datesSeen.add(coll_date);

    // column order must match INSERT below (14 columns, matches Python import)
    dataRows.push([coll_date, ag_code, customer_name, unit_name, null /* executive */,
                   zonal_head, state /* state_region */, amount, payment_mode, sale_type,
                   receipt_no, district, drop_point, mobile_no]);
  }

  // Delete for dates seen
  for (const d of datesSeen) {
    await client.query('DELETE FROM daily_collection WHERE collection_date = $1', [d]);
  }

  const sql = `
    INSERT INTO daily_collection
      (collection_date, ag_code, customer_name, unit_name, executive,
       zonal_head, state_region, amount, payment_mode, sale_type,
       receipt_no, district, drop_point, mobile_no)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `;
  await insertBatch(client, sql, dataRows);
  console.log(`  daily_collection: ${dataRows.length} rows inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════════
function parseArgs() {
  const args = process.argv.slice(2);
  let dateOverride = null;
  let fileFilter = 'all';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      dateOverride = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      fileFilter = args[++i].toLowerCase();
    }
  }
  return { dateOverride, fileFilter };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const { dateOverride, fileFilter } = parseArgs();

  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    await client.query('BEGIN');

    const run = (name) =>
      fileFilter === 'all' || fileFilter === name;

    if (run('hierarchy'))    await import_hierarchy_master(client);
    if (run('mapping'))      await import_hierarchy_mapping(client);
    if (run('dropmaster'))   await import_drop_points_master(client);
    if (run('delay'))        await import_taxi_delay_log(client, dateOverride);
    if (run('droplog'))      await import_drop_point_log(client, dateOverride);
    if (run('outstanding'))  await import_agency_outstanding(client);
    if (run('supply') || run('daily')) await import_daily_supply(client, dateOverride);
    if (run('collection'))   await import_daily_collection(client, dateOverride);

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
