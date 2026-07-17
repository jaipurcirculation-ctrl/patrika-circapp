# Patrika Vitran Suite

Mobile-responsive circulation suite for the Patrika print network, built from the two reference prototypes:

- **Dashboard reference** — `vitran-circulation-os.html` → the *Dashboard — Vitran OS* menu group
  (Command Centre, Customers, Partners, Routes & Deliveries, Sales & Leads, Collections, Settlements, Complaints, Transport, Approvals, Reports, Masters & Admin)
- **User Input App reference** — `patrika-suite.html` → the *Field Apps* menu group with submenus
  (Agent App, Hawker App, DCR Forms, Survey Form, Taxi Fleet)

Role-based login (same demo users as the suite reference):

| User | Mobile | Password | Sees |
|---|---|---|---|
| Sanjay Jain (DMO) | 9714022891 | patrika@123 | Dashboard + all 5 field apps |
| Raj Sharma (Agent) | 9876543210 | agent@123 | Agent App, DCR Forms |
| Suresh Kumar (Hawker) | 8765432109 | hawker@123 | Hawker App |
| Priya Singh (Survey) | 7654321098 | survey@123 | Survey Form |
| Rajan Patel (Driver) | 6543210987 | taxi@123 | Taxi Fleet |
| Anita Verma (DCR) | 5432109876 | dcr@123 | DCR Forms, Survey Form |

All user input (surveys, DCR visits, payments, deliveries, approvals…) persists in the browser via `localStorage`.

## Run on localhost

```powershell
cd patrika-app
python -m http.server 8080 --directory www
# open http://localhost:8080
```

(Any static server works — no build step, no dependencies.)

## Install as a mobile app — two ways

### 1. PWA (works today, no tooling needed)
The site is a full Progressive Web App (manifest + offline service worker + icons).
Serve it over HTTPS (or localhost), open it in Chrome (Android) / Safari (iOS) and choose
**Add to Home Screen** — it installs with the Patrika icon, splash colour and runs full-screen offline.

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
  www/               ← the entire website (also the Capacitor webDir)
    index.html
    css/app.css      ← navy/gold print-industry theme, light+dark, mobile-first
    js/data.js       ← seed data adapted from the reference prototypes
    js/app.js        ← SPA: login, role menus/submenus, dashboard views, input forms
    assets/          ← Patrika logo + app icons
    manifest.webmanifest, sw.js
  capacitor.config.json
  package.json
```
