-- ============================================================
-- Patrika Vitran Suite — Hierarchy Migration (v2)
-- Run in pgAdmin Query Tool on the 'patrika_vitran' database
-- AFTER the initial setup script has been run
-- ============================================================

-- 1. Zones table
CREATE TABLE IF NOT EXISTS zones (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    region  VARCHAR(60)
);

-- 2. Branches table
CREATE TABLE IF NOT EXISTS branches (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    city    VARCHAR(60),
    zone_id INT REFERENCES zones(id)
);

-- 3. New columns on users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS hierarchy_level VARCHAR(30),
    ADD COLUMN IF NOT EXISTS manager_id      INT,
    ADD COLUMN IF NOT EXISTS zone_id         INT REFERENCES zones(id),
    ADD COLUMN IF NOT EXISTS branch_id       INT REFERENCES branches(id),
    ADD COLUMN IF NOT EXISTS territory       VARCHAR(100);

-- 4. Seed zones
INSERT INTO zones (name, region) VALUES
    ('Rajasthan East', 'Rajasthan'),
    ('Rajasthan West', 'Rajasthan'),
    ('MP Central',     'MP & CG'),
    ('CG North',       'MP & CG')
ON CONFLICT DO NOTHING;

-- 5. Seed branches
INSERT INTO branches (name, city, zone_id) VALUES
    ('Jaipur Main',  'Jaipur',  1),
    ('Jaipur North', 'Jaipur',  1),
    ('Jodhpur Main', 'Jodhpur', 2),
    ('Ajmer Main',   'Ajmer',   1)
ON CONFLICT DO NOTHING;

-- 6. Update existing 6 users — set hierarchy level, role and territory
UPDATE users SET
    hierarchy_level = 'admin',
    role            = 'admin',
    territory       = 'All Rajasthan',
    zone_id         = NULL,
    branch_id       = NULL
WHERE mobile = '9714022891';

UPDATE users SET
    hierarchy_level = 'branch_incharge',
    role            = 'branch_incharge',
    password        = 'branch@123',    -- updated from agent@123
    territory       = 'Jaipur — Malviya Nagar',
    zone_id         = 1,
    branch_id       = 1
WHERE mobile = '9876543210';

UPDATE users SET
    hierarchy_level = 'hawker',
    territory       = 'Route MN-04',
    zone_id         = 1,
    branch_id       = 1
WHERE mobile = '8765432109';

UPDATE users SET
    hierarchy_level = 'executive',
    role            = 'executive',
    territory       = 'Jodhpur City',
    zone_id         = 2,
    branch_id       = 3
WHERE mobile = '7654321098';

UPDATE users SET
    hierarchy_level = 'executive',
    role            = 'executive',
    territory       = 'Jaipur City',
    zone_id         = 1,
    branch_id       = 1
WHERE mobile = '6543210987';

UPDATE users SET
    hierarchy_level = 'executive',
    role            = 'executive',
    territory       = 'Jaipur Rural',
    zone_id         = 1,
    branch_id       = 1
WHERE mobile = '5432109876';

-- 7. Insert 6 new users for missing hierarchy levels
INSERT INTO users (mobile, password, name, role, district, hierarchy_level, zone_id, branch_id, territory) VALUES
    ('9811111111', 'vp@123',     'Vikram Singh',  'vp',                'Rajasthan',    'vp',                NULL, NULL, 'All Rajasthan'),
    ('9822222222', 'zonal@123',  'Ramesh Gupta',  'zonal_head',        'Jaipur',       'zonal_head',        1,    NULL, 'Jaipur Zone — 4 branches'),
    ('9833333333', 'dist@123',   'Mukesh Verma',  'district_incharge', 'Jaipur Rural', 'district_incharge', 1,    1,    'Jaipur Rural / Daak'),
    ('9844444444', 'city@123',   'Sunita Sharma', 'city_incharge',     'Jaipur City',  'city_incharge',     1,    1,    'Jaipur City'),
    ('9855555555', 'center@123', 'Gopal Das',     'center_incharge',   'Mansarovar',   'center_incharge',   1,    1,    'Mansarovar Center'),
    ('9866666666', 'agent@123',  'Manoj Kumar',   'agent',             'Malviya Nagar','agent',             1,    1,    'MN Territory — 6 routes')
ON CONFLICT (mobile) DO NOTHING;

-- 8. Set self-referential manager_id relationships
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_manager'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_manager
      FOREIGN KEY (manager_id) REFERENCES users(id);
  END IF;
END $$;

-- VP → Admin
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9714022891')
WHERE mobile = '9811111111';

-- Zonal Head → VP
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9811111111')
WHERE mobile = '9822222222';

-- Branch Incharge → Zonal Head
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9822222222')
WHERE mobile = '9876543210';

-- District Incharge → Branch Incharge
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9876543210')
WHERE mobile = '9833333333';

-- City Incharge → Branch Incharge
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9876543210')
WHERE mobile = '9844444444';

-- Executives → respective incharges
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9833333333')
WHERE mobile IN ('5432109876');                     -- Anita Verma (DCR) under District

UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9844444444')
WHERE mobile IN ('7654321098', '6543210987');       -- Priya & Rajan under City

-- Center Incharge → City Incharge
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9844444444')
WHERE mobile = '9855555555';

-- Newspaper Agent → District Incharge
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9833333333')
WHERE mobile = '9866666666';

-- Hawker → Agent
UPDATE users SET manager_id = (SELECT id FROM users WHERE mobile = '9866666666')
WHERE mobile = '8765432109';

-- 9. Add zone/branch scope to key tables
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zone_id   INT REFERENCES zones(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);
ALTER TABLE leads     ADD COLUMN IF NOT EXISTS zone_id   INT REFERENCES zones(id);
ALTER TABLE leads     ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS zone_id  INT REFERENCES zones(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);

-- 10. Verify — shows all users sorted by level
SELECT
    CASE hierarchy_level
        WHEN 'admin'             THEN 1
        WHEN 'vp'                THEN 2
        WHEN 'zonal_head'        THEN 3
        WHEN 'branch_incharge'   THEN 4
        WHEN 'district_incharge' THEN 5
        WHEN 'city_incharge'     THEN 6
        WHEN 'executive'         THEN 7
        WHEN 'center_incharge'   THEN 8
        WHEN 'agent'             THEN 9
        WHEN 'hawker'            THEN 10
        ELSE 11
    END AS level_no,
    name, mobile, role, hierarchy_level, territory
FROM users
ORDER BY 1;
