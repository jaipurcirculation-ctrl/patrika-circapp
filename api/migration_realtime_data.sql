-- ============================================================
-- Patrika Vitran Suite — Realtime Data Migration
-- Run in pgAdmin on the 'patrika_vitran' database
-- ============================================================

-- -------------------------------------------------------
-- 1. UNITS master (RP branches / distribution points)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
    unit_code   VARCHAR(10)  PRIMARY KEY,
    unit_name   VARCHAR(100) NOT NULL,
    comp_code   VARCHAR(20)  DEFAULT 'RP001'
);

-- -------------------------------------------------------
-- 2. HIERARCHY MASTER
--    Person master: executives, CI, zonal heads, VPs
--    is_active = ISACTIVEFORPLI from source (Y→true)
--    Only is_active=true rows are used in the dashboard
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS hierarchy_master (
    id              SERIAL       PRIMARY KEY,
    comp_code       VARCHAR(20),
    unit_code       VARCHAR(10),
    person_code     VARCHAR(20)  NOT NULL,
    person_name     VARCHAR(150),
    hierarchy_code  VARCHAR(10),
    hierarchy_level SMALLINT,
    reporting_to    VARCHAR(20),
    is_active       BOOLEAN      DEFAULT FALSE,
    employee_code   VARCHAR(20),
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW(),
    UNIQUE (comp_code, unit_code, person_code)
);

CREATE INDEX IF NOT EXISTS idx_hm_unit_active
    ON hierarchy_master (unit_code, is_active);
CREATE INDEX IF NOT EXISTS idx_hm_level
    ON hierarchy_master (hierarchy_level);

-- -------------------------------------------------------
-- 3. HIERARCHY MAPPING
--    Executive → Edition Incharge → Circ Incharge →
--    Zonal Head → VP chain for each RP unit
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS hierarchy_mapping (
    id                   SERIAL       PRIMARY KEY,
    source_row_id        VARCHAR(60),
    comp_code            VARCHAR(20),
    unit_code            VARCHAR(10),
    unit_name            VARCHAR(100),
    exec_code            VARCHAR(20),
    exec_name            VARCHAR(150),
    exec_desig           VARCHAR(10),   -- EXEC | CI | FO
    edtn_incharge_code   VARCHAR(20),
    edtn_incharge_name   VARCHAR(200),
    circ_incharge_code   VARCHAR(20),
    circ_incharge_name   VARCHAR(200),
    zonal_head_code      VARCHAR(20),
    zonal_head_name      VARCHAR(150),
    vp_circulation_code  VARCHAR(20),
    vp_circulation_name  VARCHAR(150),
    created_at           TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hmap_unit
    ON hierarchy_mapping (unit_code);
CREATE INDEX IF NOT EXISTS idx_hmap_exec
    ON hierarchy_mapping (exec_code);

-- -------------------------------------------------------
-- 4. ROUTES master
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
    route_code  VARCHAR(20)  PRIMARY KEY,
    route_name  VARCHAR(200) NOT NULL,
    unit_code   VARCHAR(10),
    taxi_type   VARCHAR(10)            -- MAIN | LINK
);

-- -------------------------------------------------------
-- 5. SUB-ROUTES master
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_routes (
    sub_route_code  VARCHAR(20)  PRIMARY KEY,
    sub_route_name  VARCHAR(200),
    route_code      VARCHAR(20)  REFERENCES routes(route_code)
);

