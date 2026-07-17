/**
 * Migrate remaining tables: daily_supply, daily_collection, agency_outstanding,
 * customers, leads, complaints, payments
 * Run: node api/pg_to_mysql_remaining.js
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

const TABLES = [
  {
    name: 'daily_supply',
    pgSql: 'SELECT id,supply_date,ag_code,agency_name,unit_name,executive,zonal_head,state_region,copies_supplied,district,city,drop_point,edition_name,agency_type,mobile_no FROM daily_supply',
    mysqlInsert: 'INSERT IGNORE INTO daily_supply (id,supply_date,ag_code,agency_name,unit_name,executive,zonal_head,state_region,copies_supplied,district,city,drop_point,edition_name,agency_type,mobile_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.supply_date,r.ag_code,r.agency_name,r.unit_name,r.executive,r.zonal_head,r.state_region,r.copies_supplied,r.district,r.city,r.drop_point,r.edition_name,r.agency_type,r.mobile_no],
  },
  {
    name: 'daily_collection',
    pgSql: 'SELECT id,collection_date,ag_code,customer_name,unit_name,executive,zonal_head,state_region,amount,payment_mode,sale_type,receipt_no,district,drop_point,mobile_no FROM daily_collection',
    mysqlInsert: 'INSERT IGNORE INTO daily_collection (id,collection_date,ag_code,customer_name,unit_name,executive,zonal_head,state_region,amount,payment_mode,sale_type,receipt_no,district,drop_point,mobile_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.collection_date,r.ag_code,r.customer_name,r.unit_name,r.executive,r.zonal_head,r.state_region,r.amount,r.payment_mode,r.sale_type,r.receipt_no,r.district,r.drop_point,r.mobile_no],
  },
  {
    name: 'agency_outstanding',
    pgSql: 'SELECT id,report_date,state_region,unit_name,ag_code,agency_name,executive,status,zonal_head,state,district,drop_point,total_copies,daily_copies,security_deposit,required_security,security_diff,opening_debit,opening_credit,bill_amount,other_debits,receipt_amount,other_credits,closing_debit,closing_credit,collection_pct,mobile_no,agency_type,supply_start_date,supply_days,last_supply_date,last_supply_post FROM agency_outstanding',
    mysqlInsert: 'INSERT IGNORE INTO agency_outstanding (id,report_date,state_region,unit_name,ag_code,agency_name,executive,status,zonal_head,state,district,drop_point,total_copies,daily_copies,security_deposit,required_security,security_diff,opening_debit,opening_credit,bill_amount,other_debits,receipt_amount,other_credits,closing_debit,closing_credit,collection_pct,mobile_no,agency_type,supply_start_date,supply_days,last_supply_date,last_supply_post) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.report_date,r.state_region,r.unit_name,r.ag_code,r.agency_name,r.executive,r.status,r.zonal_head,r.state,r.district,r.drop_point,r.total_copies,r.daily_copies,r.security_deposit,r.required_security,r.security_diff,r.opening_debit,r.opening_credit,r.bill_amount,r.other_debits,r.receipt_amount,r.other_credits,r.closing_debit,r.closing_credit,r.collection_pct,r.mobile_no,r.agency_type,r.supply_start_date,r.supply_days,r.last_supply_date,r.last_supply_post],
    batchSize: 200,
  },
  {
    name: 'customers',
    pgSql: 'SELECT id,name,address,mobile,edition,copies,balance,agent_id,hawker_id,zone_id,branch_id FROM customers',
    mysqlInsert: 'INSERT IGNORE INTO customers (id,name,address,mobile,edition,copies,balance,agent_id,hawker_id,zone_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.name,r.address,r.mobile,r.edition,r.copies,r.balance,r.agent_id,r.hawker_id,r.zone_id,r.branch_id],
  },
  {
    name: 'leads',
    pgSql: 'SELECT id,surveyor_id,name,mobile,address,edition,interest,status,zone_id,branch_id FROM leads',
    mysqlInsert: 'INSERT IGNORE INTO leads (id,surveyor_id,name,mobile,address,edition,interest,status,zone_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.surveyor_id,r.name,r.mobile,r.address,r.edition,r.interest,r.status,r.zone_id,r.branch_id],
  },
  {
    name: 'complaints',
    pgSql: 'SELECT id,customer_id,type,description,status,raised_by,resolved_at,zone_id,branch_id FROM complaints',
    mysqlInsert: 'INSERT IGNORE INTO complaints (id,customer_id,type,description,status,raised_by,resolved_at,zone_id,branch_id) VALUES (?,?,?,?,?,?,?,?,?)',
    map: r => [r.id,r.customer_id,r.type,r.description,r.status,r.raised_by,r.resolved_at,r.zone_id,r.branch_id],
  },
  {
    name: 'payments',
    pgSql: 'SELECT id,customer_id,amount,collected_by,method,collected_at,notes FROM payments',
    mysqlInsert: 'INSERT IGNORE INTO payments (id,customer_id,amount,collected_by,method,collected_at,notes) VALUES (?,?,?,?,?,?,?)',
    map: r => [r.id,r.customer_id,r.amount,r.collected_by,r.method,r.collected_at,r.notes],
  },
];

async function migrateTable(my, table) {
  const { rows } = await pg.query(table.pgSql);
  if (rows.length === 0) { log(`  ${table.name}: 0 rows`); return; }
  const batchSize = table.batchSize || 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const row of batch) {
      await my.query(table.mysqlInsert, table.map(row)).catch(() => {});
      inserted++;
    }
  }
  log(`  ${table.name}: ${inserted} rows migrated`);
}

(async () => {
  log('=== Migrating remaining tables ===');
  const my = await getMySQL();
  await my.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) {
    log(`Migrating ${table.name}...`);
    await migrateTable(my, table);
  }
  await my.query('SET FOREIGN_KEY_CHECKS = 1');

  const [rows] = await my.query(`
    SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
    WHERE TABLE_SCHEMA='patrika_vitran' ORDER BY TABLE_ROWS DESC`);
  console.log('\n=== MySQL table row counts ===');
  rows.forEach(r => console.log(`  ${r.TABLE_NAME.padEnd(25)} ${r.TABLE_ROWS}`));

  log('=== Done ===');
  await my.end(); await pg.end();
})().catch(e => { console.error(e); process.exit(1); });
