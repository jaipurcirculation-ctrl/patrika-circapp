# ─────────────────────────────────────────────────
# Patrika Vitran — Database connection config
# Edit DB_PASSWORD below before starting the server
# ─────────────────────────────────────────────────

DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "patrika_vitran",
    "user":     "postgres",
    "password": "Patrika@2026",   # ← change to the password you set during PostgreSQL install
}

# API server settings
API_HOST = "0.0.0.0"
API_PORT = 8000

# Origins allowed to call the API (the web app URL)
CORS_ORIGINS = [
    "http://localhost:8123",
    "http://127.0.0.1:8123",
    "http://localhost:8080",
]
