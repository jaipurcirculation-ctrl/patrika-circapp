'use strict';

/**
 * oracle_bulk_sync.js — Bulk-import a date range from Oracle ERP → PostgreSQL
 *
 * Runs a single Oracle query for the full range (avoids per-date sqlplus overhead),
 * overwrites any existing records for those dates.
 *
 * Usage:
 *   node api/oracle_bulk_sync.js --from 2026-04-01 --to 2026-07-17
 *   node api/oracle_bulk_sync.js --from 2026-04-01          # to = today
 */

const { spawn } = require('child_process');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SQLPLUS = process.env.SQLPLUS_PATH ||
  'C:\\oraclexe\\app\\oracle\\product\\11.2.0\\server\\bin\\sqlplus.exe';

const PG_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'patrika_vitran',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

const LOG_FILE = path.resolve(__dirname, '../logs/oracle_sync.log');
const SEP = '\x1c'; // ASCII 28 — field separator (never appears in data)

// ── Logger ────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

// ── Parse CLI args ────────────────────────────────────────────────────────────
function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function getDateRange() {
  const from = getArg('--from');
  const toArg = getArg('--to');

  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    console.error('Usage: node api/oracle_bulk_sync.js --from YYYY-MM-DD [--to YYYY-MM-DD]');
    process.exit(1);
  }

  let to = toArg;
  if (!to) {
    const d = new Date();
    to = d.toISOString().substring(0, 10);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error('--to must be YYYY-MM-DD');
    process.exit(1);
  }

  if (from > to) {
    console.error('--from must be before --to');
    process.exit(1);
  }

  return { from, to };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function str(v) {
  if (v === null || v === undefined) return null;
  const r = String(v).trim();
  return r === '' ? null : r;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function toInt(v) {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function toDate(v) {
  const t = str(v);
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  return null;
}

function toTime(v) {
  const t = str(v);
  if (!t) return null;
  let m = t.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}`;
  m = t.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:00`;
  return null;
}

function toInterval(v) {
  const t = str(v);
  if (!t) return null;
  const m = t.match(/^(-?)(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return null;
  const neg = m[1] === '-';
  const totalSec = parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
  const h  = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mi = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const sc = String(totalSec % 60).padStart(2, '0');
  return `${neg ? '-' : ''}${h}:${mi}:${sc}`;
}

// ── Build Oracle SQL for the date range ───────────────────────────────────────
function buildSqlScript(fromDate, toDate, spoolFile) {
  const D = `CHR(28)`;
  const fields = [
    'q.unit_name',
    'q.supdate',
    'q.driver_code',
    'q.vehicle_no',
    'q.taxi_stat',
    'q.route_code',
    'q.rtnm',
    'q.subrt_code',
    'q.sub_route_name',
    'q.drop_point_name',
    'q.no_of_packets',
    'q.packet_drop_date',
    'q.reg_drop_time',
    'q.packet_drop_time',
    'q.time_diff',
    'q.taxi_id',
    'q.registered_latitude',
    'q.registered_longitude',
    'q.drop_lattitude',
    'q.drop_longitude',
    'q.diff_distance',
    'q.route_master_km',
    'q.return_km',
    'q.actual_km',
    'q.tot_dist',
    'SUBSTR(q.lat_long_addr,1,500)',
    'q.vehicle_sharing_flag',
    'q.droping_latlong',
  ].join(` || ${D} || `);

  return `SET PAGESIZE 0
SET LINESIZE 32767
SET LONG 100000
SET FEEDBACK OFF
SET HEADING OFF
SET ECHO OFF
SET VERIFY OFF
SET TRIMSPOOL ON
SET TRIMOUT ON
SET TERMOUT OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE
SPOOL ${spoolFile}
SELECT REPLACE(REPLACE(${fields}, CHR(10), ' '), CHR(13), ' ')
FROM (
  select x.comp_code, x.unit_code, x.unit_name, to_char(x.supdate,'dd/mm/yyyy') supdate,
      x.driver_code, x.driver_name, x.route_code, x.rtnm, x.drop_point_code, x.drop_point_name,
      x.no_of_packets, x.app_time reg_drop_time, x.packet_drop_time,
      time_diff(x.app_time, x.packet_drop_time) TIME_DIFF,
      case when x.subrt_code is not null then
          (select SUBRT_DIST from cir_sub_route_mast where comp_code = x.comp_code and unit = x.unit_code and route_code = x.route_code and subrt_code = x.subrt_code)
      else
          (select ROUTE_DIST from cir_route_mast where comp_code = x.comp_code and unit = x.unit_code and route_code = x.route_code)
      end Route_Master_Km,
      case when (x.lattitude != 0 or x.lattitude != '') then
          app_driver_calc_drop_distance (x.comp_code, x.unit_code, x.taxi_id, x.supdate, x.driver_code, x.route_code, x.subrt_code, x.unq_id)
      else 0 end as Actual_Km,
      x.taxi_id, x.packet_drop_date,
      x.registered_latitude, x.registered_longitude, x.lattitude drop_lattitude, x.longitude drop_longitude,
      case when (x.lattitude != '0' and x.lattitude != '' and nvl(x.registered_latitude,'0')<>'0' and nvl(x.registered_longitude,'0')<>'0') then
        case when round(nvl(x.registered_latitude,'0'),6) = round(nvl(x.lattitude,'0'),6) and round(nvl(x.registered_longitude,'0'),6) = round(nvl(x.longitude,'0'),6) then 0
        else round(calc_distance (round(nvl(x.registered_latitude,0),6), round(nvl(x.registered_longitude,0),6), round(nvl(x.lattitude,0),6), round(nvl(x.longitude,0),6)),2)
        end
      else 0 end as diff_distance,
      x.unq_id, x.vehicle_no, x.LAT_LONG_ADDR, x.RETURN_KM, x.taxi_stat, x.SUBRT_CODE, x.SUB_ROUTE_NAME,
      app_driver_calc_route_distance (x.comp_code, x.unit_code, x.taxi_id, x.supdate, x.driver_code, x.route_code, x.SUBRT_CODE) TOT_DIST,
      app_driver_prev_dp_latlong (x.comp_code, x.unit_code, x.taxi_id, x.supdate, x.driver_code, x.route_code, x.SUBRT_CODE, x.unq_id, 'BOTH', ';') droping_latlong,
      x.MAPS_ROUTE_ZONE, x.VEHICLE_SHARING_FLAG
  from
  (select a.comp_code, a.unit_code, get_unit_name(a.comp_code, a.unit_code) unit_name, a.supdate,
      a.driver_code, a.driver_name, a.route_code, a.rtnm, a.drop_point_code, a.drop_point drop_point_name,
      nvl(sum(a.packet),0) no_of_packets, a.APP_TIME, a.dep_time packet_drop_time, a.taxi_id, a.trans_code,
      a.lattitude, a.longitude,
      (select latitude from cir_drop_point_mast where comp_code = a.comp_code and unit_code = a.unit_code
          and drop_point = a.drop_point_code) registered_latitude,
      (select lognitude from cir_drop_point_mast where comp_code = a.comp_code and unit_code = a.unit_code
          and drop_point = a.drop_point_code) registered_longitude,
      to_char(created_date,'dd/mm/yyyy') packet_drop_date, min(a.unq_id) unq_id,
      (select vehicle_no from cir_taxi_mast where comp_code = a.comp_code and
          unit_code = a.unit_code and rt_code = a.route_code and taxi_id = a.taxi_id) vehicle_no,
      trunc(created_date) created_date,
      sum(a.DISTANCE_PREV_DP) DISTANCE_PREV_DP, LAT_LONG_ADDR,
      (select RETURN_KM from cir_taxi_mast where comp_code = a.comp_code and
          unit_code = a.unit_code and taxi_id = a.taxi_id) RETURN_KM,
      case when (select nvl(SUBRT_CODE,'#') from cir_taxi_mast where comp_code = a.comp_code and
          unit_code = a.unit_code and rt_code = a.route_code and taxi_id = a.taxi_id) != '#' then 'LINK'
      else 'MAIN' end as TAXI_STAT,
      a.SUBRT_CODE,
      cir_get_subroute_name (a.comp_code, a.unit_code, a.route_code, a.SUBRT_CODE) as SUB_ROUTE_NAME,
      nvl((select MAPS_ROUTE_ZONE from cir_route_mast where comp_code = a.comp_code and unit = a.unit_code and route_code = a.route_code),'N') MAPS_ROUTE_ZONE,
      (select VEHICLE_SHARING_FLAG from cir_taxi_mast where comp_code = a.comp_code and unit_code = a.unit_code and rt_code = a.route_code and
          taxi_id = a.taxi_id) VEHICLE_SHARING_FLAG
  from app_driver_daily a
  where a.comp_code = 'RP001'
    and a.supdate BETWEEN TO_DATE('${fromDate}','YYYY-MM-DD') AND TO_DATE('${toDate}','YYYY-MM-DD')
  group by a.comp_code, a.unit_code, a.supdate,
      a.driver_code, a.driver_name, a.route_code, a.rtnm, a.drop_point_code, a.drop_point,
      a.APP_TIME, a.dep_time, a.taxi_id, a.trans_code, a.LATTITUDE, a.LONGITUDE,
      to_char(created_date,'dd/mm/yyyy'), trunc(created_date), LAT_LONG_ADDR, a.SUBRT_CODE
  ) x
) q
ORDER BY q.supdate;
SPOOL OFF
EXIT
`;
}

// ── Run sqlplus via /nolog + CONNECT (credentials never written to disk) ─────
function runSqlplus(sqlFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(SQLPLUS, ['-L', '-S', '/nolog'], {
      env: { ...process.env, NLS_LANG: 'AMERICAN_AMERICA.AL32UTF8' },
      windowsHide: true,
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      // Oracle/sqlplus errors can slip through with exit code 0 (SQL.SQLCODE
      // is truncated to 8 bits), so scan output for error markers too.
      const errMatch = (stdout + stderr).match(/ORA-\d{5}[^\r\n]*|SP2-\d{4}[^\r\n]*|TNS-\d{5}[^\r\n]*/);
      if (code === 0 && !errMatch) resolve({ stdout, stderr });
      else reject(new Error(`sqlplus failed (exit ${code})${errMatch ? ': ' + errMatch[0] : ''}\n${stdout.slice(0, 500)}\n${stderr.slice(0, 500)}`));
    });

    const connectString =
      `${process.env.ORA_USER}/${process.env.ORA_PASSWORD}@//` +
      `${process.env.ORA_HOST}:${process.env.ORA_PORT || 1521}/${process.env.ORA_SERVICE}`;

    proc.stdin.write(`CONNECT ${connectString}\n`);
    proc.stdin.write(`@"${sqlFile}"\n`);
    proc.stdin.write('EXIT\n');
    proc.stdin.end();
  });
}

// ── Map parsed fields → 31 PostgreSQL parameters ─────────────────────────────
function lineToParams(f) {
  return [
    str(f[0]),                 //  1. unit_name
    toDate(f[1]),              //  2. sup_date       (DD/MM/YYYY → YYYY-MM-DD)
    str(f[2]),                 //  3. driver_mobile  (driver code from ERP)
    str(f[3]),                 //  4. vehicle_no
    str(f[4]),                 //  5. taxi_route_type (MAIN / LINK)
    str(f[5]),                 //  6. route_code
    str(f[6]),                 //  7. route_name
    str(f[7]),                 //  8. sub_route_code
    str(f[8]),                 //  9. sub_route_name
    str(f[9]),                 // 10. drop_point_name
    toInt(f[10]),              // 11. no_of_packets
    toDate(f[11]),             // 12. packet_drop_date
    toTime(f[12]),             // 13. scheduled_arrival
    toTime(f[13]),             // 14. actual_arrival
    toInterval(f[14]),         // 15. time_diff
    str(f[15]),                // 16. taxi_id
    num(f[16]),                // 17. reg_lat
    num(f[17]),                // 18. reg_long
    num(f[18]),                // 19. actual_lat
    num(f[19]),                // 20. actual_long
    num(f[20]),                // 21. dist_diff
    num(f[21]),                // 22. route_master_km
    num(f[22]),                // 23. return_km
    num(f[23]),                // 24. actual_km
    num(f[24]),                // 25. total_distance
    null,                      // 26. duration       (not in ERP query)
    str(f[25]),                // 27. lat_long_addr
    null,                      // 28. api_distance   (not in ERP query)
    str(f[26]) === 'Y',        // 29. vehicle_sharing
    null,                      // 30. last_drop_point (not in ERP query)
    str(f[27]),                // 31. dropping_lat_long
  ];
}

// ── Date helpers for chunking ────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

function buildChunks(from, to, chunkDays) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    let end = addDays(start, chunkDays - 1);
    if (end > to) end = to;
    chunks.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return chunks;
}

