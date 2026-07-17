/**
 * Migrate all data from PostgreSQL → MySQL
 * Run once: node api/pg_to_mysql.js
 */
require('dotenv').config();
const { Pool }  = require('pg');
const mysql     = require('mysql2/promise');

const pg = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'patrika_vitran',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function getMySQL() {
  return mysql.createConnection({
    host:     process.env.MYSQL_HOST     || 'localhost',
    port:     Number(process.env.MYSQL_PORT) || 3306,
    database: process.env.MYSQL_DB       || 'patrika_vitran',
    user:     process.env.MYSQL_USER     || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  });
}

function log(msg) { console.log(`[${new Date().toISOString().replace('T',' ').slice(0,19)}] ${msg}`); }

// Tables to migrate in order (respecting FK deps)
const TABLES = [
  {
    name: 'units',
    pgSql: 'SELECT unit_code, unit_name, comp_code FROM units',
    mysqlInsert: 'INSERT IGNORE INTO units (unit_code, unit_name, comp_code) VALUES (?,?,?)',
    map: r => [r.unit_code, r.unit_name, r.comp_code],
  },
  {
    name: 'zones',
    pgSql: 'SELECT id, name, region FROM zones',
    mysqlInsert: 'INSERT IGNORE INTO zones (id, name, region) VALUES (?,?,?)',
    map: r => [r.id, r.name, r.region],
  },
  {
    name: 'branches',
    pgSql: 'SELECT id, name, city, zone_id FROM branches',
    mysqlInsert: 'INSERT IGNORE INTO branches (id, name, city, zone_id) VALUES (?,?,?,?)',
    map: r => [r.id, r.name, r.city, r.zone_id],
  },
  {
    name: 'users',
    pgSql: 'SELECT id, mobile, password, name, role, district, hierarchy_level, manager_id, zone_id, branch_id, territory FROM users',
    mysqlInsert: 'INSERT IGNORE INTO users (id, mobile, password, name, role, district, hierarchy_level, manager_id, zone_id, branch_id, territory) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.mobile, r.password, r.name, r.role, r.district, r.hierarchy_level, r.manager_id, r.zone_id, r.branch_id, r.territory],
  },
  {
    name: 'hierarchy_master',
    pgSql: 'SELECT id, comp_code, unit_code, person_code, person_name, hierarchy_code, hierarchy_level, reporting_to, is_active, employee_code FROM hierarchy_master',
    mysqlInsert: 'INSERT IGNORE INTO hierarchy_master (id, comp_code, unit_code, person_code, person_name, hierarchy_code, hierarchy_level, reporting_to, is_active, employee_code) VALUES (?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.comp_code, r.unit_code, r.person_code, r.person_name, r.hierarchy_code, r.hierarchy_level, r.reporting_to, r.is_active ? 1 : 0, r.employee_code],
  },
  {
    name: 'hierarchy_mapping',
    pgSql: 'SELECT id, source_row_id, comp_code, unit_code, unit_name, exec_code, exec_name, exec_desig, edtn_incharge_code, edtn_incharge_name, circ_incharge_code, circ_incharge_name, zonal_head_code, zonal_head_name, vp_circulation_code, vp_circulation_name FROM hierarchy_mapping',
    mysqlInsert: 'INSERT IGNORE INTO hierarchy_mapping (id, source_row_id, comp_code, unit_code, unit_name, exec_code, exec_name, exec_desig, edtn_incharge_code, edtn_incharge_name, circ_incharge_code, circ_incharge_name, zonal_head_code, zonal_head_name, vp_circulation_code, vp_circulation_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.source_row_id, r.comp_code, r.unit_code, r.unit_name, r.exec_code, r.exec_name, r.exec_desig, r.edtn_incharge_code, r.edtn_incharge_name, r.circ_incharge_code, r.circ_incharge_name, r.zonal_head_code, r.zonal_head_name, r.vp_circulation_code, r.vp_circulation_name],
  },
  {
    name: 'routes',
    pgSql: 'SELECT route_code, route_name, unit_code, taxi_type FROM routes',
    mysqlInsert: 'INSERT IGNORE INTO routes (route_code, route_name, unit_code, taxi_type) VALUES (?,?,?,?)',
    map: r => [r.route_code, r.route_name, r.unit_code, r.taxi_type],
  },
  {
    name: 'drop_points_master',
    pgSql: 'SELECT drop_point_code, drop_point_name, unit_code, unit_name, driver_mobile, driver_name, taxi_id, vehicle_no, route_code, route_name, sub_route_code, sub_route_name, latitude, longitude, scheduled_arrival, last_seen_at FROM drop_points_master',
    mysqlInsert: 'INSERT IGNORE INTO drop_points_master (drop_point_code, drop_point_name, unit_code, unit_name, driver_mobile, driver_name, taxi_id, vehicle_no, route_code, route_name, sub_route_code, sub_route_name, latitude, longitude, scheduled_arrival, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.drop_point_code, r.drop_point_name, r.unit_code, r.unit_name, r.driver_mobile, r.driver_name, r.taxi_id, r.vehicle_no, r.route_code, r.route_name, r.sub_route_code, r.sub_route_name, r.latitude, r.longitude, r.scheduled_arrival, r.last_seen_at],
  },
  {
    name: 'taxi_delay_log',
    pgSql: 'SELECT id, report_date, unit_name, route_name, sub_route_name, taxi_type, bundles, supply, vehicle_no, is_regular, casual_reason, vehicle_name, vehicle_owner, driver_mobile, start_location, scheduled_departure, actual_departure, last_location, reached_time, allowed_time, time_taken, taxi_delayed, route_master_km, total_app_km FROM taxi_delay_log',
    mysqlInsert: 'INSERT IGNORE INTO taxi_delay_log (id, report_date, unit_name, route_name, sub_route_name, taxi_type, bundles, supply, vehicle_no, is_regular, casual_reason, vehicle_name, vehicle_owner, driver_mobile, start_location, scheduled_departure, actual_departure, last_location, reached_time, allowed_time, time_taken, taxi_delayed, route_master_km, total_app_km) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.report_date, r.unit_name, r.route_name, r.sub_route_name, r.taxi_type, r.bundles, r.supply, r.vehicle_no, r.is_regular ? 1 : 0, r.casual_reason, r.vehicle_name, r.vehicle_owner, r.driver_mobile, r.start_location, r.scheduled_departure, r.actual_departure, r.last_location, r.reached_time, r.allowed_time, r.time_taken, r.taxi_delayed, r.route_master_km, r.total_app_km],
  },
  {
    name: 'taxi_drop_point_log',
    pgSql: 'SELECT id, sup_date, unit_name, driver_mobile, vehicle_no, taxi_route_type, route_code, route_name, sub_route_code, sub_route_name, drop_point_name, no_of_packets, packet_drop_date, scheduled_arrival, actual_arrival, time_diff, taxi_id, reg_lat, reg_long, actual_lat, actual_long, dist_diff, route_master_km, return_km, actual_km, total_distance, duration, lat_long_addr, api_distance, vehicle_sharing, last_drop_point, dropping_lat_long FROM taxi_drop_point_log ORDER BY id',
    mysqlInsert: 'INSERT IGNORE INTO taxi_drop_point_log (id, sup_date, unit_name, driver_mobile, vehicle_no, taxi_route_type, route_code, route_name, sub_route_code, sub_route_name, drop_point_name, no_of_packets, packet_drop_date, scheduled_arrival, actual_arrival, time_diff, taxi_id, reg_lat, reg_long, actual_lat, actual_long, dist_diff, route_master_km, return_km, actual_km, total_distance, duration, lat_long_addr, api_distance, vehicle_sharing, last_drop_point, dropping_lat_long) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.sup_date, r.unit_name, r.driver_mobile, r.vehicle_no, r.taxi_route_type, r.route_code, r.route_name, r.sub_route_code, r.sub_route_name, r.drop_point_name, r.no_of_packets, r.packet_drop_date, r.scheduled_arrival, r.actual_arrival, r.time_diff, r.taxi_id, r.reg_lat, r.reg_long, r.actual_lat, r.actual_long, r.dist_diff, r.route_master_km, r.return_km, r.actual_km, r.total_distance, r.duration, r.lat_long_addr, r.api_distance, r.vehicle_sharing ? 1 : 0, r.last_drop_point, r.dropping_lat_long],
    batchSize: 500,
  },
  {
    name: 'daily_supply',
    pgSql: 'SELECT id, report_date, unit_name, route_code, route_name, edition, supply_count, supplied_by, vehicle_no, remarks, zone_id, branch_id FROM daily_supply',
    mysqlInsert: 'INSERT IGNORE INTO daily_supply (id, report_date, unit_name, route_code, route_name, edition, supply_count, supplied_by, vehicle_no, remarks, zone_id, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.report_date, r.unit_name, r.route_code, r.route_name, r.edition, r.supply_count, r.supplied_by, r.vehicle_no, r.remarks, r.zone_id, r.branch_id],
  },
  {
    name: 'daily_collection',
    pgSql: 'SELECT id, report_date, unit_name, collected_by, amount, payment_mode, reference_no, customer_name, remarks, zone_id, branch_id FROM daily_collection',
    mysqlInsert: 'INSERT IGNORE INTO daily_collection (id, report_date, unit_name, collected_by, amount, payment_mode, reference_no, customer_name, remarks, zone_id, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.report_date, r.unit_name, r.collected_by, r.amount, r.payment_mode, r.reference_no, r.customer_name, r.remarks, r.zone_id, r.branch_id],
  },
  {
    name: 'agency_outstanding',
    pgSql: 'SELECT id, report_date, unit_name, agency_name, opening_balance, supply_amount, collection, closing_balance FROM agency_outstanding',
    mysqlInsert: 'INSERT IGNORE INTO agency_outstanding (id, report_date, unit_name, agency_name, opening_balance, supply_amount, collection, closing_balance) VALUES (?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.report_date, r.unit_name, r.agency_name, r.opening_balance, r.supply_amount, r.collection, r.closing_balance],
  },
  {
    name: 'customers',
    pgSql: 'SELECT id, name, mobile, address, district, edition, plan, start_date, end_date, zone_id, branch_id FROM customers',
    mysqlInsert: 'INSERT IGNORE INTO customers (id, name, mobile, address, district, edition, plan, start_date, end_date, zone_id, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.name, r.mobile, r.address, r.district, r.edition, r.plan, r.start_date, r.end_date, r.zone_id, r.branch_id],
  },
  {
    name: 'leads',
    pgSql: 'SELECT id, name, mobile, address, district, source, status, assigned_to, zone_id, branch_id FROM leads',
    mysqlInsert: 'INSERT IGNORE INTO leads (id, name, mobile, address, district, source, status, assigned_to, zone_id, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.name, r.mobile, r.address, r.district, r.source, r.status, r.assigned_to, r.zone_id, r.branch_id],
  },
  {
    name: 'complaints',
    pgSql: 'SELECT id, customer_id, complaint, status, resolved_at, resolved_by, zone_id, branch_id FROM complaints',
    mysqlInsert: 'INSERT IGNORE INTO complaints (id, customer_id, complaint, status, resolved_at, resolved_by, zone_id, branch_id) VALUES (?,?,?,?,?,?,?,?)',
    map: r => [r.id, r.customer_id, r.complaint, r.status, r.resolved_at, r.resolved_by, r.zone_id, r.branch_id],
  },
  {
    name: 'payments',
    pgSql: 'SELECT id, customer_id, amount, paid_at, mode, reference FROM payments',
    mysqlInsert: 'INSERT IGNORE INTO payments (id, customer_id, amount, paid_at, mode, reference) VALUES (?,?,?,?,?,?)',
    map: r => [r.id, r.customer_id, r.amount, r.paid_at, r.mode, r.reference],
  },
];

