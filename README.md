# Patrika Vitran Suite

**One platform for the print circulation network — dashboards for leadership, field apps for agents, hawkers, surveyors and fleet.**

Built for Rajasthan Patrika's circulation operation. A single mobile-responsive app serves every role in the network:

- **Dashboard — Vitran OS** (leadership & office): Command Centre with live KPIs for Delivery, Routes, Drop Points, Supply, Collection and Outstanding, plus Customers, Partners, Sales & Leads, Settlements, Complaints, Transport, Approvals, Reports, and Masters & Admin.
- **Field Apps** (on-the-ground roles): Agent App, Hawker App, DCR Forms, Survey Form and Taxi Fleet.

What each user sees is driven by their role and position in the circulation hierarchy — an executive sees their own units, a zonal head sees their zone, VP Circulation sees everything.

## Architecture

```
Oracle ERP (13.126.110.180)          daily 6 AM sync (sqlplus → parse → load)
        │
        ▼
MySQL 8.4  patrika_vitran            21 tables: taxi logs, supply, collection,
        │                            outstanding, hierarchy, routes, masters
        ▼
Node.js API  (Express + mysql2)      api/server.js on port 8001
        │                            hierarchy-scoped dashboard endpoints
        ▼
SPA  (www/)                          vanilla JS PWA — phone, tablet, desktop
```

- **Data sources**: daily taxi drop-point data is pulled from the Oracle ERP (`api/oracle_sync.js`, scheduled 06:00 via Windows Task Scheduler); supply, collection and outstanding reports import from Excel (`api/import_excel_data.js`).
- **Login**: real users from the hierarchy master via `POST /api/login` (mobile + password), with role-based module visibility.
- **Dashboards**: every dashboard endpoint filters by the signed-in person's hierarchy scope (`x-person-code` / `x-hierarchy-level` headers).

## Run on localhost

```powershell
# 1. API (needs MySQL running and .env configured — see .env.example keys below)
cd patrika-app
npm install
node api/server.js          # http://localhost:8001

# 2. Web app
python -m http.server 8080 --directory www
# open http://localhost:8080
```

`.env` keys (never committed): `MYSQL_HOST/PORT/DB/USER/PASSWORD`, `API_PORT`, `CORS_ORIGINS`, `ORA_HOST/PORT/SERVICE/USER/PASSWORD` for the ERP sync.

## Data sync jobs

```powershell
node api/oracle_sync.js                              # yesterday's taxi data
node api/oracle_sync.js --date 2026-07-16            # a specific date
node api/oracle_bulk_sync.js --from 2026-05-31 --to 2026-07-17   # historical range
node api/import_excel_data.js                        # Excel reports from "Input Reports/"
```

`api/mysql_schema.sql` holds the full schema for a fresh MySQL install.

## Install as a mobile app — two ways

### 1. PWA (no tooling needed)
The site is a full Progressive Web App (manifest + offline service worker + icons).
Serve it over HTTPS (or localhost), open it in Chrome (Android) / Safari (iOS) and choose
**Add to Home Screen** — it installs with the Patrika icon, splash colour and runs full-screen.

### 2. Native APK / IPA via Capacitor (config included)
Requires **Node.js 18+** and **Android Studio** (Android) / **Xcode on macOS** (iOS):

```powershell
cd patrika-app
npm install
npx cap add android      # creates android/ project
npx cap sync
npx cap open android     # build APK/AAB from Android Studio (Build > Build APK)
```

For iOS (on a Mac): `npx cap add ios && npx cap open ios`, then archive from Xcode.
`capacitor.config.json` already sets the app id `com.patrika.vitran`, name, colours and web dir.

## Structure

```
patrika-app/
  api/
    server.js              ← Express API (mysql2), hierarchy-scoped dashboards
    oracle_sync.js         ← daily 6 AM Oracle ERP → MySQL sync
    oracle_bulk_sync.js    ← historical range import from Oracle
    import_excel_data.js   ← Excel report importer (Input Reports/)
    mysql_schema.sql       ← full MySQL schema (21 tables)
  www/                     ← the entire website (also the Capacitor webDir)
    index.html
    css/app.css            ← navy/gold print-industry theme, light+dark, mobile-first
    js/data.js             ← role/module config and seed data
    js/app.js              ← SPA: login, role menus, dashboard views, input forms
    assets/                ← Patrika logo + app icons
    manifest.webmanifest, sw.js
  scripts/                 ← Task Scheduler registration for the 6 AM sync
  capacitor.config.json
  package.json
```