// ── Sync one chunk: Oracle query → parse → overwrite in PostgreSQL ───────────
async function syncChunk(pgClient, chunk, tmpDir, chunkNo, totalChunks) {
  const sqlFile   = path.join(tmpDir, `query_${chunkNo}.sql`);
  const spoolFile = path.join(tmpDir, `data_${chunkNo}.txt`);

  fs.writeFileSync(sqlFile, buildSqlScript(chunk.from, chunk.to, spoolFile), 'utf8');
  log(`[chunk ${chunkNo}/${totalChunks}] Querying Oracle: ${chunk.from} → ${chunk.to} ...`);

  const startOracle = Date.now();
  await runSqlplus(sqlFile);
  const oracleSecs = Math.round((Date.now() - startOracle) / 1000);

  if (!fs.existsSync(spoolFile)) {
    throw new Error('sqlplus produced no spool file');
  }

  const raw = fs.readFileSync(spoolFile, 'utf8');

  // Errors can land in the spool with exit code 0 — treat them as failure
  const spoolErr = raw.match(/ORA-\d{5}[^\r\n]*|SP2-\d{4}[^\r\n]*/);
  if (spoolErr) throw new Error(`Oracle error in output: ${spoolErr[0]}`);

  const lines = raw.split(/\r?\n/).filter(l => l.includes(SEP));
  log(`[chunk ${chunkNo}/${totalChunks}] Oracle returned ${lines.length} rows in ${oracleSecs}s`);

  // SAFETY: never wipe existing data when Oracle returns nothing —
  // a legitimate all-empty range is rare; a silent failure is not.
  if (lines.length === 0) {
    log(`[chunk ${chunkNo}/${totalChunks}] 0 rows returned — keeping existing data for this range (no delete)`);
    return { inserted: 0, errors: 0 };
  }

  const parsed   = [];
  const routeMap = new Map();
  let badLines = 0;
  for (const line of lines) {
    const f = line.split(SEP);
    if (f.length !== 28) { badLines++; continue; }
    parsed.push(f);
    const rc = str(f[5]), rn = str(f[6]);
    if (rc && rn) routeMap.set(rc, rn);
  }
  if (badLines > 0) log(`[chunk ${chunkNo}/${totalChunks}] WARNING: skipped ${badLines} malformed lines`);

  // Overwrite chunk range in a single transaction
  await pgClient.query('BEGIN');
  try {
    const delRes = await pgClient.query(
      'DELETE FROM taxi_drop_point_log WHERE sup_date BETWEEN $1 AND $2',
      [chunk.from, chunk.to]
    );

    for (const [rc, rn] of routeMap) {
      await pgClient.query(
        `INSERT INTO routes (route_code, route_name)
         VALUES ($1,$2)
         ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name`,
        [rc, rn]
      );
    }

    const insertSQL = `
      INSERT INTO taxi_drop_point_log
        (unit_name, sup_date, driver_mobile, vehicle_no, taxi_route_type,
         route_code, route_name, sub_route_code, sub_route_name,
         drop_point_name, no_of_packets, packet_drop_date,
         scheduled_arrival, actual_arrival, time_diff,
         taxi_id, reg_lat, reg_long, actual_lat, actual_long,
         dist_diff, route_master_km, return_km, actual_km,
         total_distance, duration, lat_long_addr, api_distance,
         vehicle_sharing, last_drop_point, dropping_lat_long)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
              $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
    `;

    let inserted = 0, errors = 0;
    for (const f of parsed) {
      try {
        await pgClient.query(insertSQL, lineToParams(f));
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  Row error: ${err.message} — date:${f[1]} route:${f[5]}`);
      }
    }

    await pgClient.query('COMMIT');
    log(`[chunk ${chunkNo}/${totalChunks}] Replaced ${delRes.rowCount} old rows with ${inserted} new rows` +
        (errors > 0 ? ` (${errors} row errors)` : ''));
    return { inserted, errors };
  } catch (err) {
    try { await pgClient.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    try { fs.unlinkSync(sqlFile); } catch (_) {}
    try { fs.unlinkSync(spoolFile); } catch (_) {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { from, to } = getDateRange();
  const CHUNK_DAYS = parseInt(getArg('--chunk-days') || '10', 10);

  const chunks = buildChunks(from, to, CHUNK_DAYS);
  const days = chunks.reduce((n, c) =>
    n + Math.round((new Date(c.to) - new Date(c.from)) / 86400000) + 1, 0);

  log(`=== Oracle bulk sync started | ${from} → ${to} (${days} days, ${chunks.length} chunks of ≤${CHUNK_DAYS} days) ===`);

  for (const k of ['ORA_HOST', 'ORA_SERVICE', 'ORA_USER', 'ORA_PASSWORD']) {
    if (!process.env[k]) { log(`ERROR: ${k} not set in .env`); process.exit(1); }
  }
  if (!fs.existsSync(SQLPLUS)) {
    log(`ERROR: sqlplus not found at ${SQLPLUS}`); process.exit(1);
  }

  const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'patrika-bulk-'));
  const pgClient = new Client(PG_CONFIG);

  let totalInserted = 0, totalErrors = 0;
  const failedChunks = [];

  try {
    await pgClient.connect();

    const MAX_ATTEMPTS = 3;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let done = false;

      // Retry with backoff — after ORA-3113 the Oracle server needs recovery time
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
        try {
          const r = await syncChunk(pgClient, chunk, tmpDir, i + 1, chunks.length);
          totalInserted += r.inserted;
          totalErrors   += r.errors;
          done = true;
        } catch (err) {
          log(`[chunk ${i + 1}/${chunks.length}] attempt ${attempt} FAILED: ${err.message.split('\n')[0]}`);
          if (attempt === MAX_ATTEMPTS) {
            failedChunks.push(chunk);
          } else {
            const waitSec = attempt * 60;
            log(`  waiting ${waitSec}s before retry ...`);
            await sleep(waitSec * 1000);
          }
        }
      }
    }

    if (failedChunks.length > 0) {
      log(`=== Bulk sync finished WITH FAILURES: ${totalInserted} rows inserted; failed ranges: ` +
          failedChunks.map(c => `${c.from}→${c.to}`).join(', ') + ' ===');
      process.exitCode = 1;
    } else {
      log(`=== Bulk sync complete: ${from} → ${to} | ${totalInserted} rows inserted` +
          (totalErrors > 0 ? ` (${totalErrors} row errors)` : '') + ' ===');
    }

  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    try { await pgClient.end(); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main();