-- -------------------------------------------------------
-- 6. DROP POINTS master
--    Static list of all authorised drop points per route.
--    Source: Taxi Drop Points.xlsx
--    Used to identify MISSED drop points (master minus daily log)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS drop_points_master (
    drop_point_code   VARCHAR(30)   PRIMARY KEY,
    drop_point_name   VARCHAR(200),
    unit_code         VARCHAR(10),
    unit_name         VARCHAR(100),
    driver_mobile     VARCHAR(15),
    driver_name       VARCHAR(100),
    taxi_id           VARCHAR(20),
    vehicle_no        VARCHAR(20),
    route_code        VARCHAR(20),
    route_name        VARCHAR(200),
    sub_route_code    VARCHAR(20),
    sub_route_name    VARCHAR(200),
    latitude          DECIMAL(12,8),
    longitude         DECIMAL(12,8),
    scheduled_arrival TIME,
    last_seen_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dp_route
    ON drop_points_master (route_code);
CREATE INDEX IF NOT EXISTS idx_dp_unit
    ON drop_points_master (unit_code);

-- -------------------------------------------------------
-- 7. TAXI DELAY LOG  (daily report)
--    Source: Taxi Delay Report.xlsx
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxi_delay_log (
    id                   SERIAL       PRIMARY KEY,
    report_date          DATE         NOT NULL,
    unit_name            VARCHAR(100),
    route_name           VARCHAR(200),
    sub_route_name       VARCHAR(200),
    taxi_type            VARCHAR(10),   -- MAIN | LINK
    bundles              INTEGER,
    supply               INTEGER,
    vehicle_no           VARCHAR(20),
    is_regular           BOOLEAN       DEFAULT TRUE,
    casual_reason        VARCHAR(200),
    vehicle_name         VARCHAR(50),
    vehicle_owner        VARCHAR(150),
    driver_mobile        VARCHAR(15),
    start_location       VARCHAR(200),
    scheduled_departure  TIME,
    actual_departure     TIME,
    last_location        VARCHAR(200),
    reached_time         TIME,
    allowed_time         INTERVAL,
    time_taken           INTERVAL,
    taxi_delayed         INTERVAL,      -- negative = arrived early
    route_master_km      DECIMAL(8,2),
    total_app_km         DECIMAL(8,2),
    created_at           TIMESTAMP     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tdl_date
    ON taxi_delay_log (report_date);
CREATE INDEX IF NOT EXISTS idx_tdl_date_unit
    ON taxi_delay_log (report_date, unit_name);

-- -------------------------------------------------------
-- 8. TAXI DROP POINT LOG  (daily actual deliveries)
--    Source: App Taxi Drop Point Wise Report.xlsx
--    One row per drop point per trip per day.
--    is_delivered is always TRUE here (missed = not in this table)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxi_drop_point_log (
    id                SERIAL        PRIMARY KEY,
    sup_date          DATE          NOT NULL,
    unit_name         VARCHAR(100),
    driver_mobile     VARCHAR(15),
    vehicle_no        VARCHAR(20),
    taxi_route_type   VARCHAR(10),   -- MAIN | LINK
    route_code        VARCHAR(20),
    route_name        VARCHAR(200),
    sub_route_code    VARCHAR(20),
    sub_route_name    VARCHAR(200),
    drop_point_name   VARCHAR(200),
    no_of_packets     INTEGER,
    packet_drop_date  DATE,
    scheduled_arrival TIME,
    actual_arrival    TIME,
    time_diff         INTERVAL,      -- positive = late, negative = early
    taxi_id           VARCHAR(20),
    reg_lat           DECIMAL(12,8),
    reg_long          DECIMAL(12,8),
    actual_lat        DECIMAL(12,8),
    actual_long       DECIMAL(12,8),
    dist_diff         DECIMAL(8,2),
    route_master_km   DECIMAL(8,2),
    return_km         DECIMAL(8,2),
    actual_km         DECIMAL(8,2),
    total_distance    DECIMAL(8,2),
    duration          VARCHAR(20),
    lat_long_addr     TEXT,
    api_distance      DECIMAL(8,2),
    vehicle_sharing   BOOLEAN        DEFAULT FALSE,
    last_drop_point   VARCHAR(200),
    dropping_lat_long TEXT,
    created_at        TIMESTAMP      DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tdpl_date
    ON taxi_drop_point_log (sup_date);
CREATE INDEX IF NOT EXISTS idx_tdpl_date_route
    ON taxi_drop_point_log (sup_date, route_code);
CREATE INDEX IF NOT EXISTS idx_tdpl_date_unit
    ON taxi_drop_point_log (sup_date, unit_name);

-- -------------------------------------------------------
-- VIEWS
-- -------------------------------------------------------

-- Active executives with their reporting chain
CREATE OR REPLACE VIEW v_active_executives AS
SELECT
    hm.id,
    hm.comp_code,
    hm.unit_code,
    hm.person_code,
    hm.person_name,
    hm.hierarchy_level,
    hm.reporting_to,
    hm.employee_code,
    mp.unit_name,
    mp.exec_desig,
    mp.edtn_incharge_code,
    mp.edtn_incharge_name,
    mp.circ_incharge_code,
    mp.circ_incharge_name,
    mp.zonal_head_code,
    mp.zonal_head_name,
    mp.vp_circulation_code,
    mp.vp_circulation_name
FROM hierarchy_master hm
LEFT JOIN hierarchy_mapping mp
    ON hm.unit_code = mp.unit_code
    AND hm.person_code = mp.exec_code
WHERE hm.is_active = TRUE;

-- Delivered drop points for a date (join with master for spatial info)
CREATE OR REPLACE VIEW v_delivered_drop_points AS
SELECT
    dl.sup_date,
    dl.unit_name,
    dl.route_code,
    dl.route_name,
    dl.sub_route_code,
    dl.sub_route_name,
    dl.drop_point_name,
    dl.no_of_packets,
    dl.scheduled_arrival,
    dl.actual_arrival,
    dl.time_diff,
    dl.actual_lat,
    dl.actual_long,
    dl.lat_long_addr,
    dm.drop_point_code,
    dm.latitude  AS master_lat,
    dm.longitude AS master_long,
    'delivered'::TEXT AS status
FROM taxi_drop_point_log dl
LEFT JOIN drop_points_master dm
    ON dl.route_code = dm.route_code
    AND UPPER(TRIM(dl.drop_point_name)) = UPPER(TRIM(dm.drop_point_name));

-- Missed drop points: in master but not delivered on a given date/route
-- Usage: SELECT * FROM v_missed_drop_points WHERE sup_date = '2026-07-15'
CREATE OR REPLACE VIEW v_missed_drop_points AS
SELECT
    dates.sup_date,
    dm.unit_code,
    dm.unit_name,
    dm.route_code,
    dm.route_name,
    dm.drop_point_code,
    dm.drop_point_name,
    dm.latitude,
    dm.longitude,
    dm.scheduled_arrival,
    'missed'::TEXT AS status
FROM drop_points_master dm
CROSS JOIN (SELECT DISTINCT sup_date FROM taxi_drop_point_log) dates
WHERE NOT EXISTS (
    SELECT 1 FROM taxi_drop_point_log dl
    WHERE dl.sup_date = dates.sup_date
      AND dl.route_code = dm.route_code
      AND UPPER(TRIM(dl.drop_point_name)) = UPPER(TRIM(dm.drop_point_name))
);

-- Taxi delay summary per unit per date
CREATE OR REPLACE VIEW v_taxi_delay_summary AS
SELECT
    report_date,
    unit_name,
    COUNT(*)                                    AS total_routes,
    SUM(CASE WHEN taxi_delayed > '0'::INTERVAL THEN 1 ELSE 0 END) AS delayed_count,
    SUM(CASE WHEN taxi_delayed <= '0'::INTERVAL THEN 1 ELSE 0 END) AS on_time_count,
    AVG(EXTRACT(EPOCH FROM taxi_delayed)/60)    AS avg_delay_minutes,
    SUM(route_master_km)                        AS total_planned_km,
    SUM(total_app_km)                           AS total_actual_km,
    SUM(supply)                                 AS total_supply
FROM taxi_delay_log
GROUP BY report_date, unit_name;
