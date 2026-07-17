-- ============================================================
-- Patrika Vitran Suite — MySQL Schema
-- ============================================================

USE patrika_vitran;

-- 1. UNITS
CREATE TABLE IF NOT EXISTS units (
    unit_code   VARCHAR(10)  PRIMARY KEY,
    unit_name   VARCHAR(100) NOT NULL,
    comp_code   VARCHAR(20)  DEFAULT 'RP001'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. ZONES
CREATE TABLE IF NOT EXISTS zones (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    region  VARCHAR(60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. BRANCHES
CREATE TABLE IF NOT EXISTS branches (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    city    VARCHAR(60),
    zone_id INT,
    CONSTRAINT fk_branches_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. USERS
CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    mobile          VARCHAR(15) NOT NULL UNIQUE,
    password        VARCHAR(100),
    name            VARCHAR(100),
    role            VARCHAR(50),
    district        VARCHAR(100),
    hierarchy_level VARCHAR(30),
    manager_id      INT,
    zone_id         INT,
    branch_id       INT,
    territory       VARCHAR(100),
    is_active       TINYINT(1)  DEFAULT 1,
    created_at      DATETIME    DEFAULT NOW(),
    CONSTRAINT fk_users_manager FOREIGN KEY (manager_id) REFERENCES users(id),
    CONSTRAINT fk_users_zone    FOREIGN KEY (zone_id)    REFERENCES zones(id),
    CONSTRAINT fk_users_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. HIERARCHY MASTER
CREATE TABLE IF NOT EXISTS hierarchy_master (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    comp_code       VARCHAR(20),
    unit_code       VARCHAR(10),
    person_code     VARCHAR(20)  NOT NULL,
    person_name     VARCHAR(150),
    hierarchy_code  VARCHAR(10),
    hierarchy_level SMALLINT,
    reporting_to    VARCHAR(20),
    is_active       TINYINT(1)   DEFAULT 0,
    employee_code   VARCHAR(20),
    created_at      DATETIME     DEFAULT NOW(),
    updated_at      DATETIME     DEFAULT NOW() ON UPDATE NOW(),
    UNIQUE KEY uq_hm (comp_code, unit_code, person_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_hm_unit_active ON hierarchy_master (unit_code, is_active);
CREATE INDEX idx_hm_level       ON hierarchy_master (hierarchy_level);

-- 6. HIERARCHY MAPPING
CREATE TABLE IF NOT EXISTS hierarchy_mapping (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    source_row_id        VARCHAR(60),
    comp_code            VARCHAR(20),
    unit_code            VARCHAR(10),
    unit_name            VARCHAR(100),
    exec_code            VARCHAR(20),
    exec_name            VARCHAR(150),
    exec_desig           VARCHAR(10),
    edtn_incharge_code   VARCHAR(20),
    edtn_incharge_name   VARCHAR(200),
    circ_incharge_code   VARCHAR(20),
    circ_incharge_name   VARCHAR(200),
    zonal_head_code      VARCHAR(20),
    zonal_head_name      VARCHAR(150),
    vp_circulation_code  VARCHAR(20),
    vp_circulation_name  VARCHAR(150),
    created_at           DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_hmap_unit ON hierarchy_mapping (unit_code);
CREATE INDEX idx_hmap_exec ON hierarchy_mapping (exec_code);

-- 7. ROUTES
CREATE TABLE IF NOT EXISTS routes (
    route_code  VARCHAR(20)  PRIMARY KEY,
    route_name  VARCHAR(200) NOT NULL,
    unit_code   VARCHAR(10),
    taxi_type   VARCHAR(10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. SUB-ROUTES
CREATE TABLE IF NOT EXISTS sub_routes (
    sub_route_code  VARCHAR(20)  PRIMARY KEY,
    sub_route_name  VARCHAR(200),
    route_code      VARCHAR(20),
    CONSTRAINT fk_subroutes_route FOREIGN KEY (route_code) REFERENCES routes(route_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. DROP POINTS MASTER
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
    last_seen_at      DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_dp_route ON drop_points_master (route_code);
CREATE INDEX idx_dp_unit  ON drop_points_master (unit_code);

-- 10. TAXI DELAY LOG
CREATE TABLE IF NOT EXISTS taxi_delay_log (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    report_date          DATE         NOT NULL,
    unit_name            VARCHAR(100),
    route_name           VARCHAR(200),
    sub_route_name       VARCHAR(200),
    taxi_type            VARCHAR(10),
    bundles              INT,
    supply               INT,
    vehicle_no           VARCHAR(20),
    is_regular           TINYINT(1)    DEFAULT 1,
    casual_reason        VARCHAR(200),
    vehicle_name         VARCHAR(50),
    vehicle_owner        VARCHAR(150),
    driver_mobile        VARCHAR(15),
    start_location       VARCHAR(200),
    scheduled_departure  TIME,
    actual_departure     TIME,
    last_location        VARCHAR(200),
    reached_time         TIME,
    allowed_time         INT           NULL,
    time_taken           INT           NULL,
    taxi_delayed         INT           NULL,
    route_master_km      DECIMAL(8,2),
    total_app_km         DECIMAL(8,2),
    created_at           DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_tdl_date      ON taxi_delay_log (report_date);
CREATE INDEX idx_tdl_date_unit ON taxi_delay_log (report_date, unit_name);

-- 11. TAXI DROP POINT LOG (main data table - 282k rows)
CREATE TABLE IF NOT EXISTS taxi_drop_point_log (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    sup_date          DATE          NOT NULL,
    unit_name         VARCHAR(100),
    driver_mobile     VARCHAR(15),
    vehicle_no        VARCHAR(20),
    taxi_route_type   VARCHAR(10),
    route_code        VARCHAR(20),
    route_name        VARCHAR(200),
    sub_route_code    VARCHAR(20),
    sub_route_name    VARCHAR(200),
    drop_point_name   VARCHAR(200),
    no_of_packets     INT,
    packet_drop_date  DATE,
    scheduled_arrival TIME,
    actual_arrival    TIME,
    time_diff         INT           NULL,
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
    duration          INT           NULL,
    lat_long_addr     TEXT,
    api_distance      DECIMAL(8,2),
    vehicle_sharing   TINYINT(1)     DEFAULT 0,
    last_drop_point   VARCHAR(200),
    dropping_lat_long TEXT,
    created_at        DATETIME       DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_tdpl_date       ON taxi_drop_point_log (sup_date);
CREATE INDEX idx_tdpl_date_route ON taxi_drop_point_log (sup_date, route_code);
CREATE INDEX idx_tdpl_date_unit  ON taxi_drop_point_log (sup_date, unit_name);

-- 12. DAILY SUPPLY
CREATE TABLE IF NOT EXISTS daily_supply (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    report_date  DATE         NOT NULL,
    unit_name    VARCHAR(100),
    route_code   VARCHAR(20),
    route_name   VARCHAR(200),
    edition      VARCHAR(100),
    supply_count INT,
    supplied_by  VARCHAR(100),
    vehicle_no   VARCHAR(20),
    remarks      TEXT,
    zone_id      INT,
    branch_id    INT,
    created_at   DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. DAILY COLLECTION
CREATE TABLE IF NOT EXISTS daily_collection (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    report_date     DATE         NOT NULL,
    unit_name       VARCHAR(100),
    collected_by    VARCHAR(100),
    amount          DECIMAL(12,2),
    payment_mode    VARCHAR(30),
    reference_no    VARCHAR(50),
    customer_name   VARCHAR(100),
    remarks         TEXT,
    zone_id         INT,
    branch_id       INT,
    created_at      DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. AGENCY OUTSTANDING
CREATE TABLE IF NOT EXISTS agency_outstanding (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    report_date     DATE         NOT NULL,
    unit_name       VARCHAR(100),
    agency_name     VARCHAR(200),
    opening_balance DECIMAL(14,2),
    supply_amount   DECIMAL(14,2),
    collection      DECIMAL(14,2),
    closing_balance DECIMAL(14,2),
    created_at      DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100),
    mobile      VARCHAR(15),
    address     TEXT,
    district    VARCHAR(60),
    edition     VARCHAR(60),
    plan        VARCHAR(30),
    start_date  DATE,
    end_date    DATE,
    zone_id     INT,
    branch_id   INT,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 16. LEADS
CREATE TABLE IF NOT EXISTS leads (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100),
    mobile      VARCHAR(15),
    address     TEXT,
    district    VARCHAR(60),
    source      VARCHAR(50),
    status      VARCHAR(30),
    assigned_to INT,
    zone_id     INT,
    branch_id   INT,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 17. COMPLAINTS
CREATE TABLE IF NOT EXISTS complaints (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    complaint   TEXT,
    status      VARCHAR(30),
    resolved_at DATETIME,
    resolved_by INT,
    zone_id     INT,
    branch_id   INT,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 18. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    amount      DECIMAL(12,2),
    paid_at     DATETIME,
    mode        VARCHAR(30),
    reference   VARCHAR(50),
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 19. TRIPS
CREATE TABLE IF NOT EXISTS trips (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_no  VARCHAR(20),
    route_code  VARCHAR(20),
    trip_date   DATE,
    start_time  TIME,
    end_time    TIME,
    driver_id   INT,
    status      VARCHAR(20),
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 20. STOPS
CREATE TABLE IF NOT EXISTS stops (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    route_code  VARCHAR(20),
    stop_name   VARCHAR(200),
    seq_no      INT,
    latitude    DECIMAL(12,8),
    longitude   DECIMAL(12,8),
    scheduled   TIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 21. DCR VISITS
CREATE TABLE IF NOT EXISTS dcr_visits (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    visit_date  DATE,
    exec_id     INT,
    customer_id INT,
    remarks     TEXT,
    status      VARCHAR(30),
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
