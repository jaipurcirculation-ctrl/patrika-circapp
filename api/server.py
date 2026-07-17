"""
Patrika Vitran Suite — REST API server
Connects the web app to PostgreSQL.

Run: python server.py   (or use install_and_start.bat)
API docs: http://localhost:8000/docs
"""

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import psycopg2
import psycopg2.extras
from config import DB_CONFIG, API_HOST, API_PORT, CORS_ORIGINS

app = FastAPI(title="Patrika Vitran API", version="1.0.0", description="Circulation management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── DB helpers ──────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

def user_id_from_mobile(cur, mobile: str) -> Optional[int]:
    if not mobile:
        return None
    cur.execute("SELECT id FROM users WHERE mobile = %s", (mobile,))
    row = cur.fetchone()
    return row["id"] if row else None


# ── Request models ───────────────────────────────────────────

class LoginReq(BaseModel):
    mobile: str
    password: str

class CustomerReq(BaseModel):
    name: str
    phone: str
    address: str
    plan: str
    route: str

class PaymentReq(BaseModel):
    customer_name: str
    amount: float
    method: str
    notes: Optional[str] = ""

class ComplaintReq(BaseModel):
    customer_name: str
    complaint_type: str
    route: str
    priority: str
    description: Optional[str] = ""

class VisitReq(BaseModel):
    visit_type: str
    target: str
    outcome: str
    amount: float = 0
    notes: Optional[str] = ""

class LeadReq(BaseModel):
    name: str
    mobile: str
    area: str
    publication: str
    interest: str
    notes: Optional[str] = ""

class StopMarkReq(BaseModel):
    status: str  # 'delivered' or 'missed'

class TripReq(BaseModel):
    vehicle_no: str
    route: str
    bundles: int = 0
    departure: str = ""


# ── Health check ─────────────────────────────────────────────

@app.get("/api/health")
def health():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM users")
                row = cur.fetchone()
        return {"status": "ok", "users": row["n"]}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "db_error", "detail": str(e)})


# ── Authentication ────────────────────────────────────────────

@app.post("/api/login")
def login(req: LoginReq):
    mobile = req.mobile.strip().replace(" ", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mobile, name, role, district FROM users "
                "WHERE mobile = %s AND password = %s AND is_active = TRUE",
                (mobile, req.password)
            )
            user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")
    return dict(user)


# ── Customers ─────────────────────────────────────────────────