async function migrateTable(my, table) {
  const batchSize = table.batchSize || 1000;
  const { rows } = await pg.query(table.pgSql);
  if (rows.length === 0) { log(`  ${table.name}: 0 rows — skip`); return; }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(table.map);
    await my.query(table.mysqlInsert, batch.flat()).catch(async () => {
      // Fallback: row-by-row on batch error
      for (const params of batch) {
        await my.query(table.mysqlInsert, params).catch(() => {});
        inserted++;
      }
      return;
    });
    inserted += batch.length;
    if (rows.length > 5000) process.stdout.write(`\r  ${table.name}: ${inserted}/${rows.length}`);
  }
  if (rows.length > 5000) process.stdout.write('\n');
  log(`  ${table.name}: ${inserted} rows migrated`);
}

(async () => {
  log('=== PostgreSQL → MySQL migration started ===');
  const my = await getMySQL();
  await my.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const table of TABLES) {
    log(`Migrating ${table.name}...`);
    await migrateTable(my, table);
  }

  await my.query('SET FOREIGN_KEY_CHECKS = 1');
  log('=== Migration complete ===');

  // Summary
  const [rows] = await my.query(`
    SELECT TABLE_NAME, TABLE_ROWS
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = 'patrika_vitran'
    ORDER BY TABLE_ROWS DESC
  `);
  console.table(rows.map(r => ({ table: r.TABLE_NAME, rows: r.TABLE_ROWS })));

  await my.end();
  await pg.end();
})().catch(err => { console.error(err); process.exit(1); });
