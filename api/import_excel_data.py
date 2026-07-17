"""
Patrika Vitran Suite — Excel → PostgreSQL Import
Reads all 5 source Excel files from 'Input Reports' folder
and loads them into the patrika_vitran database.

Usage:
    python import_excel_data.py
    python import_excel_data.py --date 2026-07-15   (override report date)
    python import_excel_data.py --file hierarchy     (import one file only)
"""
import sys, os, re, argparse
from datetime import date, datetime, time
import openpyxl
import psycopg2
from psycopg2.extras import execute_batch

# ── DB connection ──────────────────────────────────────────────────────────────
DB = dict(
    host="localhost",
    port=5432,
    dbname="patrika_vitran",
    user="postgres",
    password="Patrika@2026",
)

INPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "Input Reports")

# ── Helpers ────────────────────────────────────────────────────────────────────
def s(v):
    """Clean string value — strip whitespace and \xa0."""
    if v is None:
        return None
    return str(v).replace("\xa0", " ").strip() or None

def to_int(v):
    try:
        return int(float(str(v).replace(",", "").strip()))
    except Exception:
        return None

def to_float(v):
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None

def to_date(v):
    if v is None:
        return None
    if isinstance(v, (date, datetime)):
        return v.date() if isinstance(v, datetime) else v
    raw = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None

def to_time(v):
    """Parse time strings like '03:30', '03:30:00'."""
    if v is None:
        return None
    if isinstance(v, (time, datetime)):
        return v if isinstance(v, time) else v.time()
    raw = str(v).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            pass
    return None

def to_interval(v):
    """Parse '01:23:45', '-00:05', or floats into a PostgreSQL interval string."""
    if v is None:
        return None
    if isinstance(v, (time, datetime)):
        t = v if isinstance(v, time) else v.time()
        total_sec = t.hour * 3600 + t.minute * 60 + t.second
        h, rem = divmod(abs(total_sec), 3600)
        m, s = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"
    raw = str(v).strip()
    if not raw or raw == "0":
        return "00:00:00"
    neg = raw.startswith("-")
    raw_clean = raw.lstrip("-").strip()
    parts = raw_clean.split(":")
    try:
        if len(parts) == 2:
            h, m = int(parts[0]), int(parts[1])
            s = 0
        elif len(parts) == 3:
            h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            return None
        # Normalise minutes/seconds overflow (e.g. 00:68 → 01:08)
        total_sec = h * 3600 + m * 60 + s
        h2, rem = divmod(total_sec, 3600)
        m2, s2 = divmod(rem, 60)
        return f"{'-' if neg else ''}{h2:02d}:{m2:02d}:{s2:02d}"
    except ValueError:
        return None

def to_bool_yn(v):
    return str(v).strip().upper() == "Y" if v is not None else False

def to_bool_rn(v):
    return str(v).strip().upper() == "REGULAR" if v is not None else True

def read_sheet(filename):
    path = os.path.join(INPUT_DIR, filename)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    return rows

# ── 1. Hierarchy Master ────────────────────────────────────────────────────────
def import_hierarchy_master(cur):
    rows = read_sheet("Hieararchy Mast.xlsx")
    # COMP_CODE, UNIT_CODE, CODE, NAME, DESCRIPTION,
    # HIERARCHY_CODE, HIERARCHY_LEVEL, REPORTING_TO, ISACTIVEFORPLI, EMPLOYEE_CODE
    data = []
    units = set()
    for r in rows[1:]:
        if not r[0]:
            continue
        comp   = s(r[0])
        unit   = s(r[1])
        code   = s(r[2])
        name   = s(r[3])
        hcode  = s(r[5])
        hlevel = to_int(r[6])
        rep_to = s(r[7])
        active = to_bool_yn(r[8])
        emp    = s(r[9])
        if unit:
            units.add((unit, comp))
        data.append((comp, unit, code, name, hcode, hlevel, rep_to, active, emp))

    # Ensure units exist
    execute_batch(cur, """
        INSERT INTO units (unit_code, comp_code)
        VALUES (%s, %s)
        ON CONFLICT (unit_code) DO NOTHING
    """, [(u, c) for u, c in units])

    execute_batch(cur, """
        INSERT INTO hierarchy_master
            (comp_code, unit_code, person_code, person_name,
             hierarchy_code, hierarchy_level, reporting_to, is_active, employee_code)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (comp_code, unit_code, person_code)
        DO UPDATE SET
            person_name     = EXCLUDED.person_name,
            hierarchy_code  = EXCLUDED.hierarchy_code,
            hierarchy_level = EXCLUDED.hierarchy_level,
            reporting_to    = EXCLUDED.reporting_to,
            is_active       = EXCLUDED.is_active,
            employee_code   = EXCLUDED.employee_code,
            updated_at      = NOW()
    """, data)
    print(f"  hierarchy_master: {len(data)} rows upserted")