@app.get("/api/customers")
def list_customers(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM customers ORDER BY created_at DESC LIMIT 200")
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/customers")
def create_customer(req: CustomerReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            cur.execute(
                "INSERT INTO customers (name, address, mobile, edition, copies, agent_id) "
                "VALUES (%s, %s, %s, %s, 1, %s) RETURNING id",
                (req.name, req.address, req.phone, req.plan, uid)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Customer created ✓"}


# ── Hawker stops ──────────────────────────────────────────────

@app.get("/api/stops")
def list_stops(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            if not uid:
                return []
            cur.execute(
                "SELECT * FROM stops WHERE hawker_id = %s AND trip_date = CURRENT_DATE ORDER BY id",
                (uid,)
            )
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/stops/{stop_id}/mark")
def mark_stop(stop_id: int, req: StopMarkReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stops SET status = %s, marked_at = NOW() WHERE id = %s",
                (req.status, stop_id)
            )
        conn.commit()
    return {"message": "Stop updated ✓"}


# ── Payments ──────────────────────────────────────────────────

@app.get("/api/payments")
def list_payments(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM payments ORDER BY collected_at DESC LIMIT 100")
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/payments")
def record_payment(req: PaymentReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            cur.execute(
                "INSERT INTO payments (amount, collected_by, method, notes) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (req.amount, uid, req.method, f"{req.customer_name} · {req.notes}")
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Payment recorded ✓"}


# ── Complaints ────────────────────────────────────────────────

@app.get("/api/complaints")
def list_complaints(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM complaints ORDER BY created_at DESC LIMIT 100")
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/complaints")
def log_complaint(req: ComplaintReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            cur.execute(
                "INSERT INTO complaints (type, description, raised_by) "
                "VALUES (%s, %s, %s) RETURNING id",
                (req.complaint_type,
                 f"Customer: {req.customer_name} | Route: {req.route} | Priority: {req.priority} | {req.description}",
                 uid)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Complaint logged ✓"}


# ── DCR Visits ────────────────────────────────────────────────

@app.get("/api/visits")
def list_visits(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            if not uid:
                return []
            cur.execute(
                "SELECT * FROM dcr_visits WHERE dcr_id = %s AND visit_date = CURRENT_DATE "
                "ORDER BY created_at DESC",
                (uid,)
            )
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/visits")
def log_visit(req: VisitReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            note = req.outcome
            if req.amount:
                note += f" · collected ₹{req.amount}"
            if req.notes:
                note += f" · {req.notes}"
            cur.execute(
                "INSERT INTO dcr_visits (dcr_id, outlet_name, purpose, outcome) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (uid, req.target, req.visit_type, note)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Visit saved ✓"}


# ── Survey Leads ──────────────────────────────────────────────

@app.get("/api/leads")
def list_leads(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            if not uid:
                return []
            cur.execute(
                "SELECT * FROM leads WHERE surveyor_id = %s ORDER BY created_at DESC",
                (uid,)
            )
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/leads")
def submit_lead(req: LeadReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            interest_level = (
                "hot" if req.interest.startswith("High")
                else "cold" if req.interest.startswith("Low")
                else "medium"
            )
            cur.execute(
                "INSERT INTO leads (surveyor_id, name, mobile, address, edition, interest) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (uid, req.name, req.mobile, req.area, req.publication, interest_level)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Lead saved ✓"}


# ── Trips ─────────────────────────────────────────────────────

@app.get("/api/trips")
def list_trips(x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM trips WHERE trip_date = CURRENT_DATE ORDER BY created_at DESC LIMIT 20"
            )
            return [dict(r) for r in cur.fetchall()]

@app.post("/api/trips")
def log_trip(req: TripReq, x_user_mobile: Optional[str] = Header(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            uid = user_id_from_mobile(cur, x_user_mobile)
            cur.execute(
                "INSERT INTO trips (driver_id, vehicle_no, route, bundles) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (uid, req.vehicle_no, req.route, req.bundles)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "message": "Trip logged ✓"}


# ── Hierarchy users ──────────────────────────────────────────

# Map DB hierarchy_level to app role metadata
# NOTE: hierarchy_master level numbers — L5=VP, L4=Zonal Head, L3=Circ IC, L2=Edition IC
_LEVEL_META = {
    1: {"roleLabel": "Admin — Board View",       "role": "admin",             "dashboard": True,  "modules": ["agent","hawker","dcr","survey","taxi"]},
    2: {"roleLabel": "Edition Incharge",         "role": "edition_incharge",  "dashboard": True,  "modules": ["agent","dcr","survey"]},
    3: {"roleLabel": "Circulation Incharge",     "role": "circ_incharge",     "dashboard": True,  "modules": ["agent","dcr"]},
    4: {"roleLabel": "Zonal Head",               "role": "zonal_head",        "dashboard": True,  "modules": ["agent","dcr","survey"]},
    5: {"roleLabel": "VP Circulation",           "role": "vp",                "dashboard": True,  "modules": ["agent","dcr","survey","taxi"]},
    7: {"roleLabel": "Field Executive",          "role": "executive",         "dashboard": False, "modules": ["dcr","survey"]},
    9: {"roleLabel": "Newspaper Agent",          "role": "agent",             "dashboard": False, "modules": ["agent"]},
   10: {"roleLabel": "Hawker",                   "role": "hawker",            "dashboard": False, "modules": ["hawker"]},
}

# ── RBAC scope helpers ───────────────────────────────────────

import re as _re
import math as _math

def _haversine_km(lat1, lon1, lat2, lon2):
    """Straight-line distance in km between two GPS points."""
    if any(v is None for v in (lat1, lon1, lat2, lon2)):
        return None
    R = 6371.0
    p1, p2 = _math.radians(float(lat1)), _math.radians(float(lat2))
    dp = _math.radians(float(lat2) - float(lat1))
    dl = _math.radians(float(lon2) - float(lon1))
    a = _math.sin(dp/2)**2 + _math.cos(p1)*_math.cos(p2)*_math.sin(dl/2)**2
    return round(2*R*_math.asin(_math.sqrt(a)), 2)

# L5=VP→vp_circulation_code, L4=Zonal Head→zonal_head_code,
# L3=Circ IC→circ_incharge_code, L2=Edition IC→edtn_incharge_code
_LEVEL_COL = {
    5: "vp_circulation_code",
    4: "zonal_head_code",
    3: "circ_incharge_code",
    2: "edtn_incharge_code",
}

def get_scope_unit_codes(cur, person_code: str, hierarchy_level: int):
    """Return list of unit_codes visible to this user, or None for admin (all)."""
    if hierarchy_level == 1 or not person_code:
        return None
    col = _LEVEL_COL.get(hierarchy_level)
    if col:
        cur.execute(
            f"SELECT DISTINCT unit_code FROM hierarchy_mapping WHERE {col} = %s",
            (str(person_code),)
        )
        return [r["unit_code"] for r in cur.fetchall()]
    # L6/7/8/9/10 — scoped to their own unit only
    cur.execute(
        "SELECT unit_code FROM hierarchy_master WHERE person_code = %s AND is_active = TRUE",
        (str(person_code),)
    )
    row = cur.fetchone()
    return [row["unit_code"]] if row and row["unit_code"] else []

def scope_to_taxi_names(cur, unit_codes: list) -> list:
    """Map unit_codes → taxi unit_names by matching against actual taxi_delay_log values.
    Handles PT/DN (exact), plain names like JHUNJHUNU (exact), and RP units (appended)."""
    if not unit_codes:
        return []
    placeholders = ",".join(["%s"] * len(unit_codes))
    cur.execute(f"""
        SELECT DISTINCT tdl.unit_name
        FROM taxi_delay_log tdl
        JOIN units u ON (
            tdl.unit_name = u.unit_name
            OR tdl.unit_name = u.unit_name || ' RP'
        )
        WHERE u.unit_code IN ({placeholders})
    """, unit_codes)
    return [r["unit_name"] for r in cur.fetchall()]

def _avatar(name: str) -> str:
    parts = name.strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return name[:2].upper() if name else "??"

@app.get("/api/hierarchy/users")
def hierarchy_users():
    """Return active users from hierarchy_master, one per level as demo logins."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Get all active users with unit names
            cur.execute("""
                SELECT hm.id, hm.person_code, hm.person_name, hm.hierarchy_level,
                       hm.unit_code, COALESCE(u.unit_name, hm.unit_code) AS unit_name,
                       hm.reporting_to, hm.employee_code
                FROM hierarchy_master hm
                LEFT JOIN units u ON u.unit_code = hm.unit_code
                WHERE hm.is_active = TRUE
                ORDER BY hm.hierarchy_level, hm.person_name
            """)
            rows = cur.fetchall()

    users = []
    for r in rows:
        lvl = r["hierarchy_level"]
        meta = _LEVEL_META.get(lvl, {"roleLabel": f"Level {lvl}", "role": "user", "dashboard": False, "modules": []})
        unit_label = r["unit_name"] or r["unit_code"] or ""
        users.append({
            "id": r["id"],
            "person_code": r["person_code"],
            "name": r["person_name"],
            "hierarchyLevel": lvl,
            "unit_code": r["unit_code"],
            "scopeLabel": unit_label,
            "roleLabel": meta["roleLabel"],
            "role": meta["role"],
            "dashboard": meta["dashboard"],
            "modules": meta["modules"],
            "avatar": _avatar(r["person_name"]),
            "employee_code": r["employee_code"],
            "reporting_to": r["reporting_to"],
        })

    return {"users": users, "total": len(users)}


# ── Dashboard: Delivery data ─────────────────────────────────

def _clean(row):
    """Convert Decimal/timedelta/date/time to JSON-serialisable types."""
    import decimal
    out = {}
    for k, v in row.items():
        if isinstance(v, decimal.Decimal):
            out[k] = float(v)
        elif hasattr(v, "total_seconds"):           # timedelta
            out[k] = round(v.total_seconds() / 60, 1)
        elif hasattr(v, "isoformat"):               # date / time / datetime
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


@app.get("/api/dashboard/delivery")
def delivery_dashboard(
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Overall KPIs + unit-wise breakdown for the Command Centre."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(report_date)::text FROM taxi_delay_log")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else str(__import__("datetime").date.today())

            # Resolve RBAC scope
            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)
            taxi_names = None if unit_codes is None else scope_to_taxi_names(cur, unit_codes)
            # taxi_names=None → no filter (admin)
            # taxi_names=[] → user's units have no taxi data → return empty immediately
            if taxi_names is not None and len(taxi_names) == 0:
                return {"date": date, "summary": {"total_routes":0,"total_supply":0,"on_time":0,
                        "delayed":0,"otd_pct":0,"planned_km":0,"actual_km":0,
                        "delivered_drops":0,"active_routes":0,"planned_drops":0,"missed_drops":0},
                        "units": []}
            scope_filter = "" if taxi_names is None else "AND unit_name = ANY(%s)"

            def scope_param(base_params: tuple) -> tuple:
                return base_params if taxi_names is None else base_params + ([taxi_names],)

            cur.execute(f"""
                SELECT
                  COUNT(*)                                                          AS total_routes,
                  COALESCE(SUM(supply), 0)::float                                  AS total_supply,
                  SUM(CASE WHEN taxi_delayed <= interval '0' THEN 1 ELSE 0 END)    AS on_time,
                  SUM(CASE WHEN taxi_delayed  > interval '0' THEN 1 ELSE 0 END)    AS delayed,
                  COALESCE(ROUND(100.0 * SUM(CASE WHEN taxi_delayed <= interval '0'
                    THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 1), 0)::float AS otd_pct,
                  COALESCE(SUM(route_master_km), 0)::float                          AS planned_km,
                  COALESCE(SUM(total_app_km),    0)::float                          AS actual_km
                FROM taxi_delay_log WHERE report_date = %s {scope_filter}
            """, scope_param((date,)))
            summary = _clean(cur.fetchone() or {})

            cur.execute(f"""
                SELECT COUNT(*) AS delivered_drops, COUNT(DISTINCT route_code) AS active_routes
                FROM taxi_drop_point_log WHERE sup_date = %s {scope_filter}
            """, scope_param((date,)))
            drops = _clean(cur.fetchone() or {})

            cur.execute(f"""
                SELECT COUNT(*) AS planned_drops
                FROM drop_points_master
                WHERE route_code IN (
                    SELECT DISTINCT route_code FROM taxi_drop_point_log WHERE sup_date = %s {scope_filter})
            """, scope_param((date,)))
            planned = _clean(cur.fetchone() or {})

            scope_filter_d = "" if taxi_names is None else "AND d.unit_name = ANY(%s)"
            scope_filter_dp = "" if taxi_names is None else "AND unit_name = ANY(%s)"

            cur.execute(f"""
                SELECT
                  d.unit_name,
                  COUNT(*)                                                               AS routes,
                  COALESCE(SUM(d.supply), 0)::float                                     AS supply,
                  SUM(CASE WHEN d.taxi_delayed <= interval '0' THEN 1 ELSE 0 END)       AS on_time,
                  SUM(CASE WHEN d.taxi_delayed  > interval '0' THEN 1 ELSE 0 END)       AS delayed,
                  COALESCE(ROUND(100.0 * SUM(CASE WHEN d.taxi_delayed <= interval '0'
                    THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 1), 0)::float     AS otd_pct,
                  COALESCE(SUM(d.total_app_km), 0)::float                               AS actual_km,
                  COALESCE(dp_agg.delivered_drops, 0)                                   AS delivered_drops
                FROM taxi_delay_log d
                LEFT JOIN (
                    SELECT unit_name, COUNT(*) AS delivered_drops
                    FROM taxi_drop_point_log
                    WHERE sup_date = %s {scope_filter_dp}
                    GROUP BY unit_name
                ) dp_agg ON dp_agg.unit_name = d.unit_name
                WHERE d.report_date = %s {scope_filter_d}
                GROUP BY d.unit_name, dp_agg.delivered_drops
                ORDER BY delayed DESC, d.unit_name
            """, scope_param((date,)) + scope_param((date,)) if taxi_names is not None
                else (date, date))
            units = [_clean(r) for r in cur.fetchall()]

            missed = max(0, int(planned.get("planned_drops", 0)) - int(drops.get("delivered_drops", 0)))
            return {
                "date": date,
                "summary": {**summary, **drops, **planned, "missed_drops": missed},
                "units": units,
            }


@app.get("/api/dashboard/routes")
def delivery_routes(
    unit_name: str,
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Route-level detail for one unit — for drilldown level 2."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(report_date)::text FROM taxi_delay_log")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""

            # RBAC: verify unit_name is in scope
            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)
            if unit_codes is not None:
                taxi_names = scope_to_taxi_names(cur, unit_codes)
                if not taxi_names or unit_name not in taxi_names:
                    return {"date": date, "unit_name": unit_name, "routes": []}

            cur.execute("""
                SELECT route_name, sub_route_name, taxi_type,
                       bundles, supply,
                       vehicle_no, is_regular,
                       scheduled_departure::text,
                       actual_departure::text,
                       ROUND(EXTRACT(EPOCH FROM COALESCE(taxi_delayed, interval '0'))/60, 0)::float
                           AS delay_minutes,
                       COALESCE(route_master_km, 0)::float AS planned_km,
                       COALESCE(total_app_km,    0)::float AS actual_km,
                       (taxi_delayed > interval '0') AS is_delayed
                FROM taxi_delay_log
                WHERE report_date = %s AND unit_name = %s
                ORDER BY is_delayed DESC, route_name
            """, (date, unit_name))
            return {"date": date, "unit_name": unit_name,
                    "routes": [_clean(r) for r in cur.fetchall()]}


@app.get("/api/dashboard/drop-points")
def delivery_drop_points(
    route_code: str,
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Drop point delivered + missed list for a route — drilldown level 3.
    route_code is actually the route_name from taxi_delay_log (e.g. "BHOPAL TO BAIORA").
    route_codes in taxi_drop_point_log are per-unit and NOT globally unique, so we
    always query by route_name. Delivered = actual_lat IS NOT NULL; missed = IS NULL.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(sup_date)::text FROM taxi_drop_point_log")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""

            route_name = route_code  # the parameter is always a route_name

            # RBAC: verify the route belongs to an in-scope unit
            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)
            if unit_codes is not None:
                taxi_names = scope_to_taxi_names(cur, unit_codes)
                cur.execute(
                    "SELECT unit_name FROM taxi_delay_log WHERE route_name = %s LIMIT 1",
                    (route_name,)
                )
                rrow = cur.fetchone()
                if rrow and rrow["unit_name"] not in taxi_names:
                    return {"date": date, "route_name": route_name,
                            "delivered_count": 0, "missed_count": 0, "drop_points": []}

            # Query daily log by route_name; actual_lat NULL = missed by driver
            cur.execute("""
                SELECT drop_point_name,
                       scheduled_arrival::text,
                       actual_arrival::text,
                       ROUND(EXTRACT(EPOCH FROM COALESCE(time_diff, interval '0'))/60, 0)::float
                           AS diff_minutes,
                       actual_lat::float,
                       actual_long::float,
                       CASE WHEN actual_lat IS NOT NULL AND actual_long IS NOT NULL
                            THEN 'delivered' ELSE 'missed' END AS status
                FROM taxi_drop_point_log
                WHERE sup_date = %s AND route_name = %s
                ORDER BY actual_arrival NULLS LAST, scheduled_arrival NULLS LAST
            """, (date, route_name))
            all_drops = [_clean(r) for r in cur.fetchall()]

            # Add km_from_prev: Haversine distance from previous drop point's actual GPS
            prev_lat = prev_lon = None
            for dp in all_drops:
                dp["km_from_prev"] = _haversine_km(prev_lat, prev_lon, dp.get("actual_lat"), dp.get("actual_long"))
                if dp.get("actual_lat") is not None:
                    prev_lat, prev_lon = dp["actual_lat"], dp["actual_long"]

            delivered = [r for r in all_drops if r["status"] == "delivered"]
            missed    = [r for r in all_drops if r["status"] == "missed"]
            total_km  = round(sum(r["km_from_prev"] for r in all_drops if r.get("km_from_prev")), 2)

            return {
                "date": date, "route_name": route_name,
                "delivered_count": len(delivered),
                "missed_count": len(missed),
                "total_km": total_km,
                "drop_points": delivered + missed,
            }


# ── Dashboard: Outstanding ───────────────────────────────────

@app.get("/api/dashboard/outstanding")
def outstanding_dashboard(
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Outstanding summary + unit-level breakdown with RBAC scope."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(report_date)::text FROM agency_outstanding")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""
            if not date:
                return {"date": date, "summary": {}, "units": []}

            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)

            if unit_codes is None:
                scope_filter = ""
                scope_params: tuple = ()
            elif len(unit_codes) == 0:
                return {"date": date, "summary": {}, "units": []}
            else:
                placeholders = ",".join(["%s"] * len(unit_codes))
                cur.execute(f"""
                    SELECT DISTINCT ao.unit_name
                    FROM agency_outstanding ao
                    JOIN units u ON (
                        ao.unit_name = u.unit_name
                        OR ao.unit_name = u.unit_name || ' RP'
                        OR ao.unit_name = u.unit_name || ' PT'
                        OR ao.unit_name = u.unit_name || ' DN'
                    )
                    WHERE u.unit_code IN ({placeholders})
                """, unit_codes)
                ao_names = [r["unit_name"] for r in cur.fetchall()]
                if not ao_names:
                    return {"date": date, "summary": {}, "units": []}
                scope_filter = "AND unit_name = ANY(%s)"
                scope_params = ([ao_names],)

            def sp(base: tuple = ()) -> tuple:
                return base + scope_params

            cur.execute(f"""
                SELECT
                    COUNT(*)                                                              AS total_agencies,
                    SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END)      AS outstanding_agencies,
                    COALESCE(SUM(closing_debit),  0)::float                              AS total_outstanding,
                    COALESCE(SUM(closing_credit), 0)::float                              AS total_advance,
                    COALESCE(SUM(bill_amount),    0)::float                              AS total_bill,
                    COALESCE(SUM(receipt_amount), 0)::float                              AS total_collected,
                    COALESCE(ROUND(AVG(collection_pct), 1), 0)::float                   AS avg_collection_pct
                FROM agency_outstanding
                WHERE report_date = %s {scope_filter}
            """, sp((date,)))
            summary = _clean(cur.fetchone() or {})

            cur.execute(f"""
                SELECT
                    unit_name,
                    COUNT(*)                                                              AS agency_count,
                    SUM(CASE WHEN COALESCE(closing_debit,0) > 0 THEN 1 ELSE 0 END)      AS outstanding_count,
                    COALESCE(SUM(closing_debit),  0)::float                              AS outstanding,
                    COALESCE(SUM(closing_credit), 0)::float                              AS advance,
                    COALESCE(SUM(bill_amount),    0)::float                              AS bill_amount,
                    COALESCE(SUM(receipt_amount), 0)::float                              AS collected,
                    COALESCE(ROUND(AVG(collection_pct), 1), 0)::float                   AS avg_collection_pct
                FROM agency_outstanding
                WHERE report_date = %s {scope_filter}
                GROUP BY unit_name
                ORDER BY outstanding DESC
            """, sp((date,)))
            units = [_clean(r) for r in cur.fetchall()]

            return {"date": date, "summary": summary, "units": units}


@app.get("/api/dashboard/outstanding/agencies")
def outstanding_agencies(
    unit_name: str,
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Agency-level outstanding detail for one unit — drilldown level 2."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(report_date)::text FROM agency_outstanding")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""

            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)
            if unit_codes is not None and len(unit_codes) > 0:
                placeholders = ",".join(["%s"] * len(unit_codes))
                cur.execute(f"""
                    SELECT 1 FROM agency_outstanding ao
                    JOIN units u ON (
                        ao.unit_name = u.unit_name
                        OR ao.unit_name = u.unit_name || ' RP'
                        OR ao.unit_name = u.unit_name || ' PT'
                        OR ao.unit_name = u.unit_name || ' DN'
                    )
                    WHERE ao.unit_name = %s AND u.unit_code IN ({placeholders})
                    LIMIT 1
                """, [unit_name] + unit_codes)
                if not cur.fetchone():
                    return {"date": date, "unit_name": unit_name, "agencies": []}

            cur.execute("""
                SELECT ag_code, agency_name, executive, status,
                       drop_point, district, zonal_head,
                       total_copies, daily_copies,
                       COALESCE(security_deposit,  0)::float AS security_deposit,
                       COALESCE(required_security, 0)::float AS required_security,
                       COALESCE(security_diff,     0)::float AS security_diff,
                       COALESCE(opening_debit,     0)::float AS opening_debit,
                       COALESCE(opening_credit,    0)::float AS opening_credit,
                       COALESCE(bill_amount,       0)::float AS bill_amount,
                       COALESCE(other_debits,      0)::float AS other_debits,
                       COALESCE(receipt_amount,    0)::float AS receipt_amount,
                       COALESCE(other_credits,     0)::float AS other_credits,
                       COALESCE(closing_debit,     0)::float AS closing_debit,
                       COALESCE(closing_credit,    0)::float AS closing_credit,
                       COALESCE(collection_pct,    0)::float AS collection_pct,
                       mobile_no, agency_type,
                       supply_start_date::text, supply_days,
                       last_supply_date::text, last_supply_post
                FROM agency_outstanding
                WHERE report_date = %s AND unit_name = %s
                ORDER BY closing_debit DESC NULLS LAST, agency_name
            """, (date, unit_name))
            agencies = [_clean(r) for r in cur.fetchall()]

            return {"date": date, "unit_name": unit_name, "agencies": agencies}


# ── Dashboard: Daily Supply ──────────────────────────────────────────────────

@app.get("/api/dashboard/supply")
def supply_dashboard(
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Daily supply KPIs — copies supplied, gainers, losers, hierarchy breakdown."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(supply_date)::text FROM daily_supply")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""
            if not date:
                return {"date": date, "summary": {}, "units": []}

            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)

            if unit_codes is None:
                scope_filter = ""
                scope_params: tuple = ()
            elif len(unit_codes) == 0:
                return {"date": date, "summary": {}, "units": []}
            else:
                placeholders = ",".join(["%s"] * len(unit_codes))
                cur.execute(f"""
                    SELECT DISTINCT ds.unit_name
                    FROM daily_supply ds
                    JOIN units u ON (
                        ds.unit_name = u.unit_name
                        OR ds.unit_name = u.unit_name || ' RP'
                        OR ds.unit_name = u.unit_name || ' PT'
                        OR ds.unit_name = u.unit_name || ' DN'
                    )
                    WHERE u.unit_code IN ({placeholders})
                """, unit_codes)
                scope_names = [r["unit_name"] for r in cur.fetchall()]
                if not scope_names:
                    return {"date": date, "summary": {}, "units": []}
                scope_filter = "AND unit_name = ANY(%s)"
                scope_params = ([scope_names],)

            def sp(base: tuple = ()) -> tuple:
                return base + scope_params

            cur.execute(f"""
                SELECT
                    COUNT(*)                                         AS total_agencies,
                    COALESCE(SUM(copies_supplied), 0)::float         AS total_copies,
                    COALESCE(AVG(copies_supplied), 0)::float         AS avg_copies,
                    SUM(CASE WHEN copies_supplied > 0 THEN 1 ELSE 0 END) AS active_agencies
                FROM daily_supply WHERE supply_date = %s {scope_filter}
            """, sp((date,)))
            summary = _clean(cur.fetchone() or {})

            cur.execute(f"""
                SELECT unit_name,
                    COUNT(*) AS agencies,
                    COALESCE(SUM(copies_supplied), 0)::float  AS total_copies,
                    COALESCE(AVG(copies_supplied), 0)::float  AS avg_copies
                FROM daily_supply
                WHERE supply_date = %s {scope_filter}
                GROUP BY unit_name
                ORDER BY total_copies DESC
            """, sp((date,)))
            units = [_clean(r) for r in cur.fetchall()]

            return {"date": date, "summary": summary, "units": units}


@app.get("/api/dashboard/supply/agencies")
def supply_agencies(
    unit_name: str,
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Agency-level supply detail for one unit."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(supply_date)::text FROM daily_supply")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""

            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)
            if unit_codes is not None and len(unit_codes) > 0:
                placeholders = ",".join(["%s"] * len(unit_codes))
                cur.execute(f"""
                    SELECT 1 FROM daily_supply ds
                    JOIN units u ON (
                        ds.unit_name = u.unit_name
                        OR ds.unit_name = u.unit_name || ' RP'
                        OR ds.unit_name = u.unit_name || ' PT'
                        OR ds.unit_name = u.unit_name || ' DN'
                    )
                    WHERE ds.unit_name = %s AND u.unit_code IN ({placeholders})
                    LIMIT 1
                """, [unit_name] + unit_codes)
                if not cur.fetchone():
                    return {"date": date, "unit_name": unit_name, "agencies": []}

            cur.execute("""
                SELECT ag_code, agency_name, executive, zonal_head,
                       COALESCE(copies_supplied, 0) AS copies_supplied
                FROM daily_supply
                WHERE supply_date = %s AND unit_name = %s
                ORDER BY copies_supplied DESC NULLS LAST, agency_name
            """, (date, unit_name))
            return {"date": date, "unit_name": unit_name,
                    "agencies": [_clean(r) for r in cur.fetchall()]}


# ── Dashboard: Daily Collection ───────────────────────────────────────────────

@app.get("/api/dashboard/collection")
def collection_dashboard(
    date: Optional[str] = None,
    x_person_code: Optional[str] = Header(None),
    x_hierarchy_level: Optional[str] = Header(None),
):
    """Daily collection KPIs — credit, cash, digital vs cash, hierarchy breakdown."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not date:
                cur.execute("SELECT MAX(collection_date)::text FROM daily_collection")
                row = cur.fetchone()
                date = row["max"] if row and row["max"] else ""
            if not date:
                return {"date": date, "summary": {}, "units": []}

            hl = int(x_hierarchy_level) if x_hierarchy_level and x_hierarchy_level.isdigit() else 1
            unit_codes = get_scope_unit_codes(cur, x_person_code or "", hl)

            if unit_codes is None:
                scope_filter = ""
                scope_params: tuple = ()
            elif len(unit_codes) == 0:
                return {"date": date, "summary": {}, "units": []}
            else:
                placeholders = ",".join(["%s"] * len(unit_codes))
                cur.execute(f"""
                    SELECT DISTINCT dc.unit_name
                    FROM daily_collection dc
                    JOIN units u ON (
                        dc.unit_name = u.unit_name
                        OR dc.unit_name = u.unit_name || ' RP'
                        OR dc.unit_name = u.unit_name || ' PT'
                        OR dc.unit_name = u.unit_name || ' DN'
                    )
                    WHERE u.unit_code IN ({placeholders})
                """, unit_codes)
                scope_names = [r["unit_name"] for r in cur.fetchall()]
                if not scope_names:
                    return {"date": date, "summary": {}, "units": []}
                scope_filter = "AND unit_name = ANY(%s)"
                scope_params = ([scope_names],)

            def sp(base: tuple = ()) -> tuple:
                return base + scope_params

            cur.execute(f"""
                SELECT
                    COUNT(*)                                                        AS total_transactions,
                    COALESCE(SUM(amount), 0)::float                                 AS total_collected,
                    COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0)::float AS credit_collection,
                    COALESCE(SUM(CASE WHEN sale_type='CASH'   THEN amount END), 0)::float AS cash_collection,
                    COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT') THEN amount END), 0)::float AS digital_collection,
                    COALESCE(SUM(CASE WHEN payment_mode='CASH' THEN amount END), 0)::float AS physical_cash,
                    COUNT(DISTINCT ag_code)                                         AS agencies_paid
                FROM daily_collection WHERE collection_date = %s {scope_filter}
            """, sp((date,)))
            summary = _clean(cur.fetchone() or {})

            cur.execute(f"""
                SELECT unit_name,
                    COUNT(*)                                                                AS transactions,
                    COALESCE(SUM(amount), 0)::float                                         AS total_collected,
                    COALESCE(SUM(CASE WHEN sale_type='CREDIT' THEN amount END), 0)::float   AS credit_collection,
                    COALESCE(SUM(CASE WHEN sale_type='CASH'   THEN amount END), 0)::float   AS cash_collection,
                    COALESCE(SUM(CASE WHEN payment_mode IN ('UPI','NEFT','CHEQUE','GATEWAY','DEMAND DRAFT') THEN amount END), 0)::float AS digital_collection,
                    COUNT(DISTINCT ag_code)                                                  AS agencies_paid
                FROM daily_collection
                WHERE collection_date = %s {scope_filter}
                GROUP BY unit_name
                ORDER BY total_collected DESC
            """, sp((date,)))
            units = [_clean(r) for r in cur.fetchall()]

            return {"date": date, "summary": summary, "units": units}


# ── Entry point ───────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("\n  Patrika Vitran API starting...")
    print(f"  Database : {DB_CONFIG['dbname']} @ {DB_CONFIG['host']}:{DB_CONFIG['port']}")
    print(f"  API docs : http://localhost:{API_PORT}/docs\n")
    uvicorn.run("server:app", host=API_HOST, port=API_PORT, reload=True)
