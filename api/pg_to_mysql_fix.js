/**
 * Fix taxi_drop_point_log and other low-count tables in MySQL
 * Uses correct mysql2 bulk-insert: INSERT INTO t (cols) VALUES ?  with [[row], [row], ...]
 */
require('dotenv').config();
const { Pool } = require('pg');
const mysql    = require('mysql2/promise');

const pg = new Pool({
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'patrika_vitran',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '',
});

async function getMySQL() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost', port: Number(process.env.MYSQL_PORT) || 3306,
    database: process.env.MYSQL_DB || 'patrika_vitran',
    user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
  });
}

function log(msg) { console.log(`[${new Date().toISOString().replace('T',' ').slice(0,19)}] ${msg}`); }

// Tables that need re-migration with correct bulk INSERT syntax
const TABLES = [
  {
    name: 'taxi_drop_point_log',
    truncate: true,
    pgSql: 'SELECT id,sup_date,unit_name,driver_mobile,vehicle_no,taxi_route_type,route_code,route_name,sub_route_code,sub_route_name,drop_point_name,no_of_packets,packet_drop_date,scheduled_arrival,actual_arrival,time_diff,taxi_id,reg_lat,reg_long,actual_lat,actual_long,dist_diff,route_master_km,return_km,actual_km,total_distance,duration,lat_long_addr,api_distance,vehicle_sharing,last_drop_point,dropping_lat_long FROM taxi_drop_point_log ORDER BY id',
    cols: 'id,sup_date,unit_name,driver_mobile,vehicle_no,taxi_route_type,route_code,route_name,sub_route_code,sub_route_name,drop_point_name,no_of_packets,packet_drop_date,scheduled_arrival,actual_arrival,time_diff,taxi_id,reg_lat,reg_long,actual_lat,actual_long,dist_diff,route_master_km,return_km,actual_km,total_distance,duration,lat_long_addr,api_distance,vehicle_sharing,last_drop_point,dropping_lat_long',
    map: r => [r.id,r.sup_date,r.unit_name,r.driver_mobile,r.vehicle_no,r.taxi_route_type,r.route_code,r.route_name,r.sub_route_code,r.sub_route_name,r.drop_point_name,r.no_of_packets,r.packet_drop_date,r.scheduled_arrival,r.actual_arrival,r.time_diff,r.taxi_id,r.reg_lat,r.reg_long,r.actual_lat,r.actual_long,r.dist_diff,r.route_master_km,r.return_km,r.actual_km,r.total_distance,r.duration,r.lat_long_addr,r.api_distance,r.vehicle_sharing?1:0,r.last_drop_point,r.dropping_lat_long],
    batchSize: 1000,
  },
  {
    name: 'hierarchy_mapping',
    truncate: true,
    pgSql: 'SELECT id,source_row_id,comp_code,unit_code,unit_name,exec_code,exec_name,exec_desig,edtn_incharge_code,edtn_incharge_name,circ_incharge_code,circ_incharge_name,zonal_head_code,zonal_head_name,vp_circulation_code,vp_circulation_name FROM hierarchy_mapping',
    cols: 'id,source_row_id,comp_code,unit_code,unit_name,exec_code,exec_name,exec_desig,edtn_incharge_code,edtn_incharge_name,circ_incharge_code,circ_incharge_name,zonal_head_code,zonal_head_name,vp_circulation_code,vp_circulation_name',
    map: r => [r.id,r.source_row_id,r.comp_code,r.unit_code,r.unit_name,r.exec_code,r.exec_name,r.exec_desig,r.edtn_incharge_code,r.edtn_incharge_name,r.circ_incharge_code,r.circ_incharge_name,r.zonal_head_code,r.zonal_head_name,r.vp_circulation_code,r.vp_circulation_name],
    batchSize: 500,
  },
  {
    name: 'hierarchy_master',
    truncate: true,
    pgSql: 'SELECT id,comp_code,unit_code,person_code,person_name,hierarchy_code,hierarchy_level,reporting_to,is_active,employee_code FROM hierarchy_master',
    cols: 'id,comp_code,unit_code,person_code,person_name,hierarchy_code,hierarchy_level,reporting_to,is_active,employee_code',
    map: r => [r.id,r.comp_code,r.unit_code,r.person_code,r.person_name,r.hierarchy_code,r.hierarchy_level,r.reporting_to,r.is_active?1:0,r.employee_code],
    batchSize: 500,
  },
  {
    name: 'drop_points_master',
    truncate: true,
    pgSql: 'SELECT drop_point_code,drop_point_name,unit_code,unit_name,driver_mobile,driver_name,taxi_id,vehicle_no,route_code,route_name,sub_route_code,sub_route_name,latitude,longitude,scheduled_arrival,last_seen_at FROM drop_points_master',
    cols: 'drop_point_code,drop_point_name,unit_code,unit_name,driver_mobile,driver_name,taxi_id,vehicle_no,route_code,route_name,sub_route_code,sub_route_name,latitude,longitude,scheduled_arrival,last_seen_at',
    map: r => [r.drop_point_code,r.drop_point_name,r.unit_code,r.unit_name,r.driver_mobile,r.driver_name,r.taxi_id,r.vehicle_no,r.route_code,r.route_name,r.sub_route_code,r.sub_route_name,r.latitude,r.longitude,r.scheduled_arrival,r.last_seen_at],
    batchSize: 500,
  },
  {
    name: 'routes',
    truncate: true,
    pgSql: 'SELECT route_code,route_name,unit_code,taxi_type FROM routes',
    cols: 'route_code,route_name,unit_code,taxi_type',
    map: r => [r.route_code,r.route_name,r.unit_code,r.taxi_type],
    batchSize: 500,
  },
  {
    name: 'units',
    truncate: true,
    pgSql: 'SELECT unit_code,unit_name,comp_code FROM units',
    cols: 'unit_code,unit_name,comp_code',
    map: r => [r.unit_code,r.unit_name,r.comp_code],
    batchSize: 500,
  },
];

async function migrateTable(my, table) {
  const { rows } = await pg.query(table.pgSql);
  log(`  ${table.name}: ${rows.length} rows from PostgreSQL`);
  if (rows.length === 0) return;

  if (table.truncate) {
    await my.query(`TRUNCATE TABLE ${table.name}`);
  }

  const batchSize = table.batchSize || 1000;
  let inserted = 0;
  const sql = `INSERT INTO ${table.name} (${table.cols}) VALUES ?`;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(table.map);
    await my.query(sql, [batch]);
    inserted += batch.length;
    if (rows.length > 5000) process.stdout.write(`\r  ${table.name}: ${inserted}/${rows.length}`);
  }
  if (rows.length > 5000) process.stdout.write('\n');
  log(`  ${table.name}: ${inserted} rows inserted`);
}

(async () => {
  log('=== Re-migrating tables with correct bulk insert ===');
  const my = await getMySQL();
  await my.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const table of TABLES) {
    log(`Migrating ${table.name}...`);
    await migrateTable(my, table);
  }

  await my.query('SET FOREIGN_KEY_CHECKS = 1');

  // Actual counts
  const tables = ['taxi_drop_point_log','hierarchy_mapping','hierarchy_master','drop_points_master','routes','units','agency_outstanding','daily_supply','daily_collection'];
  log('\n=== Verified row counts ===');
  for (const t of tables) {
    const [[r]] = await my.query(`SELECT COUNT(*) AS cnt FROM ${t}`);
    console.log(`  ${t.padEnd(25)} ${r.cnt}`);
  }

  log('=== Done ===');
  await my.end(); await pg.end();
})().catch(e => { console.error(e); process.exit(1); });