# ── 2. Hierarchy Mapping ───────────────────────────────────────────────────────
def import_hierarchy_mapping(cur):
    rows = read_sheet("HierMapping.xlsx")
    # ROWID, COMP_CODE, UNIT_CODE, UNIT NAME, EXEC_CODE, EXEC_DESC, EXEC_DESIG,
    # EDTN_INCHARGE, EDTN_INCHARGE_NAME, CIRC_INCHARGE, CIRC_INCHARGE_NAME,
    # ZONAL_HEAD, ZONAL_HEAD_NAME, VP_CIRCULATION, VP_CIRCULATION_NAME
    cur.execute("DELETE FROM hierarchy_mapping")
    data = []
    units = set()
    for r in rows[1:]:
        if not r[0]:
            continue
        row_id   = s(r[0])
        comp     = s(r[1])
        unit     = s(r[2])
        raw_uname = s(r[3])
        # Skip VLOOKUP formula strings — unit_name will be backfilled from units table
        uname    = None if (raw_uname and raw_uname.startswith("=")) else raw_uname
        exec_c   = s(r[4])
        exec_n   = s(r[5])
        desig    = s(r[6])
        edtn_c   = s(r[7])
        edtn_n   = s(r[8])
        circ_c   = s(r[9])
        circ_n   = s(r[10])
        zonal_c  = s(r[11])
        zonal_n  = s(r[12])
        vp_c     = s(r[13])
        vp_n     = s(r[14])
        if unit:
            units.add((unit, uname, comp))
        data.append((row_id, comp, unit, uname, exec_c, exec_n, desig,
                     edtn_c, edtn_n, circ_c, circ_n, zonal_c, zonal_n, vp_c, vp_n))

    # Upsert units — only update unit_name when we have a real value (not formula)
    execute_batch(cur, """
        INSERT INTO units (unit_code, unit_name, comp_code)
        VALUES (%s, %s, %s)
        ON CONFLICT (unit_code) DO UPDATE
            SET unit_name = COALESCE(EXCLUDED.unit_name, units.unit_name),
                comp_code = EXCLUDED.comp_code
    """, [(u, n, c) for u, n, c in units])

    execute_batch(cur, """
        INSERT INTO hierarchy_mapping
            (source_row_id, comp_code, unit_code, unit_name,
             exec_code, exec_name, exec_desig,
             edtn_incharge_code, edtn_incharge_name,
             circ_incharge_code, circ_incharge_name,
             zonal_head_code, zonal_head_name,
             vp_circulation_code, vp_circulation_name)
        VALUES (%s, %s, %s,
                COALESCE(%s, (SELECT unit_name FROM units WHERE unit_code=%s)),
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, [(r[0], r[1], r[2], r[3], r[2], r[4], r[5], r[6],
           r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14]) for r in data])
    print(f"  hierarchy_mapping: {len(data)} rows inserted")

# ── 3. Taxi Drop Points Master ─────────────────────────────────────────────────
def import_drop_points_master(cur):
    rows = read_sheet("Taxi Drop Points.xlsx")
    # UNIT_CODE, UNITNAME, USERNAME, DRIVER_NAME, TAXI_ID, VEHICLE_NO,
    # ROUTE_CODE, ROUTE_NAME, SUB_ROUTE_CODE, SUB_ROUTE_NAME,
    # DROP_POINT, DROP_POINT_NAME, LATITUDE, LONGITUDE,
    # ARRIVAL_TIME, REG_LAT_LANG_DATETIME, LAT_LONG_ADDR

    routes_seen = {}
    data = []
    for r in rows[1:]:
        unit_code  = s(r[0])
        unit_name  = s(r[1])
        username   = s(r[2])
        driver     = s(r[3])
        taxi_id    = s(r[4])
        vehicle_no = s(r[5])
        route_code = s(r[6])
        route_name = s(r[7])
        sub_code   = s(r[8])
        sub_name   = s(r[9])
        dp_code    = s(r[10])
        dp_name    = s(r[11])
        lat        = to_float(r[12])
        lng        = to_float(r[13])
        arr_time   = to_time(r[14])
        reg_dt     = None
        if r[15]:
            try:
                raw = str(r[15]).strip()
                for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                    try:
                        reg_dt = datetime.strptime(raw, fmt)
                        break
                    except ValueError:
                        pass
            except Exception:
                pass

        if not dp_code:
            continue
        if route_code and route_code not in routes_seen:
            routes_seen[route_code] = route_name
        data.append((dp_code, dp_name, unit_code, unit_name, username,
                     driver, taxi_id, vehicle_no, route_code, route_name,
                     sub_code, sub_name, lat, lng, arr_time, reg_dt))

    # Upsert routes
    execute_batch(cur, """
        INSERT INTO routes (route_code, route_name)
        VALUES (%s, %s)
        ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name
    """, [(k, v) for k, v in routes_seen.items()])

    execute_batch(cur, """
        INSERT INTO drop_points_master
            (drop_point_code, drop_point_name, unit_code, unit_name,
             driver_mobile, driver_name, taxi_id, vehicle_no,
             route_code, route_name, sub_route_code, sub_route_name,
             latitude, longitude, scheduled_arrival, last_seen_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (drop_point_code) DO UPDATE SET
            drop_point_name  = EXCLUDED.drop_point_name,
            unit_code        = EXCLUDED.unit_code,
            route_code       = EXCLUDED.route_code,
            latitude         = EXCLUDED.latitude,
            longitude        = EXCLUDED.longitude,
            scheduled_arrival= EXCLUDED.scheduled_arrival,
            last_seen_at     = EXCLUDED.last_seen_at
    """, data)
    print(f"  drop_points_master: {len(data)} rows upserted, {len(routes_seen)} routes")

# ── 4. Taxi Delay Log ──────────────────────────────────────────────────────────
def import_taxi_delay_log(cur, report_date_override=None):
    rows = read_sheet("Taxi Delay Report.xlsx")
    # Unit Name, Date, Route Name, Sub Route Name, Taxi Type, Bundle, Supply,
    # Vehicle No., Regular/Casual, Casual Reason, Vehicle Name, Vehicle Owner,
    # Mobile No., Start Location Name, Schedule Departure, Actual Departure,
    # Last Location Name, Reached Time(Last Location), Allowed Time(Min),
    # Time Taken(Min), TaxiDelayed, Route Mast KM, Total App KM

    data = []
    dates_seen = set()
    for r in rows[1:]:
        if not r[0]:
            continue
        rpt_date = report_date_override or to_date(r[1]) or date.today()
        dates_seen.add(rpt_date)
        data.append((
            rpt_date,
            s(r[0]),                  # unit_name
            s(r[2]),                  # route_name
            s(r[3]),                  # sub_route_name
            s(r[4]),                  # taxi_type
            to_int(r[5]),             # bundles
            to_int(r[6]),             # supply
            s(r[7]),                  # vehicle_no
            to_bool_rn(r[8]),         # is_regular
            s(r[9]),                  # casual_reason
            s(r[10]),                 # vehicle_name
            s(r[11]),                 # vehicle_owner
            s(r[12]),                 # driver_mobile
            s(r[13]),                 # start_location
            to_time(r[14]),           # scheduled_departure
            to_time(r[15]),           # actual_departure
            s(r[16]),                 # last_location
            to_time(r[17]),           # reached_time
            to_interval(r[18]),       # allowed_time
            to_interval(r[19]),       # time_taken
            to_interval(r[20]),       # taxi_delayed
            to_float(r[21]),          # route_master_km
            to_float(r[22]),          # total_app_km
        ))

    # Delete existing records for these dates before re-importing
    for d in dates_seen:
        cur.execute("DELETE FROM taxi_delay_log WHERE report_date = %s", (d,))

    execute_batch(cur, """
        INSERT INTO taxi_delay_log
            (report_date, unit_name, route_name, sub_route_name,
             taxi_type, bundles, supply, vehicle_no,
             is_regular, casual_reason, vehicle_name, vehicle_owner,
             driver_mobile, start_location,
             scheduled_departure, actual_departure,
             last_location, reached_time,
             allowed_time, time_taken, taxi_delayed,
             route_master_km, total_app_km)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, data)
    print(f"  taxi_delay_log: {len(data)} rows for dates {sorted(dates_seen)}")

# ── 5. App Taxi Drop Point Log ─────────────────────────────────────────────────
def import_drop_point_log(cur, report_date_override=None):
    rows = read_sheet("App Taxi Drop Point Wise Report.xlsx")
    # Unit Name, Sup. Date, Driver Mobile No., Vehicle, Taxi Route, ROUTE_CODE,
    # Route Name, Sub Route Code, Sub Route Name, Drop Point Name, No of Packet,
    # Packet Drop Date, Scheduled Arrival Time, Actual Arrival Time, Time Difference,
    # Taxi ID, REG LAT, REG LONG, Actual Lat, Actual Long, Diff. of Distance,
    # Rout Master Km, Return Km, Actual Km, Total Distance, Duration,
    # Lat Long Addr, API Distance, Vehicle Sharing, Last Drop Point Name, DROPPING LAT-LONG

    data = []
    dates_seen = set()
    routes_seen = {}
    for r in rows[1:]:
        if not r[0]:
            continue
        sup_date = report_date_override or to_date(r[1]) or date.today()
        dates_seen.add(sup_date)
        route_code = s(r[5])
        route_name = s(r[6])
        if route_code and route_code not in routes_seen:
            routes_seen[route_code] = route_name

        data.append((
            sup_date,
            s(r[0]),                               # unit_name
            s(r[2]),                               # driver_mobile
            s(r[3]),                               # vehicle_no
            s(r[4]),                               # taxi_route_type (MAIN/LINK)
            route_code,
            route_name,
            s(r[7]),                               # sub_route_code
            s(r[8]),                               # sub_route_name
            s(r[9]),                               # drop_point_name
            to_int(r[10]),                         # no_of_packets
            to_date(r[11]),                        # packet_drop_date
            to_time(r[12]),                        # scheduled_arrival
            to_time(r[13]),                        # actual_arrival
            to_interval(r[14]),                    # time_diff
            s(r[15]),                              # taxi_id
            to_float(r[16]),                       # reg_lat
            to_float(r[17]),                       # reg_long
            to_float(r[18]),                       # actual_lat
            to_float(r[19]),                       # actual_long
            to_float(r[20]),                       # dist_diff
            to_float(r[21]),                       # route_master_km
            to_float(r[22]),                       # return_km
            to_float(r[23]),                       # actual_km
            to_float(r[24]),                       # total_distance
            s(r[25]),                              # duration
            s(r[26]),                              # lat_long_addr
            to_float(r[27]),                       # api_distance
            str(r[28]).strip().upper() != "N" if r[28] else False,  # vehicle_sharing
            s(r[29]),                              # last_drop_point
            s(r[30]),                              # dropping_lat_long
        ))

    # Upsert new routes
    execute_batch(cur, """
        INSERT INTO routes (route_code, route_name)
        VALUES (%s, %s)
        ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name
    """, [(k, v) for k, v in routes_seen.items()])

    # Delete existing for these dates
    for d in dates_seen:
        cur.execute("DELETE FROM taxi_drop_point_log WHERE sup_date = %s", (d,))

    execute_batch(cur, """
        INSERT INTO taxi_drop_point_log
            (sup_date, unit_name, driver_mobile, vehicle_no, taxi_route_type,
             route_code, route_name, sub_route_code, sub_route_name,
             drop_point_name, no_of_packets, packet_drop_date,
             scheduled_arrival, actual_arrival, time_diff, taxi_id,
             reg_lat, reg_long, actual_lat, actual_long,
             dist_diff, route_master_km, return_km, actual_km,
             total_distance, duration, lat_long_addr,
             api_distance, vehicle_sharing, last_drop_point, dropping_lat_long)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, data)
    print(f"  taxi_drop_point_log: {len(data)} rows for dates {sorted(dates_seen)}")

# ── 6. Agency Outstanding ──────────────────────────────────────────────────────
def import_agency_outstanding(cur):
    rows = read_sheet("Agency Outstanding.xlsx")
    # S.No, STATE, Unit Name, AGCode, Agency, Executive, Status, Is Correspondent,
    # Zonal Head, State, District, Drop Point, Total Copies, Daily Copies,
    # Security Deposit, Required Security, Security Diff,
    # Opening Debit, Opening Credit, Bill Amount, Other Debits,
    # Receipt Amount, Other Credits, Net Receipt,
    # Closing Debit, Closing Credit, Collection %, Mobile No.,
    # Agency Type, Supply Start Date, Supply Days, Last Supply Date,
    # Last Supply Post, Block Ledger
    from datetime import date as dt_date

    # Derive report_date from max Last Supply Date in file
    max_date = None
    for r in rows[1:]:
        d = r[31]
        if isinstance(d, datetime):
            if max_date is None or d.date() > max_date:
                max_date = d.date()
    report_date = max_date or dt_date.today()
    print(f"  report_date: {report_date}")

    cur.execute("DELETE FROM agency_outstanding WHERE report_date = %s", (report_date,))

    data = []
    for r in rows[1:]:
        if not r[3]:   # skip if no AGCode
            continue
        def n(v):      # safe numeric
            try: return float(v) if v is not None else None
            except: return None
        def d(v):      # safe date
            if isinstance(v, datetime): return v.date()
            return None

        data.append((
            report_date,
            s(r[1]),   # state_region
            s(r[2]),   # unit_name
            s(r[3]),   # ag_code
            s(r[4]),   # agency_name
            s(r[5]),   # executive
            s(r[6]),   # status
            s(r[8]),   # zonal_head
            s(r[9]),   # state
            s(r[10]),  # district
            s(r[11]),  # drop_point
            to_int(r[12]),  # total_copies
            to_int(r[13]),  # daily_copies
            n(r[14]),  # security_deposit
            n(r[15]),  # required_security
            n(r[16]),  # security_diff
            n(r[17]),  # opening_debit
            n(r[18]),  # opening_credit
            n(r[19]),  # bill_amount
            n(r[20]),  # other_debits
            n(r[21]),  # receipt_amount
            n(r[22]),  # other_credits
            n(r[24]),  # closing_debit
            n(r[25]),  # closing_credit
            n(r[26]),  # collection_pct
            s(r[27]),  # mobile_no
            s(r[28]),  # agency_type
            d(r[29]),  # supply_start_date
            to_int(r[30]),  # supply_days
            d(r[31]),  # last_supply_date
            to_int(r[32]), # last_supply_post
        ))

    execute_batch(cur, """
        INSERT INTO agency_outstanding
            (report_date, state_region, unit_name, ag_code, agency_name, executive,
             status, zonal_head, state, district, drop_point,
             total_copies, daily_copies, security_deposit, required_security, security_diff,
             opening_debit, opening_credit, bill_amount, other_debits,
             receipt_amount, other_credits, closing_debit, closing_credit,
             collection_pct, mobile_no, agency_type,
             supply_start_date, supply_days, last_supply_date, last_supply_post)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (report_date, ag_code) DO UPDATE SET
            agency_name=EXCLUDED.agency_name, unit_name=EXCLUDED.unit_name,
            closing_debit=EXCLUDED.closing_debit, closing_credit=EXCLUDED.closing_credit,
            collection_pct=EXCLUDED.collection_pct, receipt_amount=EXCLUDED.receipt_amount,
            bill_amount=EXCLUDED.bill_amount, status=EXCLUDED.status
    """, data)
    print(f"  agency_outstanding: {len(data)} rows for {report_date}")


# ── Payment mode normalisation map (ERP → internal) ───────────────────────────
_MODE_MAP = {
    "NEFT/RTGS":                  "NEFT",
    "UPI/IMPS":                   "UPI",
    "QR CODE":                    "UPI",
    "PAYMENT GATWWAY":            "GATEWAY",
    "AGENT DEPOSIT CASH IN BANK": "CASH",
    "EXECUTIVE CASH":             "CASH",
    "CHEQUE CMS":                 "CHEQUE",
}

# ── 7. Daily Supply (ERP format: Supply.xlsx) ──────────────────────────────────
def import_daily_supply(cur, rpt_date=None):
    """
    Supply.xlsx — ERP supply report with dynamic date columns.
    Col (0-based): 1=UNIT_STATE, 2=UNIT_NAME, 3=ZONAL_HEAD, 4=EDITION,
    5=AGENCY_TYPE, 6=AGENCY_CODE, 8=AGNAME, 9=EXECUTIVE, 12=DIST,
    13=CITY, 14=DROPPOINT, 18=MOBILE, then date cols (format 'DDMONYYYY').
    Last column is always 'Total' — skipped.
    """
    rows = read_sheet("Supply.xlsx")
    if not rows or len(rows) < 2:
        print("  daily_supply: Supply.xlsx empty or missing — skipping")
        return

    header = rows[0]
    date_cols = []
    for i, h in enumerate(header):
        h_str = str(h or "").strip().strip("'").strip('"')
        m = re.match(r"^(\d{1,2}[A-Z]{3}\d{4})$", h_str)
        if m:
            try:
                dt = datetime.strptime(m.group(1), "%d%b%Y").date()
                date_cols.append((i, dt))
            except ValueError:
                pass

    if not date_cols:
        print("  daily_supply: no date columns found in Supply.xlsx header — skipping")
        return

    print(f"  Supply.xlsx date columns: {[str(d) for _, d in date_cols]}")

    dates_seen = set(d for _, d in date_cols)
    for d in dates_seen:
        cur.execute("DELETE FROM daily_supply WHERE supply_date = %s", (d,))

    data = []
    for r in rows[1:]:
        if not r or not r[6]:
            continue
        ag_code = s(r[6])
        if not ag_code:
            continue

        common = dict(
            state_region = s(r[1]),
            unit_name    = s(r[2]),
            zonal_head   = s(r[3]),
            edition_name = s(r[4]),
            agency_type  = s(r[5]),
            agency_name  = s(r[8]),
            executive    = s(r[9]),
            district     = s(r[12]),
            city         = s(r[13]),
            drop_point   = s(r[14]),
            mobile_no    = s(r[18]) if len(r) > 18 else None,
        )

        for col_idx, supply_date in date_cols:
            if col_idx >= len(r):
                continue
            copies = to_int(r[col_idx])
            if copies is None:
                continue
            data.append((
                supply_date, ag_code,
                common["agency_name"], common["unit_name"], common["executive"],
                common["zonal_head"], common["state_region"], copies,
                common["district"], common["city"], common["drop_point"],
                common["edition_name"], common["agency_type"], common["mobile_no"],
            ))

    if data:
        execute_batch(cur, """
            INSERT INTO daily_supply
                (supply_date, ag_code, agency_name, unit_name, executive,
                 zonal_head, state_region, copies_supplied,
                 district, city, drop_point, edition_name, agency_type, mobile_no)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (supply_date, ag_code) DO UPDATE SET
                agency_name     = EXCLUDED.agency_name,
                unit_name       = EXCLUDED.unit_name,
                executive       = EXCLUDED.executive,
                zonal_head      = EXCLUDED.zonal_head,
                state_region    = EXCLUDED.state_region,
                copies_supplied = EXCLUDED.copies_supplied,
                district        = EXCLUDED.district,
                city            = EXCLUDED.city,
                drop_point      = EXCLUDED.drop_point
        """, data)
    print(f"  daily_supply: {len(data)} agency-date rows for dates {sorted(dates_seen)}")


# ── 8. Daily Collection (ERP format: Collection Register.xlsx) ─────────────────
def import_daily_collection(cur, rpt_date=None):
    """
    Collection Register.xlsx — ERP collection register (28 columns, 0-based).
    Col: 1=State, 2=District, 3=Branch(unit_name), 4=ZonalHead,
         5=Date, 7=DocNo(receipt), 8=PartyCode(ag_code), 10=AgentName,
         11=DropPoint, 12=PaymentMode, 17=Amount, 25=Mobile.
    All rows: Credit Head='News Paper Agents' → sale_type='CREDIT'.
    """
    rows = read_sheet("Collection Register.xlsx")
    if not rows or len(rows) < 2:
        print("  daily_collection: Collection Register.xlsx empty or missing — skipping")
        return

    data = []
    dates_seen = set()
    skipped = 0

    for r in rows[1:]:
        if not r or not r[5]:
            continue
        coll_date = to_date(r[5])
        if not coll_date:
            skipped += 1
            continue
        amount = to_float(r[17]) if len(r) > 17 else None
        if amount is None:
            skipped += 1
            continue

        raw_mode = str(r[12] or "").strip().upper() if len(r) > 12 else ""
        mode = _MODE_MAP.get(raw_mode, raw_mode) or None

        dates_seen.add(coll_date)
        data.append((
            coll_date,
            s(r[8])  if len(r) > 8  else None,  # ag_code
            s(r[10]) if len(r) > 10 else None,  # customer_name
            s(r[3])  if len(r) > 3  else None,  # unit_name
            None,                                 # executive (not in register)
            s(r[4])  if len(r) > 4  else None,  # zonal_head
            s(r[1])  if len(r) > 1  else None,  # state_region
            amount,
            mode,
            "CREDIT",                             # sale_type — all News Paper Agents
            s(r[7])  if len(r) > 7  else None,  # receipt_no (Document No.)
            s(r[2])  if len(r) > 2  else None,  # district
            s(r[11]) if len(r) > 11 else None,  # drop_point
            s(r[25]) if len(r) > 25 else None,  # mobile_no
        ))

    for d in dates_seen:
        cur.execute("DELETE FROM daily_collection WHERE collection_date = %s", (d,))

    if data:
        execute_batch(cur, """
            INSERT INTO daily_collection
                (collection_date, ag_code, customer_name, unit_name, executive,
                 zonal_head, state_region, amount, payment_mode, sale_type, receipt_no,
                 district, drop_point, mobile_no)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, data)
    print(f"  daily_collection: {len(data)} rows for {len(dates_seen)} dates ({sorted(dates_seen)}), skipped {skipped}")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Override report date (YYYY-MM-DD)")
    parser.add_argument("--file",
        choices=["hierarchy","mapping","dropmaster","delay","droplog",
                 "outstanding","supply","collection","daily","all"],
        default="all")
    args = parser.parse_args()

    rpt_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None

    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        f = args.file
        if f in ("hierarchy", "all"):
            print("Importing Hierarchy Master...")
            import_hierarchy_master(cur)
        if f in ("mapping", "all"):
            print("Importing Hierarchy Mapping...")
            import_hierarchy_mapping(cur)
        if f in ("dropmaster", "all"):
            print("Importing Drop Points Master...")
            import_drop_points_master(cur)
        if f in ("delay", "all", "daily"):
            print("Importing Taxi Delay Log...")
            import_taxi_delay_log(cur, rpt_date)
        if f in ("droplog", "all", "daily"):
            print("Importing App Drop Point Log...")
            import_drop_point_log(cur, rpt_date)
        if f in ("outstanding", "all"):
            print("Importing Agency Outstanding...")
            import_agency_outstanding(cur)
        if f in ("supply", "all", "daily"):
            print("Importing Daily Supply...")
            import_daily_supply(cur, rpt_date)
        if f in ("collection", "all", "daily"):
            print("Importing Daily Collection...")
            import_daily_collection(cur, rpt_date)

        conn.commit()
        print("\nAll imports committed successfully.")

    except Exception as e:
        conn.rollback()
        print(f"\nERROR — rolled back: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()
