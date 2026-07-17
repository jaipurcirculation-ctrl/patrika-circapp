/* ═══════════ Patrika Vitran Suite — SPA ═══════════ */
"use strict";

/* ---------- navigation model (menus & submenus from both references) ---------- */
const DASH_MENU = [
  ["command",     "Command Centre",      "📊"],
  ["customers",   "Customers",           "👥"],
  ["partners",    "Partners",            "🤝"],
  ["routes",      "Routes & Deliveries", "🛣️"],
  ["salesleads",  "Sales & Leads",       "📈"],
  ["collections", "Collections",         "₹"],
  ["settlements", "Settlements",         "🧾"],
  ["complaints",  "Complaints",          "💬"],
  ["transport",   "Transport",           "🚚"],
  ["approvals",   "Approvals",           "✅"],
  ["reports",     "Reports",             "📑"],
  ["admin",       "Masters & Admin",     "⚙️"]
];

const APP_MENU = {
  agent:  { label: "Agent App",   icon: "🏢", tint: "var(--red-l)",   desc: "Agency management — supply, billing, collections and complaints.",
            sub: [["agent_day", "My Day"], ["agent_supply", "Supply & Net Sales"], ["agent_ledger", "Bills & Ledger"], ["agent_complaints", "Complaints"]] },
  hawker: { label: "Hawker App",  icon: "🛵", tint: "var(--teal-l)",  desc: "Delivery run, reader database, collections and earnings.",
            sub: [["hawker_day", "My Day"], ["hawker_route", "My Route"], ["hawker_readers", "My Readers"], ["hawker_collect", "Collect"], ["hawker_earn", "Earnings"]] },
  dcr:    { label: "DCR Forms",   icon: "📋", tint: "var(--gold-l)",  desc: "Daily Collection Register — attendance, visit entry and day report.",
            sub: [["dcr_att", "Attendance"], ["dcr_visit", "Visit Entry"], ["dcr_report", "Day Report"]] },
  survey: { label: "Survey Form", icon: "📝", tint: "var(--grn-l)",   desc: "Field lead capture with GPS, paper selection and instant submission.",
            sub: [["survey_new", "New Survey"], ["survey_leads", "My Leads"]] },
  taxi:   { label: "Taxi Fleet",  icon: "🚕", tint: "var(--blue-l)",  desc: "Fleet & dispatch — trips, trip logging and vehicle compliance.",
            sub: [["taxi_trips", "Today's Trips"], ["taxi_log", "Log Trip"], ["taxi_vehicles", "Vehicles"]] }
};

/* ---------- state & persistence ---------- */
let S = { user: null, screen: "home", openGroups: {}, sideOpen: false, drill: {}, live: {}, range: null };
const $ = s => document.querySelector(s);

/* ---------- date-range filter (null = latest day) ---------- */
function rangeQS(path) {
  if (!S.range) return path;
  const sep = path.includes("?") ? "&" : "?";
  return path + sep + "from=" + S.range.from + "&to=" + S.range.to;
}
function resetLiveData() {
  const dbUsers = S.live.dbUsers; // keep user list — not date-dependent
  S.live = { dbUsers };
}
window.applyDateRange = () => {
  const f = document.getElementById("dr-from")?.value;
  const t = document.getElementById("dr-to")?.value;
  if (!f || !t) { toast("Select both From and To dates"); return; }
  S.range = f <= t ? { from: f, to: t } : { from: t, to: f };
  resetLiveData();
  render();
};
window.clearDateRange = () => {
  S.range = null;
  resetLiveData();
  render();
};

/* ---------- PostgreSQL API client (port 8000) ---------- */
const api = {
  base: "http://localhost:8001",
  h() {
    const h = { "Content-Type": "application/json" };
    if (S.user?.mobile) h["x-user-mobile"] = S.user.mobile;
    if (S.user?.person_code) h["x-person-code"] = String(S.user.person_code);
    if (S.user?.hierarchyLevel) h["x-hierarchy-level"] = String(S.user.hierarchyLevel);
    return h;
  },
  async post(path, body) {
    try {
      const r = await fetch(this.base + path, { method: "POST", headers: this.h(), body: JSON.stringify(body) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async get(path) {
    try {
      const r = await fetch(this.base + path, { headers: this.h() });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }
};

/* ---------- live dashboard data fetch ---------- */
async function fetchDashboard() {
  if (S.live._loading) return;
  S.live._loading = true;
  const data = await api.get(rangeQS("/api/dashboard/delivery"));
  if (data) S.live.delivery = data;
  S.live._loading = false;
  if (S.screen === "command") render();
}
async function fetchRoutes(unitName) {
  const key = "routes_" + unitName;
  if (S.live[key]) return;
  const data = await api.get(rangeQS("/api/dashboard/routes?unit_name=" + encodeURIComponent(unitName)));
  if (data) S.live[key] = data;
  if (S.screen === "drill") render();
}
async function fetchHierarchyUsers() {
  if (S.live._usersLoading || S.live.dbUsers) return;
  S.live._usersLoading = true;
  const data = await api.get("/api/hierarchy/users");
  if (data && data.users) S.live.dbUsers = data.users;
  S.live._usersLoading = false;
  if (!S.user) render(); // re-render login page with real users
}
async function fetchDropPoints(routeCode) {
  const key = "dp_" + routeCode;
  if (S.live[key]) return;
  const data = await api.get(rangeQS("/api/dashboard/drop-points?route_code=" + encodeURIComponent(routeCode)));
  if (data) S.live[key] = data;
  if (S.screen === "drill") render();
}
async function fetchOutstanding() {
  if (S.live._outstandingLoading) return;
  S.live._outstandingLoading = true;
  const data = await api.get(rangeQS("/api/dashboard/outstanding"));
  if (data) S.live.outstanding = data;
  S.live._outstandingLoading = false;
  if (S.screen === "command" || S.screen === "drill") render();
}
async function fetchOutstandingAgencies(unitName) {
  const key = "outstanding_agencies_" + unitName;
  if (S.live[key]) return;
  const data = await api.get(rangeQS("/api/dashboard/outstanding/agencies?unit_name=" + encodeURIComponent(unitName)));
  if (data) S.live[key] = data;
  if (S.screen === "drill") render();
}
async function fetchSupply() {
  if (S.live._supplyLoading) return;
  S.live._supplyLoading = true;
  const data = await api.get(rangeQS("/api/dashboard/supply"));
  if (data) S.live.supply = data;
  S.live._supplyLoading = false;
  if (S.screen === "command" || S.screen === "drill") render();
}
async function fetchCollection() {
  if (S.live._collectionLoading) return;
  S.live._collectionLoading = true;
  const data = await api.get(rangeQS("/api/dashboard/collection"));
  if (data) S.live.collection = data;
  S.live._collectionLoading = false;
  if (S.screen === "command" || S.screen === "drill") render();
}
async function fetchSupplyAgencies(unitName) {
  const key = "supply_agencies_" + unitName;
  if (S.live[key]) return;
  const data = await api.get(rangeQS("/api/dashboard/supply/agencies?unit_name=" + encodeURIComponent(unitName)));
  if (data) S.live[key] = data;
  if (S.screen === "drill") render();
}

const store = {
  read() { try { return JSON.parse(localStorage.getItem("patrika_store")) || {}; } catch { return {}; } },
  write(d) { localStorage.setItem("patrika_store", JSON.stringify(d)); },
  get(k, fallback) { const d = this.read(); return k in d ? d[k] : fallback; },
  set(k, v) { const d = this.read(); d[k] = v; this.write(d); },
  push(k, v) { const d = this.read(); (d[k] = d[k] || []).push(v); this.write(d); }
};

function saveSession(u) { sessionStorage.setItem("patrika_user", u ? String(u.id) : ""); }
function restoreSession() {
  const id = Number(sessionStorage.getItem("patrika_user"));
  if (id) S.user = USERS.find(u => u.id === id) || null;
}

/* ---------- primitives ---------- */
function toast(msg) {
  document.querySelectorAll(".toast").forEach(e => e.remove());
  const e = document.createElement("div"); e.className = "toast"; e.textContent = msg;
  document.body.appendChild(e); setTimeout(() => e.remove(), 2600);
}
function modal(html) {
  const sc = document.createElement("div"); sc.className = "modal-scrim";
  sc.innerHTML = `<div class="modal">${html}</div>`;
  sc.addEventListener("click", e => { if (e.target === sc) sc.remove(); });
  document.body.appendChild(sc); return sc;
}
function closeModals() { document.querySelectorAll(".modal-scrim").forEach(e => e.remove()); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function go(screen) {
  S.screen = screen; S.sideOpen = false; render();
  const m = $(".main"); if (m) m.scrollTop = 0;
}
function login(id) { S.user = USERS.find(u => u.id === id); S.screen = "home"; saveSession(S.user); render(); }
function loginWithUser(u) {
  const dbUsers = S.live.dbUsers; // preserve user list across logins
  S.live = { dbUsers };
  S.user = u; S.screen = "home"; saveSession(u); render();
}
function logout() { S = { user: null, screen: "home", openGroups: {}, sideOpen: false, live: {} }; saveSession(null); fetchHierarchyUsers(); render(); }
function toggleSide() { S.sideOpen = !S.sideOpen; paintSide(); }
function toggleGroup(g) { S.openGroups[g] = !S.openGroups[g]; render(); }
function toggleTheme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark";
  localStorage.setItem("patrika_theme", document.documentElement.dataset.theme);
}
(function initTheme() { const t = localStorage.getItem("patrika_theme"); if (t) document.documentElement.dataset.theme = t; })();

/* ---------- hierarchy-aware home stats ---------- */
function homeStats(u) {
  const hl = u.hierarchyLevel || 99;
  if (hl === 1)  return [["5", "Zones"], ["12", "Branches"], ["124", "Agents"], ["4.1L+", "Copies/day"]];
  if (hl === 2)  return [["5", "Zones"], ["12", "Branches"], ["38", "Agencies"], ["5.1L", "Copies/day"]];
  if (hl === 3)  return [["4", "Branches"], ["38", "Agencies"], ["82", "Hawkers"], ["1.1L", "Copies/day"]];
  if (hl === 4)  return [["6", "Routes"], ["14", "Hawkers"], ["4,820", "Copies/day"], ["38", "Agencies"]];
  if (hl === 5)  return [["4", "Agents"], ["24", "Hawkers"], ["3.2k", "Rural readers"], ["₹1.2L", "Outstanding"]];
  if (hl === 6)  return [["6", "Centers"], ["58", "Hawkers"], ["8.6k", "City readers"], ["₹96k", "Due today"]];
  if (hl === 7)  return [["4", "Visits today"], ["2", "Agents"], ["62", "Leads (month)"], ["₹22k", "Collected"]];
  if (hl === 8)  return [["12", "Hawkers"], ["365", "Copies/day"], ["2", "Routes"], ["98%", "OTD"]];
  if (hl === 9)  return [["6", "Routes"], ["14", "Hawkers"], ["4,820", "Copies/day"], ["₹1.8L", "Outstanding"]];
  return [["365", "My copies"], ["126", "My stops"], ["₹3,355", "Collect today"], ["97%", "OTD"]];
}

/* ---------- generic form modal ---------- */
function formModal(title, intro, fields, submitLabel, onSubmit) {
  const m = modal(`
    <h3>${title}</h3>${intro ? `<p class="mint">${intro}</p>` : ""}
    ${fields.map(f => `<div class="fld"><label>${f.label}</label>${
      f.type === "select" ? `<select data-k="${f.k}">${f.opts.map(o => `<option ${o === f.val ? "selected" : ""}>${o}</option>`).join("")}</select>`
      : f.type === "textarea" ? `<textarea data-k="${f.k}" placeholder="${f.ph || ""}">${f.val || ""}</textarea>`
      : `<input data-k="${f.k}" type="${f.type || "text"}" value="${f.val ?? ""}" placeholder="${f.ph || ""}" ${f.attrs || ""}>`
    }</div>`).join("")}
    <div style="display:flex;gap:9px;margin-top:16px">
      <button class="btn pri block" data-submit>${submitLabel}</button>
      <button class="btn" data-cancel>Cancel</button>
    </div>`);
  m.querySelector("[data-cancel]").onclick = () => m.remove();
  m.querySelector("[data-submit]").onclick = () => {
    const vals = {};
    m.querySelectorAll("[data-k]").forEach(el => vals[el.dataset.k] = el.value.trim());
    if (onSubmit(vals) !== false) m.remove();
  };
  return m;
}

/* ---------- shared UI builders ---------- */
function kpi(label, value, delta, cls, icoBg, ico, drillMetric) {
  const attr = drillMetric
    ? ` role="button" onclick="openDrill('${drillMetric}')" style="cursor:pointer"`
    : "";
  return `<div class="card kpi"${attr}><div class="kico" style="background:${icoBg || "var(--gold-l)"}">${ico || "▦"}</div>
    <div class="lbl">${label}</div><div class="v num">${value}</div>${delta ? `<div class="d ${cls || "fl"}">${delta}</div>` : ""}</div>`;
}
function pagehead(title, sub, actions) {
  const u = S.user;
  const crumb = `${u.roleLabel}${u.scopeLabel ? " · " + u.scopeLabel : ""} · ${TODAY}`;
  return `<div class="pagehead"><div><div class="crumbs">${crumb}</div>
    <h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${actions || ""}</div>`;
}
function table(cols, rows) {
  return `<div class="card"><div class="tablewrap"><table>
    <thead><tr>${cols.map(c => `<th${c.startsWith(">") ? ' class="r"' : ""}>${c.replace(/^>/, "")}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody></table></div></div>`;
}
const chip = (cls, txt) => `<span class="chip ${cls}">${txt}</span>`;
const slaChip = st => chip(st === "crit" ? "crit" : st === "warn" ? "warn" : "good", "");

/* ═══════════ VIEWS ═══════════ */
const VIEWS = {};

/* ---- Home (module launcher, from suite reference) ---- */
VIEWS.home = () => {
  const u = S.user, hl = u.hierarchyLevel || 99;
  const apps = u.modules.map(k => {
    const a = APP_MENU[k];
    return `<button class="card appcard" onclick="go('${a.sub[0][0]}')">
      <div class="aico" style="background:${a.tint}">${a.icon}</div>
      <b>${a.label}</b><small>${a.desc}</small>
      <div class="tagrow">${a.sub.map(s => chip("mut", s[1])).join("")}</div></button>`;
  }).join("");
  const stats = homeStats(u);
  const statsHtml = stats.map(([v, l]) => `<div><b class="num">${v}</b><small>${l}</small></div>`).join("");
  const dashEntry = hl <= 4
    ? { screen:"command", title:"Vitran — Circulation OS",
        desc:"Command centre — pipeline, partners, collections, complaints, approvals and reports.",
        tags: chip("mut","Command Centre")+chip("mut","Approvals")+chip("mut","Reports") }
    : { screen:"routes",  title:"Field Operations Dashboard",
        desc:"Operational view — routes, deliveries, collections and complaints in your territory.",
        tags: chip("mut","Routes")+chip("mut","Collections")+chip("mut","Complaints") };
  return `
    <div class="hero"><h2>Namaste, ${u.name.split(" ")[0]} 🙏</h2>
      <p>${u.roleLabel} · ${u.scopeLabel} · Level ${hl} of 10</p>
      <div class="hstats">${statsHtml}</div></div>
    ${u.dashboard ? `<div class="sb-lbl" style="padding-left:2px">Dashboard</div>
      <div class="applist" style="margin-bottom:15px"><button class="card appcard" onclick="go('${dashEntry.screen}')">
      <div class="aico" style="background:var(--navy-l)">🗞️</div><b>${dashEntry.title}</b>
      <small>${dashEntry.desc}</small>
      <div class="tagrow">${dashEntry.tags}</div></button></div>` : ""}
    <div class="sb-lbl" style="padding-left:2px">Field Apps — User Input</div>
    <div class="applist">${apps}</div>`;
};

/* ---- Dashboard: Command Centre ---- */
VIEWS.command = () => {
  const u = S.user, hl = u.hierarchyLevel || 99;
  const ld = S.live.delivery; // live data (null until API responds)
  const lo = S.live.outstanding;

  /* Trigger background fetch if not yet loaded */
  if (!ld && !S.live._loading) setTimeout(fetchDashboard, 0);
  if (!lo && !S.live._outstandingLoading) setTimeout(fetchOutstanding, 0);
  if (!S.live.supply && !S.live._supplyLoading) setTimeout(fetchSupply, 0);
  if (!S.live.collection && !S.live._collectionLoading) setTimeout(fetchCollection, 0);

  /* --- Delivery KPI values: real data when available, static fallback --- */
  let otdVal, otdD, otdC, missVal, missD, missC, supplyVal;
  if (ld) {
    const sm = ld.summary;
    const pct = sm.otd_pct;
    otdVal  = pct + "%";
    otdD    = `${sm.on_time} on-time · ${sm.delayed} delayed · ${ld.date}`;
    otdC    = pct >= 70 ? "up" : pct >= 50 ? "fl" : "dn";
    missVal = fmtN(sm.missed_drops);
    missD   = `${fmtN(sm.delivered_drops)} delivered · ${sm.active_routes} routes`;
    missC   = sm.missed_drops < 500 ? "up" : "dn";
    supplyVal = fmtN(sm.total_supply);
  } else {
    otdVal  = S.live._loading ? "…" : "97.1%";
    otdD    = S.live._loading ? "Loading live data…" : "▲ 0.4% vs 7-day avg";
    otdC    = "fl";
    missVal = S.live._loading ? "…" : "1,940";
    missD   = S.live._loading ? "" : "▼ 210 vs yesterday";
    missC   = "up";
    supplyVal = "5.1L+";
  }

  /* --- Static KPI values (collection/outstanding/complaints not yet live) --- */
  let kv;
  if (hl <= 2) {
    kv = { col:lakh(6870000), colD:"62% of target", colC:"fl",
           out:lakh(5370000), outD:"▲ ageing 31–60d", outC:"dn",
           comp:"118", compD:"18 SLA at risk", compC:"dn",
           ren:"3,180", renD:"win-back list ready", renC:"fl" };
  } else if (hl === 3) {
    const z = ZONES_DATA.find(x => x.id === (u.zone_id || 1)) || ZONES_DATA[0];
    kv = { col:lakh(z.collected), colD:Math.round(z.collected/z.due*100)+"% collected", colC:"fl",
           out:lakh(z.out), outD:"zone outstanding", outC:"dn",
           comp:String(z.complaints), compD:z.branches+" branches", compC:"dn",
           ren:"842", renD:"renewal due 7d", renC:"fl" };
  } else {
    const b = BRANCHES_DATA.find(x => x.id === (u.branch_id || 1)) || BRANCHES_DATA[0];
    kv = { col:lakh(b.collected), colD:Math.round(b.collected/b.due*100)+"% collected", colC:"fl",
           out:lakh(b.out), outD:"branch outstanding", outC:"dn",
           comp:String(b.complaints), compD:b.agencies+" agencies", compC:"dn",
           ren:"214", renD:"renewal due 7d", renC:"fl" };
  }

  /* Override outstanding with live data when available */
  if (lo && lo.summary && lo.summary.total_outstanding != null) {
    const os = lo.summary;
    kv.out  = lakh(os.total_outstanding);
    kv.outD = `${fmtN(os.outstanding_agencies||0)} agencies · ${os.avg_collection_pct||0}% coll.`;
    kv.outC = "dn";
  }

  /* --- Delivery summary table: real units when live, static zones otherwise --- */
  let drillTable = "", tLabel;
  if (ld) {
    tLabel = `Delivery by RP unit — ${ld.date} (${ld.units.length} units)`;
    const rows = ld.units.map(u => {
      const cls = u.otd_pct >= 70 ? "up" : u.otd_pct >= 50 ? "fl" : "dn";
      return `<tr class="rowbtn" onclick="openDrillLive('${esc(u.unit_name)}')">
        <td><b>${esc(u.unit_name)}</b><small style="display:block;color:var(--muted)">${u.routes} routes · ${fmtN(u.supply)} supply</small></td>
        <td class="r num ${u.delayed>0?"dn":"up"}">${u.delayed}</td>
        <td class="r num up">${u.on_time}</td>
        <td class="r num ${cls}">${u.otd_pct}%</td>
        <td class="r num">${fmtN(u.actual_km)} km</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    drillTable = table(["RP Unit", ">Delayed", ">On-Time", ">OTD%", ">App KM", ""], [rows]);
  } else if (hl <= 2) {
    tLabel = "All Zones — plan vs delivered";
    const rows = ZONES_DATA.map(z => {
      const pct = Math.round(z.collected / z.due * 100);
      return `<tr class="rowbtn" onclick="openDrillAt('delivery','zone',${z.id})">
        <td><b>${z.name}</b><small style="display:block;color:var(--muted)">${z.region} · ${z.branches} branches · ${z.agencies} agencies</small></td>
        <td class="r num">${fmtN(z.copies_plan)}</td><td class="r num">${fmtN(z.copies_del)}</td>
        <td class="r num ${z.missed>3000?"dn":"up"}">${fmtN(z.missed)}</td>
        <td class="r num ${z.otd>=95?"up":z.otd>=92?"fl":"dn"}">${z.otd}%</td>
        <td class="r num ${pct>=70?"up":"fl"}">${pct}%</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    drillTable = table(["Zone", ">Planned", ">Delivered", ">Missed", ">OTD%", ">Collected%", ""], [rows]);
  } else if (hl === 3) {
    tLabel = "Branches in your zone";
    const bList = BRANCHES_DATA.filter(b => b.zone_id === (u.zone_id || 1));
    const rows = bList.map(b => {
      const pct = Math.round(b.collected / b.due * 100);
      return `<tr class="rowbtn" onclick="openDrillAt('delivery','branch',${b.id})">
        <td><b>${b.name}</b><small style="display:block;color:var(--muted)">${b.city} · ${b.agencies} agencies</small></td>
        <td class="r num">${fmtN(b.copies_plan)}</td><td class="r num">${fmtN(b.copies_del)}</td>
        <td class="r num ${b.missed>1000?"dn":"up"}">${fmtN(b.missed)}</td>
        <td class="r num ${b.otd>=96?"up":b.otd>=93?"fl":"dn"}">${b.otd}%</td>
        <td class="r num ${pct>=70?"up":"fl"}">${pct}%</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    drillTable = table(["Branch", ">Planned", ">Delivered", ">Missed", ">OTD%", ">Collected%", ""], [rows]);
  } else {
    tLabel = "Agencies in your branch";
    const aList = AGENCIES_DATA.filter(a => a.branch_id === (u.branch_id || 1));
    const rows = aList.map(a => {
      const pct = Math.round(a.collected / a.due * 100);
      return `<tr class="rowbtn" onclick="openDrillAt('delivery','agency','${a.id}')">
        <td><b>${a.name}</b><small style="display:block;color:var(--muted)">${a.area} · ${a.owner}</small></td>
        <td class="r num">${fmtN(a.copies_plan)}</td><td class="r num">${fmtN(a.copies_del)}</td>
        <td class="r num ${a.missed>100?"dn":"up"}">${fmtN(a.missed)}</td>
        <td class="r num ${a.otd>=96?"up":a.otd>=93?"fl":"dn"}">${a.otd}%</td>
        <td class="r num ${pct>=70?"up":"fl"}">${pct}%</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    drillTable = table(["Agency", ">Planned", ">Delivered", ">Missed", ">OTD%", ">Collected%", ""], [rows]);
  }

  const subTitle = hl<=2 ? "Circulation pipeline · All Rajasthan · live position"
                         : `Circulation pipeline · ${u.scopeLabel} · live`;

  const funnel = PIPE.map(p => `<div class="funnel-row"><span>${p.k}</span>
    <div class="funnel-bar"><i style="width:${(p.v/PIPE[0].v*100).toFixed(1)}%"></i></div>
    <span class="num" style="text-align:right;font-weight:700">${fmtN(p.v)}</span></div>`).join("");
  const exc = EXCEPTIONS.map(e => `<div class="exc">
    <div class="sev" style="background:var(--${e.sev==="crit"?"red":e.sev==="warn"?"gold":"blue"})"></div>
    <div style="flex:1;min-width:0"><b>${e.t}</b><small>${e.s}</small></div>
    <small style="color:var(--muted);flex:none">${e.when}</small></div>`).join("");

  const drInput = `background:var(--surf);border:1px solid var(--brd);border-radius:8px;padding:7px 10px;font-size:13px`;
  const rangeBar = `
    <div class="card pad" style="margin-bottom:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13px">📅 Report period</b>
      <input type="date" id="dr-from" value="${S.range ? S.range.from : ""}" style="${drInput}">
      <span style="color:var(--muted);font-size:12px">to</span>
      <input type="date" id="dr-to" value="${S.range ? S.range.to : ""}" style="${drInput}">
      <button class="btn" style="padding:7px 16px;font-size:13px" onclick="applyDateRange()">Apply</button>
      ${S.range
        ? `<button class="btn" style="padding:7px 12px;font-size:13px" onclick="clearDateRange()">✕ Reset</button>
           <span class="chip mut">Showing ${S.range.from === S.range.to ? S.range.from : S.range.from + " → " + S.range.to}</span>`
        : `<span class="chip mut">Showing latest day</span>`}
    </div>`;

  return pagehead("Command Centre", subTitle) + rangeBar + `
    <div class="grid kpis">
      ${kpi("On-time delivery",    otdVal,                   otdD,    otdC,    "var(--grn-l)",    "⏱️", "delivery")}
      ${kpi("Missed drop points",  missVal,                  missD,   missC,   "var(--red-l)",    "❌", "delivery")}
      ${(()=>{ const lc=S.live.collection; return kpi("Collections today", lc?lakh(lc.summary.total_collected):kv.col, lc?`${fmtN(lc.summary.agencies_paid)} agencies paid · ${lc.date}`:kv.colD, lc?"fl":kv.colC, "var(--gold-l)", "₹", "collection"); })()}
      ${kpi("Outstanding",         kv.out,                   kv.outD, kv.outC, "var(--red-l)",    "⚠️", "outstanding")}
      ${kpi("Open complaints",     kv.comp,                  kv.compD,kv.compC,"var(--gold-l)",   "💬", "complaints")}
      ${(()=>{ const ls=S.live.supply; return kpi("Today's supply", ls?fmtN(ls.summary.total_copies):(ld?supplyVal:"…"), ls?`${fmtN(ls.summary.active_agencies)} agencies · ${ls.date}`:(ld?`${(ld.units||[]).length} RP units`:"Loading…"), "fl", "var(--blue-l)", "📦", "supply"); })()}
      ${kpi("Pending approvals",   String(APPROVALS.length), "2 high priority","dn","var(--purple-l)","✅","approvals")}
      ${kpi("Vehicles delayed",    "1",                      "T-4471 · 55 min","dn","var(--teal-l)","🚚")}
    </div>
    <div class="two">
      <div>
        <div class="card pad" style="margin-bottom:13px"><div class="cardhead" style="padding:0 0 10px;border:none"><h3>Today's copy pipeline</h3><span class="chip mut">${TODAY}</span></div>${funnel}</div>
        <div class="card"><div class="cardhead"><h3>${tLabel}</h3><button class="act" onclick="openDrill('delivery')">Full detail →</button></div>
        ${drillTable}</div>
      </div>
      <div class="card"><div class="cardhead"><h3>Exceptions needing attention</h3><span class="chip crit">${EXCEPTIONS.filter(e=>e.sev==="crit").length} critical</span></div>${exc}</div>
    </div>`;
};

/* ---- Drill: openDrill / drillInto / drillBack ---- */
window.openDrill = metric => {
  const u = S.user, hl = u.hierarchyLevel || 99;
  /* For delivery, use live unit/route/droppoint levels if live data is available */
  if (metric === "delivery" && S.live.delivery) {
    S.drill = { metric, level:"unit", unitName:null, routeCode:null };
    go("drill"); return;
  }
  /* For outstanding, use live unit→agency levels if live data is available */
  if (metric === "outstanding") {
    if (!S.live.outstanding && !S.live._outstandingLoading) fetchOutstanding();
    S.drill = { metric, level:"unit", unitName:null, routeCode:null };
    go("drill"); return;
  }
  if (metric === "supply") {
    if (!S.live.supply && !S.live._supplyLoading) fetchSupply();
    S.drill = { metric, level:"unit", unitName:null, routeCode:null };
    go("drill"); return;
  }
  if (metric === "collection") {
    if (!S.live.collection && !S.live._collectionLoading) fetchCollection();
    S.drill = { metric, level:"unit", unitName:null, routeCode:null };
    go("drill"); return;
  }
  if (hl <= 2) S.drill = { metric, level:"zone",   zoneId:null,         branchId:null, agencyId:null };
  else if (hl === 3) S.drill = { metric, level:"branch", zoneId:u.zone_id||1,  branchId:null, agencyId:null };
  else         S.drill = { metric, level:"agency", zoneId:u.zone_id||1, branchId:u.branch_id||1, agencyId:null };
  go("drill");
};
window.openDrillAt = (metric, level, id) => {
  if (level === "zone")   S.drill = { metric, level:"branch", zoneId:id,  branchId:null, agencyId:null };
  if (level === "branch") S.drill = { metric, level:"agency", zoneId:null,branchId:id,   agencyId:null };
  if (level === "agency") S.drill = { metric, level:"hawker", zoneId:null,branchId:null, agencyId:id   };
  go("drill");
};
/* Live delivery drill: unit name -> routes -> drop points */
window.openDrillLive = unitName => {
  S.drill = { metric:"delivery", level:"unit", unitName:null, routeCode:null };
  go("drill");
  setTimeout(() => {
    S.drill.level = "route"; S.drill.unitName = unitName;
    fetchRoutes(unitName).then(() => render());
  }, 0);
};
window.drillInto = id => {
  const d = S.drill;
  if (d.level === "unit") {
    S.drill = { ...d, level:"route", unitName:id, routeCode:null };
    if (d.metric === "outstanding") fetchOutstandingAgencies(id);
    else if (d.metric === "supply") fetchSupplyAgencies(id);
    else fetchRoutes(id);
  } else if (d.level === "zone")   S.drill = { ...d, level:"branch", zoneId:id,  branchId:null, agencyId:null };
  else if (d.level === "branch") S.drill = { ...d, level:"agency", branchId:id, agencyId:null };
  else if (d.level === "agency") S.drill = { ...d, level:"hawker", agencyId:id };
  render(); const m = $(".main"); if (m) m.scrollTop = 0;
};
window.drillIntoRoute = routeCode => {
  S.drill = { ...S.drill, level:"droppoint", routeCode };
  fetchDropPoints(routeCode).then(() => render());
  const m = $(".main"); if (m) m.scrollTop = 0;
};
window.drillBack = level => {
  const d = S.drill;
  if (level === "unit")   S.drill = { ...d, level:"unit",  unitName:null, routeCode:null };
  if (level === "route")  S.drill = { ...d, level:"route", routeCode:null };
  if (level === "zone")   S.drill = { ...d, level:"zone",   zoneId:null,  branchId:null, agencyId:null };
  if (level === "branch") S.drill = { ...d, level:"branch", branchId:null,agencyId:null };
  if (level === "agency") S.drill = { ...d, level:"agency", agencyId:null };
  render(); const m = $(".main"); if (m) m.scrollTop = 0;
};

VIEWS.drill = () => {
  const u = S.user;
  const d = S.drill || {};
  const metric = d.metric || "delivery";
  const level  = d.level  || "zone";
  const MLABEL = { delivery:"Delivery Detail", collections:"Collections Detail",
                   outstanding:"Outstanding Detail", complaints:"Complaints Detail", approvals:"Approvals",
                   supply:"Supply Detail", collection:"Collection Detail" };

  /* breadcrumb */
  const bc = item => `<button class="btn sm" style="font-size:11px" onclick="${item.fn}">${item.label}</button>`;
  const crumbs = [bc({ label:"← Dashboard", fn:"go('command')" })];
  /* live delivery breadcrumbs */
  if ((level === "route" || level === "droppoint") && d.unitName) {
    crumbs.push(bc({ label:"All Units", fn:"drillBack('unit')" }));
    crumbs.push(bc({ label: esc(d.unitName), fn:"drillBack('route')" }));
  } else if (level === "unit") {
    /* at top-level live, no extra crumbs */
  }
  if (level === "droppoint" && d.routeCode) {
    crumbs.push(bc({ label: esc(d.routeCode), fn:"drillBack('route')" }));
  }
  /* static hierarchy breadcrumbs */
  if (d.zoneId  && (level==="branch"||level==="agency"||level==="hawker")) {
    const z = ZONES_DATA.find(x=>x.id===d.zoneId);
    crumbs.push(bc({ label: z ? z.name : "Zone", fn:"drillBack('zone')" }));
  }
  if (d.branchId && (level==="agency"||level==="hawker")) {
    const b = BRANCHES_DATA.find(x=>x.id===d.branchId);
    crumbs.push(bc({ label: b ? b.name : "Branch", fn:"drillBack('branch')" }));
  }
  if (d.agencyId && level==="hawker") {
    const a = AGENCIES_DATA.find(x=>x.id===d.agencyId);
    crumbs.push(bc({ label: a ? a.name : "Agency", fn:"drillBack('agency')" }));
  }
  const crumbBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${crumbs.join(" ")}</div>`;

  /* metric tabs */
  const metrics = ["delivery","supply","collection","outstanding","complaints"];
  const tabs = `<div class="seg" style="margin-bottom:14px">${metrics.map(m=>
    `<button class="${m===metric?"on":""}" onclick="S.drill.metric='${m}';render()">${(MLABEL[m]||m).split(" ")[0]}</button>`
  ).join("")}</div>`;

  /* level label */
  const LLABEL = {
    unit: metric === "outstanding" ? "Outstanding — All Units"
        : metric === "supply"      ? "Supply — All Units"
        : metric === "collection"  ? "Collection — All Units"
        : "All RP Units — live data",
    route: metric === "outstanding" ? (d.unitName ? `Outstanding — ${d.unitName}` : "Outstanding — Agencies")
         : metric === "supply"      ? (d.unitName ? `Supply — ${d.unitName}` : "Supply — Agencies")
         : (d.unitName ? `Routes in ${d.unitName}` : "Routes"),
    droppoint: d.routeCode ? `Drop Points — ${d.routeCode}` : "Drop Points",
    zone:"All Zones", branch:"Zone → Branches", agency:"Branch → Agencies", hawker:"Agency → Routes / Hawkers"
  };

  let body = "";

  if (level === "unit") {
    if (metric === "outstanding")   body = renderLiveOutstandingUnits();
    else if (metric === "supply")   body = renderLiveSupplyUnits();
    else if (metric === "collection") body = renderLiveCollectionUnits();
    else                            body = renderLiveUnits();
  } else if (level === "route") {
    if (metric === "outstanding")   body = renderLiveOutstandingAgencies(d.unitName);
    else if (metric === "supply")   body = renderLiveSupplyAgencies(d.unitName);
    else                            body = renderLiveRoutes(d.unitName);
  } else if (level === "droppoint") {
    body = renderLiveDropPoints(d.routeCode);
  } else if (level === "zone") {
    body = renderDrillZone(metric);
  } else if (level === "branch") {
    const list = BRANCHES_DATA.filter(b => !d.zoneId || b.zone_id === d.zoneId);
    body = renderDrillBranch(metric, list);
  } else if (level === "agency") {
    const list = AGENCIES_DATA.filter(a => !d.branchId || a.branch_id === d.branchId);
    body = renderDrillAgency(metric, list);
  } else {
    body = renderDrillHawker(metric);
  }

  return pagehead(MLABEL[metric] || metric, LLABEL[level] || level) + crumbBar + tabs + body;
};

/* ---- Live delivery render functions ---- */
function renderLiveUnits() {
  const ld = S.live.delivery;
  if (!ld) {
    if (!S.live._loading) setTimeout(fetchDashboard, 0);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading live delivery data…</div>`;
  }
  const rows = ld.units.map(u => {
    const cls = u.otd_pct >= 70 ? "up" : u.otd_pct >= 50 ? "fl" : "dn";
    const dCls = u.delayed > 0 ? "dn" : "up";
    return `<tr class="rowbtn" onclick="drillInto(${esc(JSON.stringify(u.unit_name))})">
      <td><b>${esc(u.unit_name)}</b><small style="display:block;color:var(--muted)">${u.routes} routes · supply ${fmtN(u.supply)}</small></td>
      <td class="r num ${dCls}">${u.delayed}</td>
      <td class="r num up">${u.on_time}</td>
      <td class="r num ${cls}">${u.otd_pct}%</td>
      <td class="r num">${fmtN(u.actual_km)} km</td>
      <td class="r num">${fmtN(u.delivered_drops)}</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`;
  }).join("");
  const sm = ld.summary;
  const summaryBar = `<div class="card pad" style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">
    <span><b>${ld.date}</b></span>
    <span>Routes: <b>${sm.total_routes}</b></span>
    <span>Supply: <b>${fmtN(sm.total_supply)}</b></span>
    <span class="${sm.otd_pct>=70?"up":"dn"}">OTD: <b>${sm.otd_pct}%</b></span>
    <span>Delivered drops: <b>${fmtN(sm.delivered_drops)}</b></span>
    <span class="dn">Missed drops: <b>${fmtN(sm.missed_drops)}</b></span>
    <span>App KM: <b>${fmtN(sm.actual_km)}</b></span>
  </div>`;
  return summaryBar + table(["RP Unit", ">Delayed", ">On-Time", ">OTD%", ">App KM", ">Drops Delivered", ""], [rows]);
}

function renderLiveRoutes(unitName) {
  if (!unitName) return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">No unit selected.</div>`;
  const key = "routes_" + unitName;
  const rd = S.live[key];
  if (!rd) {
    fetchRoutes(unitName);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading routes for <b>${esc(unitName)}</b>…</div>`;
  }
  const rows = rd.routes.map(r => {
    const dCls = r.is_delayed ? "dn" : "up";
    const depTime = r.actual_departure || r.scheduled_departure || "—";
    return `<tr class="rowbtn" onclick="drillIntoRoute(${esc(JSON.stringify(r.route_code || r.route_name))})">
      <td><b>${esc(r.route_name)}</b><small style="display:block;color:var(--muted)">${esc(r.sub_route_name||"")} · ${esc(r.taxi_type||"")}</small></td>
      <td class="r num">${fmtN(r.bundles||r.supply)}</td>
      <td class="r">${esc(r.vehicle_no||"—")}</td>
      <td class="r">${esc(depTime)}</td>
      <td class="r num ${dCls}">${r.delay_minutes != null ? (r.delay_minutes > 0 ? "+"+r.delay_minutes : r.delay_minutes) : "—"} min</td>
      <td class="r num">${r.planned_km != null ? r.planned_km+" km" : "—"}</td>
      <td class="r num">${r.actual_km != null ? r.actual_km+" km" : "—"}</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`;
  }).join("");
  return `<div style="color:var(--muted);font-size:12px;margin-bottom:8px">${rd.routes.length} routes · ${esc(rd.date)}</div>` +
    table(["Route / Sub-route", ">Supply", ">Vehicle", ">Departure", ">Delay", ">Plan KM", ">App KM", ""], [rows]);
}

function renderLiveDropPoints(routeCode) {
  if (!routeCode) return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">No route selected.</div>`;
  const key = "dp_" + routeCode;
  const dp = S.live[key];
  if (!dp) {
    fetchDropPoints(routeCode);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading drop points for <b>${esc(routeCode)}</b>…</div>`;
  }
  const rows = dp.drop_points.map(p => {
    const status = p.status === "delivered" ? `<span class="chip ok" style="font-size:11px">Delivered</span>`
                                             : `<span class="chip crit" style="font-size:11px">Missed</span>`;
    const diff = p.diff_minutes != null ? (p.diff_minutes > 0 ? `<span class="dn">+${p.diff_minutes}m</span>` : `<span class="up">${p.diff_minutes}m</span>`) : "—";
    const km = p.km_from_prev != null ? `${p.km_from_prev} km` : "—";
    return `<tr>
      <td><b>${esc(p.drop_point_name)}</b></td>
      <td class="r">${p.scheduled_arrival||"—"}</td>
      <td class="r">${p.actual_arrival||"—"}</td>
      <td class="r">${diff}</td>
      <td class="r num">${km}</td>
      <td class="r">${status}</td></tr>`;
  }).join("");
  const totalKm = dp.total_km != null ? dp.total_km : dp.drop_points.reduce((s,p) => s + (p.km_from_prev||0), 0).toFixed(2);
  return `<div style="display:flex;gap:16px;font-size:13px;margin-bottom:10px;flex-wrap:wrap">
    <span>Date: <b>${esc(dp.date)}</b></span>
    <span class="up">Delivered: <b>${fmtN(dp.delivered_count)}</b></span>
    <span class="dn">Missed: <b>${fmtN(dp.missed_count)}</b></span>
  </div>` +
  table(["Drop Point", ">Scheduled", ">Actual", ">Diff", ">Km", ">Status"], [rows]) +
  `<div style="text-align:right;font-size:13px;font-weight:600;padding:8px 12px;border-top:2px solid var(--border);margin-top:-1px">
    Total distance covered: <span class="num">${totalKm} km</span>
  </div>`;
}

function renderLiveOutstandingUnits() {
  const lo = S.live.outstanding;
  if (!lo) {
    if (!S.live._outstandingLoading) setTimeout(fetchOutstanding, 0);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading outstanding data…</div>`;
  }
  const sm = lo.summary;
  const summaryBar = `<div class="card pad" style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">
    <span><b>${lo.date}</b></span>
    <span>Agencies: <b>${fmtN(sm.total_agencies)}</b></span>
    <span class="dn">Outstanding: <b>${lakh(sm.total_outstanding)}</b></span>
    <span>Bill: <b>${lakh(sm.total_bill)}</b></span>
    <span class="up">Collected: <b>${lakh(sm.total_collected)}</b></span>
    <span>Avg coll%: <b>${sm.avg_collection_pct}%</b></span>
  </div>`;
  const rows = lo.units.map(un => {
    const cls = un.avg_collection_pct >= 70 ? "up" : un.avg_collection_pct >= 50 ? "fl" : "dn";
    return `<tr class="rowbtn" onclick="drillInto(${esc(JSON.stringify(un.unit_name))})">
      <td><b>${esc(un.unit_name)}</b><small style="display:block;color:var(--muted)">${un.agency_count} agencies · ${un.outstanding_count} with outstanding</small></td>
      <td class="r num dn">${lakh(un.outstanding)}</td>
      <td class="r num">${lakh(un.bill_amount)}</td>
      <td class="r num up">${lakh(un.collected)}</td>
      <td class="r num ${cls}">${un.avg_collection_pct}%</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`;
  }).join("");
  return summaryBar + table(["Unit", ">Outstanding", ">Bill", ">Collected", ">Coll%", ""], [rows]);
}

function renderLiveOutstandingAgencies(unitName) {
  if (!unitName) return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">No unit selected.</div>`;
  const key = "outstanding_agencies_" + unitName;
  const data = S.live[key];
  if (!data) {
    fetchOutstandingAgencies(unitName);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading agencies for <b>${esc(unitName)}</b>…</div>`;
  }
  const rows = data.agencies.map(a => {
    const collCls = a.collection_pct >= 70 ? "up" : a.collection_pct >= 50 ? "fl" : "dn";
    const bal = a.closing_debit > 0
      ? `<span class="dn">${lakh(a.closing_debit)} Dr</span>`
      : a.closing_credit > 0
        ? `<span class="up">${lakh(a.closing_credit)} Cr</span>`
        : "—";
    return `<tr>
      <td><b>${esc(a.agency_name)}</b><small style="display:block;color:var(--muted)">${esc(a.ag_code)} · ${esc(a.drop_point||a.district||"")}</small></td>
      <td>${esc(a.executive||"—")}</td>
      <td class="r num">${lakh(a.bill_amount)}</td>
      <td class="r num up">${lakh(a.receipt_amount)}</td>
      <td class="r num ${collCls}">${a.collection_pct}%</td>
      <td class="r num">${bal}</td></tr>`;
  }).join("");
  return `<div style="color:var(--muted);font-size:12px;margin-bottom:8px">${data.agencies.length} agencies · ${esc(unitName)} · ${esc(data.date)}</div>` +
    table(["Agency", "Executive", ">Bill", ">Collected", ">Coll%", ">Balance"], [rows]);
}

function renderLiveSupplyUnits() {
  const ls = S.live.supply;
  if (!ls) {
    if (!S.live._supplyLoading) setTimeout(fetchSupply, 0);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading supply data…</div>`;
  }
  const sm = ls.summary;
  const summaryBar = `<div class="card pad" style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">
    <span><b>${ls.date}</b></span>
    <span>Agencies: <b>${fmtN(sm.total_agencies)}</b></span>
    <span>Total copies: <b>${fmtN(sm.total_copies)}</b></span>
    <span>Avg/agency: <b>${Math.round(sm.avg_copies)}</b></span>
  </div>`;
  const rows = ls.units.map(u => {
    return `<tr class="rowbtn" onclick="drillInto(${esc(JSON.stringify(u.unit_name))})">
      <td><b>${esc(u.unit_name)}</b><small style="display:block;color:var(--muted)">${fmtN(u.agencies)} agencies</small></td>
      <td class="r num">${fmtN(u.total_copies)}</td>
      <td class="r num">${Math.round(u.avg_copies)}</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`;
  }).join("");
  return summaryBar + table(["Unit", ">Total Copies", ">Avg/Agency", ""], [rows]);
}

function renderLiveSupplyAgencies(unitName) {
  if (!unitName) return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">No unit selected.</div>`;
  const key = "supply_agencies_" + unitName;
  const data = S.live[key];
  if (!data) {
    fetchSupplyAgencies(unitName);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading agencies for <b>${esc(unitName)}</b>…</div>`;
  }
  const rows = data.agencies.map(a => {
    return `<tr>
      <td><b>${esc(a.agency_name || a.ag_code)}</b><small style="display:block;color:var(--muted)">${esc(a.ag_code)}</small></td>
      <td>${esc(a.executive || "—")}</td>
      <td class="r num">${fmtN(a.copies_supplied)}</td></tr>`;
  }).join("");
  return `<div style="color:var(--muted);font-size:12px;margin-bottom:8px">${data.agencies.length} agencies · ${esc(unitName)} · ${esc(data.date)}</div>` +
    table(["Agency", "Executive", ">Copies"], [rows]);
}

function renderLiveCollectionUnits() {
  const lc = S.live.collection;
  if (!lc) {
    if (!S.live._collectionLoading) setTimeout(fetchCollection, 0);
    return `<div class="card pad" style="text-align:center;color:var(--muted);padding:32px">Loading collection data…</div>`;
  }
  const sm = lc.summary;
  const digitalPctTotal = sm.total_collected > 0 ? Math.round(sm.digital_collection / sm.total_collected * 100) : 0;
  const summaryBar = `<div class="card pad" style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">
    <span><b>${lc.date}</b></span>
    <span class="up">Collected: <b>${lakh(sm.total_collected)}</b></span>
    <span>Transactions: <b>${fmtN(sm.total_transactions)}</b></span>
    <span>Agencies paid: <b>${fmtN(sm.agencies_paid)}</b></span>
    <span>Digital: <b>${lakh(sm.digital_collection)}</b> (${digitalPctTotal}%)</span>
    <span>Cash: <b>${lakh(sm.physical_cash)}</b></span>
  </div>`;
  const rows = lc.units.map(u => {
    const dpct = u.total_collected > 0 ? Math.round(u.digital_collection / u.total_collected * 100) : 0;
    return `<tr>
      <td><b>${esc(u.unit_name)}</b><small style="display:block;color:var(--muted)">${u.transactions} txns · ${u.agencies_paid} agencies</small></td>
      <td class="r num up">${lakh(u.total_collected)}</td>
      <td class="r num">${lakh(u.digital_collection)}</td>
      <td class="r num">${dpct}%</td></tr>`;
  }).join("");
  return summaryBar + table(["Unit", ">Collected", ">Digital", ">Digital%"], [rows]);
}

function renderDrillZone(metric) {
  if (metric === "delivery") {
    const rows = ZONES_DATA.map(z=>`<tr class="rowbtn" onclick="drillInto(${z.id})">
      <td><b>${z.name}</b><small style="display:block;color:var(--muted)">${z.region} · ${z.branches} branches · ${z.agencies} agencies</small></td>
      <td class="r num">${fmtN(z.copies_plan)}</td><td class="r num">${fmtN(z.copies_del)}</td>
      <td class="r num ${z.missed>3000?"dn":"up"}">${fmtN(z.missed)}</td>
      <td class="r num ${z.otd>=95?"up":z.otd>=92?"fl":"dn"}">${z.otd}%</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`).join("");
    return table(["Zone / Region",">Planned",">Delivered",">Missed",">OTD%",""], [rows]);
  }
  if (metric === "collections" || metric === "outstanding") {
    const rows = ZONES_DATA.map(z=>{
      const pct=Math.round(z.collected/z.due*100);
      return `<tr class="rowbtn" onclick="drillInto(${z.id})">
        <td><b>${z.name}</b><small style="display:block;color:var(--muted)">${z.region} · ${z.branches} branches</small></td>
        <td class="r num">${lakh(z.due)}</td><td class="r num up">${lakh(z.collected)}</td>
        <td class="r num ${pct>=70?"up":pct>=60?"fl":"dn"}">${pct}%</td>
        <td class="r num dn">${lakh(z.out)}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Zone / Region",">Due — July",">Collected",">%",">Outstanding",""], [rows]);
  }
  if (metric === "complaints") {
    const rows = ZONES_DATA.map(z=>{
      const ip=Math.round(z.complaints*.4), res=Math.round(z.complaints*.2);
      return `<tr class="rowbtn" onclick="drillInto(${z.id})">
        <td><b>${z.name}</b><small style="display:block;color:var(--muted)">${z.region} · ${z.branches} branches</small></td>
        <td class="r num ${z.complaints>40?"dn":"fl"}">${z.complaints}</td>
        <td class="r num fl">${ip}</td><td class="r num up">${res}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Zone / Region",">Open",">In Progress",">Resolved Today",""], [rows]);
  }
  return "";
}

function renderDrillBranch(metric, list) {
  if (metric === "delivery") {
    const rows = list.map(b=>{
      const zn = ZONES_DATA.find(z=>z.id===b.zone_id);
      return `<tr class="rowbtn" onclick="drillInto(${b.id})">
        <td><b>${b.name}</b><small style="display:block;color:var(--muted)">${b.city}${zn?" · "+zn.name:""} · ${b.agencies} agencies</small></td>
        <td class="r num">${fmtN(b.copies_plan)}</td><td class="r num">${fmtN(b.copies_del)}</td>
        <td class="r num ${b.missed>1000?"dn":"up"}">${fmtN(b.missed)}</td>
        <td class="r num ${b.otd>=96?"up":b.otd>=93?"fl":"dn"}">${b.otd}%</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Branch",">Planned",">Delivered",">Missed",">OTD%",""], [rows]);
  }
  if (metric === "collections" || metric === "outstanding") {
    const rows = list.map(b=>{
      const pct=Math.round(b.collected/b.due*100), zn=ZONES_DATA.find(z=>z.id===b.zone_id);
      return `<tr class="rowbtn" onclick="drillInto(${b.id})">
        <td><b>${b.name}</b><small style="display:block;color:var(--muted)">${b.city}${zn?" · "+zn.name:""}</small></td>
        <td class="r num">${lakh(b.due)}</td><td class="r num up">${lakh(b.collected)}</td>
        <td class="r num ${pct>=70?"up":pct>=60?"fl":"dn"}">${pct}%</td>
        <td class="r num dn">${lakh(b.out)}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Branch",">Due — July",">Collected",">%",">Outstanding",""], [rows]);
  }
  if (metric === "complaints") {
    const rows = list.map(b=>{
      const ip=Math.round(b.complaints*.4), res=Math.round(b.complaints*.2), zn=ZONES_DATA.find(z=>z.id===b.zone_id);
      return `<tr class="rowbtn" onclick="drillInto(${b.id})">
        <td><b>${b.name}</b><small style="display:block;color:var(--muted)">${b.city}${zn?" · "+zn.name:""}</small></td>
        <td class="r num ${b.complaints>10?"dn":"fl"}">${b.complaints}</td>
        <td class="r num fl">${ip}</td><td class="r num up">${res}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Branch",">Open",">In Progress",">Resolved Today",""], [rows]);
  }
  return "";
}

function renderDrillAgency(metric, list) {
  if (metric === "delivery") {
    const rows = list.map(a=>`<tr class="rowbtn" onclick="drillInto('${a.id}')">
      <td><b>${a.name}</b><small style="display:block;color:var(--muted)">${a.area} · ${a.owner}</small></td>
      <td class="r num">${fmtN(a.copies_plan)}</td><td class="r num">${fmtN(a.copies_del)}</td>
      <td class="r num ${a.missed>100?"dn":"up"}">${fmtN(a.missed)}</td>
      <td class="r num ${a.otd>=96?"up":a.otd>=93?"fl":"dn"}">${a.otd}%</td>
      <td>${chip(a.tier==="Platinum"?"purple":a.tier==="Gold"?"warn":"mut",a.tier)}</td>
      <td class="r" style="color:var(--acc)">▶</td></tr>`).join("");
    return table(["Agency",">Planned",">Delivered",">Missed",">OTD%","Tier",""], [rows]);
  }
  if (metric === "collections" || metric === "outstanding") {
    const rows = list.map(a=>{
      const pct=Math.round(a.collected/a.due*100);
      return `<tr class="rowbtn" onclick="drillInto('${a.id}')">
        <td><b>${a.name}</b><small style="display:block;color:var(--muted)">${a.area} · ${a.owner}</small></td>
        <td class="r num">${lakh(a.due)}</td><td class="r num up">${lakh(a.collected)}</td>
        <td class="r num ${pct>=70?"up":pct>=60?"fl":"dn"}">${pct}%</td>
        <td class="r num ${a.out>300000?"dn":"fl"}">${lakh(a.out)}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Agency",">Due — July",">Collected",">%",">Outstanding",""], [rows]);
  }
  if (metric === "complaints") {
    const rows = list.map(a=>{
      const ip=Math.round(a.complaints*.4), res=Math.round(a.complaints*.2);
      return `<tr class="rowbtn" onclick="drillInto('${a.id}')">
        <td><b>${a.name}</b><small style="display:block;color:var(--muted)">${a.area} · ${a.owner}</small></td>
        <td class="r num ${a.complaints>=6?"dn":"fl"}">${a.complaints}</td>
        <td class="r num fl">${ip}</td><td class="r num up">${res}</td>
        <td class="r" style="color:var(--acc)">▶</td></tr>`;
    }).join("");
    return table(["Agency",">Open",">In Progress",">Resolved Today",""], [rows]);
  }
  return "";
}

function renderDrillHawker(metric) {
  /* deepest level — shows individual routes/hawkers */
  const rows = ROUTES.map(r=>`<tr>
    <td><b>${r.id}</b></td><td>${r.hawker}</td>
    <td class="r num">${r.copies}</td><td class="r num">${r.done}/${r.stops}</td>
    <td class="r num ${r.missed>2?"dn":"fl"}">${r.missed}</td>
    <td>${chip(r.status==="Completed"?"good":"info",r.status)}</td>
    <td>${r.window}</td></tr>`).join("");
  return table(["Route","Hawker",">Copies",">Stops done",">Missed","Status","Window"], [rows]);
}

/* ---- Dashboard: Customers ---- */
VIEWS.customers = () => {
  const extra = store.get("customers", []);
  const all = [...CUSTOMERS, ...extra];
  const rows = all.map(c => `<tr class="rowbtn" onclick='custDetail(${JSON.stringify(c.id)})'>
    <td><b>${esc(c.name)}</b><br><small style="color:var(--muted)">${c.id}</small></td>
    <td>${esc(c.plan)}</td><td>${c.route}</td>
    <td class="r num">${c.out ? fmtC(c.out) : "—"}</td>
    <td>${chip(c.churn === "High" ? "crit" : c.churn === "Medium" ? "warn" : "good", c.churn + " risk")}</td>
    <td>${chip(c.status === "Active" ? "good" : c.status === "Paused" ? "mut" : "warn", c.status)}</td></tr>`).join("");
  return pagehead("Customers", `${fmtN(412500 + extra.length)} active subscribers · Jaipur district view`,
    `<button class="btn pri" onclick="newSubscription()">＋ New subscription</button>`) +
    table(["Customer", "Plan", "Route", ">Outstanding", "Churn", "Status"], [rows]);
};
window.custDetail = id => {
  const c = [...CUSTOMERS, ...store.get("customers", [])].find(x => x.id === id); if (!c) return;
  modal(`<h3>${esc(c.name)} <span class="chip mut">${c.id}</span></h3><p class="mint">${esc(c.addr)}</p>
    <div class="detailgrid">
      <div><div class="lbl">Plan</div>${esc(c.plan)}</div><div><div class="lbl">Route</div>${c.route}</div>
      <div><div class="lbl">Phone</div>${c.phone}</div><div><div class="lbl">Outstanding</div>${c.out ? fmtC(c.out) : "Nil"}</div>
      <div><div class="lbl">Churn risk</div>${c.churn}</div><div><div class="lbl">Status</div>${c.status}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
      <button class="btn pri sm" onclick="toast('Renewal link sent on WhatsApp')">Renew now</button>
      <button class="btn sm" onclick="toast('Delivery paused — credit will apply')">Pause</button>
      <button class="btn crit sm" onclick="toast('Complaint logged — ticket created')">Log complaint</button>
      <button class="btn sm" onclick="closeModals()">Close</button>
    </div>`);
};
window.newSubscription = () => formModal("New subscription", "Customer 360 record is created and the route hawker is notified.",
  [{ k: "name", label: "Full name", ph: "e.g. Rekha Sharma" },
   { k: "phone", label: "Mobile", type: "tel", ph: "10-digit mobile" },
   { k: "addr", label: "Address", type: "textarea", ph: "House, colony, landmark" },
   { k: "plan", label: "Plan", type: "select", opts: ["RP City · Monthly ₹360", "RP City · Annual ₹3,960", "RP City + Plus · Monthly ₹475", "Trial 14-day · Free", "Monsoon 3-month pack ₹960"] },
   { k: "route", label: "Route", type: "select", opts: ROUTES.map(r => r.id) }],
  "Create subscription", v => {
    if (!v.name || !/^\d{10}$/.test(v.phone.replace(/\D/g, ""))) { toast("Enter name and a valid 10-digit mobile"); return false; }
    store.push("customers", { id: "C-" + Math.floor(107100 + Math.random() * 800), name: v.name, phone: v.phone, addr: v.addr, plan: v.plan.split(" ₹")[0], route: v.route, out: 0, churn: "Low", status: "Active" });
    api.post("/api/customers", { name: v.name, phone: v.phone, address: v.addr, plan: v.plan, route: v.route });
    toast("Subscription created ✓"); render();
  });

/* ---- Dashboard: Partners ---- */
VIEWS.partners = () => {
  const rows = AGENCIES.map(a => `<tr>
    <td><b>${a.name}</b><br><small style="color:var(--muted)">${a.area} · ${a.owner}</small></td>
    <td class="r num">${fmtN(a.copies)}</td><td class="r num">${a.otd}%</td>
    <td class="r num">${lakh(a.out)}</td>
    <td><div class="bar"><i style="width:${a.score}%;background:${a.score >= 85 ? "var(--grn)" : a.score >= 75 ? "var(--gold)" : "var(--red)"}"></i></div></td>
    <td>${chip(a.tier === "Platinum" ? "purple" : a.tier === "Gold" ? "warn" : "mut", a.tier)}</td>
    <td class="r num">${a.routes} / ${a.hawkers}</td></tr>`).join("");
  return pagehead("Partners", "38 agencies · 214 routes · Jaipur district") + `
    <div class="grid kpis">
      ${kpi("Active agencies", "38", "", "", "var(--gold-l)", "🤝")}
      ${kpi("Active hawkers", "512", "31 substitutes today", "fl", "var(--teal-l)", "🛵")}
      ${kpi("Settlement due", lakh(1846200), "June cycle", "fl", "var(--red-l)", "🧾")}
      ${kpi("Loyalty — Gold+", "21", "score ≥ 85", "up", "var(--purple-l)", "⭐")}
    </div>` +
    table(["Agency", ">Copies/day", ">OTD", ">Outstanding", "Score", "Tier", ">Routes / Hawkers"], [rows]);
};

/* ---- Dashboard: Routes & Deliveries ---- */
VIEWS.routes = () => {
  const rows = ROUTES.map(r => `<tr>
    <td><b>${r.id}</b></td><td>${r.hawker}</td><td class="r num">${r.copies}</td>
    <td class="r num">${r.done}/${r.stops}</td><td class="r num">${r.missed}</td>
    <td>${chip(r.status === "Completed" ? "good" : "info", r.status)}</td><td class="num">${r.window}</td></tr>`).join("");
  return pagehead("Routes & Deliveries", "Shree Ganesh News Agency · Malviya Nagar · 6 routes") + `
    <div class="grid kpis">
      ${kpi("Routes done", "4 / 6", "2 out for delivery", "fl", "var(--grn-l)", "🛣️")}
      ${kpi("Stops covered", "715 / 731", "97.8%", "up", "var(--gold-l)", "🏠")}
      ${kpi("Missed today", "12", "vs 16 yesterday", "up", "var(--red-l)", "❌")}
      ${kpi("Avg finish time", "07:41", "window ends 07:30", "dn", "var(--blue-l)", "⏰")}
    </div>` +
    table(["Route", "Hawker", ">Copies", ">Stops done", ">Missed", "Status", "Window"], [rows]);
};

/* ---- Dashboard: Sales & Leads ---- */
VIEWS.salesleads = () => {
  const stages = Object.entries({ Surveyed: LEADS.surveyed, Interested: LEADS.interested, "Trial started": LEADS.trial, "Offer shared": LEADS.offer, Converted: LEADS.converted });
  const funnel = stages.map(([k, v]) => `<div class="funnel-row"><span>${k}</span>
    <div class="funnel-bar"><i style="width:${(v / LEADS.surveyed * 100).toFixed(1)}%"></i></div>
    <span class="num" style="text-align:right;font-weight:700">${fmtN(v)}</span></div>`).join("");
  const mine = store.get("leads", []);
  const rows = [...LEADLIST, ...mine].map(l => `<tr>
    <td><b>${esc(l.name)}</b><br><small style="color:var(--muted)">${esc(l.area)} · ${esc(l.phone)}</small></td>
    <td>${esc(l.pub)}</td><td>${chip(l.stage === "Converted" ? "good" : l.stage === "Payment pending" ? "warn" : "info", l.stage)}</td>
    <td>${esc(l.next || "—")}</td>
    <td><div class="bar"><i style="width:${l.score}%;background:${l.score >= 75 ? "var(--grn)" : "var(--gold)"}"></i></div></td></tr>`).join("");
  return pagehead("Sales & Leads", "Monsoon acquisition drive · Jaipur West") + `
    <div class="two"><div class="card pad"><div class="cardhead" style="padding:0 0 10px;border:none"><h3>Acquisition funnel — July</h3></div>${funnel}</div>
    <div class="card pad"><div class="cardhead" style="padding:0 0 10px;border:none"><h3>Campaign</h3></div>
      <div class="stat-pair"><span>Campaign</span><b>Monsoon 3-month pack ₹960</b></div>
      <div class="stat-pair"><span>Conversion rate</span><b class="num">5.2%</b></div>
      <div class="stat-pair"><span>Cost per acquisition</span><b class="num">₹118</b></div>
      <div class="stat-pair"><span>Best area</span><b>Nirman Nagar B</b></div></div></div>
    <div style="height:13px"></div>` +
    table(["Lead", "Publication", "Stage", "Next action", "Score"], [rows]);
};

/* ---- Dashboard: Collections ---- */
VIEWS.collections = () => {
  const extra = store.get("receipts", []);
  const rows = PAYMENTS.map((p, i) => `<tr>
    <td><b>${p.cust}</b><br><small style="color:var(--muted)">${p.id} · ${p.route}</small></td>
    <td class="r num">${fmtC(p.amt)}</td>
    <td>${chip(p.status === "Overdue" ? "crit" : "warn", p.due)}</td>
    <td class="r"><button class="btn good sm" onclick="recordPayment(${i})">Record payment</button></td></tr>`).join("");
  const rcpt = [...extra.slice().reverse(), ...RECEIPTS].map(r => `<div class="stat-pair">
    <span><b style="color:var(--ink)">${esc(r.cust)}</b><br><small>${r.no} · ${r.mode} · ${r.by}</small></span>
    <b class="num">${fmtC(r.amt)}</b></div>`).join("");
  return pagehead("Collections", "July cycle · due & received") + `
    <div class="grid kpis">
      ${kpi("Due — July", lakh(11100000), "", "", "var(--gold-l)", "₹")}
      ${kpi("Collected", lakh(6870000), "62% · ▲ 4% WoW", "up", "var(--grn-l)", "✅")}
      ${kpi("Digital share", "68%", "target 70%", "fl", "var(--blue-l)", "📱")}
      ${kpi("Unreconciled", "₹48,200", "UPI batch #U-8842", "dn", "var(--red-l)", "⚠️")}
    </div>
    <div class="two">
      <div class="card"><div class="cardhead"><h3>Payments to collect</h3></div>
        <div class="tablewrap"><table><thead><tr><th>Customer</th><th class="r">Amount</th><th>Due</th><th class="r"></th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="card pad"><div class="cardhead" style="padding:0 0 8px;border:none"><h3>Recent receipts</h3></div>${rcpt}</div>
    </div>`;
};
window.recordPayment = i => {
  const p = PAYMENTS[i];
  formModal("Record payment", `${p.cust} · ${p.id} · due ${fmtC(p.amt)}`,
    [{ k: "amt", label: "Amount received (₹)", type: "number", val: p.amt },
     { k: "mode", label: "Mode", type: "select", opts: ["UPI", "Cash", "Card", "Bank transfer"] },
     { k: "note", label: "Note (optional)", ph: "reference / remarks" }],
    "Save receipt", v => {
      if (!Number(v.amt)) { toast("Enter a valid amount"); return false; }
      store.push("receipts", { no: "R-" + Math.floor(99150 + Math.random() * 800), cust: p.cust, amt: Number(v.amt), mode: v.mode, by: S.user.name, at: "just now" });
      api.post("/api/payments", { customer_name: p.cust, amount: Number(v.amt), method: v.mode, notes: v.note || "" });
      toast(`Receipt saved — ${fmtC(Number(v.amt))} ✓`); render();
    });
};

/* ---- Dashboard: Settlements ---- */
VIEWS.settlements = () => {
  const lines = SETTLEMENT.lines.map(([k, v]) => `<div class="stat-pair"><span>${k}</span>
    <b class="num ${v < 0 ? "dn" : "up"}">${v < 0 ? "−" : "+"}${fmtC(Math.abs(v))}</b></div>`).join("");
  const done = store.get("settlementApproved", false);
  return pagehead("Settlements", "Maker–checker settlement cycle · monthly") + `
    <div class="two"><div class="card pad">
      <div class="cardhead" style="padding:0 0 10px;border:none"><h3>${SETTLEMENT.partner}</h3>
        ${chip(done ? "good" : "warn", done ? "Approved" : SETTLEMENT.status)}</div>
      <div class="lbl" style="margin-bottom:6px">Period — ${SETTLEMENT.period}</div>${lines}
      <div class="stat-pair" style="border-top:2px solid var(--brd);margin-top:6px"><span><b style="color:var(--ink)">Net payable to agency</b></span><b class="num" style="font-size:16px">${fmtC(SETTLEMENT.net)}</b></div>
      ${done ? "" : `<div style="display:flex;gap:9px;margin-top:16px">
        <button class="btn pri" onclick="store.set('settlementApproved',true);toast('Settlement approved — payout queued');render()">Approve & release</button>
        <button class="btn" onclick="toast('Returned to finance desk with query')">Query</button></div>`}
    </div>
    <div class="card pad"><div class="cardhead" style="padding:0 0 10px;border:none"><h3>Cycle status — June</h3></div>
      <div class="stat-pair"><span>Statements generated</span><b class="num">38 / 38</b></div>
      <div class="stat-pair"><span>Acknowledged by agency</span><b class="num">34</b></div>
      <div class="stat-pair"><span>Approved</span><b class="num">${done ? 30 : 29}</b></div>
      <div class="stat-pair"><span>Paid out</span><b class="num">26</b></div>
      <div class="stat-pair"><span>Disputed</span><b class="num dn">2</b></div></div></div>`;
};

/* ---- Dashboard: Complaints ---- */
VIEWS.complaints = () => {
  const extra = store.get("complaints", []);
  const rows = [...extra.slice().reverse(), ...COMPLAINTS].map(c => `<tr>
    <td><b>${c.id}</b></td><td><b>${esc(c.cust)}</b><br><small style="color:var(--muted)">${esc(c.cat)}</small></td>
    <td>${c.route}</td>
    <td>${chip(c.slaState === "crit" ? "crit" : c.slaState === "warn" ? "warn" : "good", c.sla)}</td>
    <td>${chip(c.pri === "High" ? "crit" : c.pri === "Medium" ? "warn" : "mut", c.pri)}</td>
    <td>${chip(c.status === "Resolved" ? "good" : c.status === "Escalated" ? "crit" : "info", c.status)}</td></tr>`).join("");
  return pagehead("Complaints", "SLA-tracked service desk", `<button class="btn pri" onclick="logComplaint()">＋ Log complaint</button>`) + `
    <div class="grid kpis">
      ${kpi("Open", String(48 + extra.length), "9 SLA at risk", "dn", "var(--red-l)", "💬")}
      ${kpi("Avg resolution", "5h 12m", "target 8h", "up", "var(--grn-l)", "⏱️")}
      ${kpi("Repeat complainants", "31", "root-cause review due", "fl", "var(--gold-l)", "🔁")}
      ${kpi("Per 10k copies", "1.2", "▼ 0.2 MoM", "up", "var(--blue-l)", "📉")}
    </div>` +
    table(["Ticket", "Customer", "Route", "SLA", "Priority", "Status"], [rows]);
};
window.logComplaint = () => formModal("Log complaint", "Ticket is auto-assigned by route with an SLA timer.",
  [{ k: "cust", label: "Customer", ph: "name or customer ID" },
   { k: "cat", label: "Category", type: "select", opts: ["Newspaper not delivered", "Late delivery (after 7:30)", "Short supply", "Damaged copy", "Billing issue", "Pause / restart request"] },
   { k: "route", label: "Route", type: "select", opts: ROUTES.map(r => r.id) },
   { k: "pri", label: "Priority", type: "select", opts: ["High", "Medium", "Low"] },
   { k: "note", label: "Details", type: "textarea" }],
  "Create ticket", v => {
    if (!v.cust) { toast("Enter the customer name"); return false; }
    store.push("complaints", { id: "T-" + Math.floor(88250 + Math.random() * 700), cust: v.cust, cat: v.cat, route: v.route, sla: "8h left", slaState: "good", pri: v.pri, status: "Open" });
    api.post("/api/complaints", { customer_name: v.cust, complaint_type: v.cat, route: v.route, priority: v.pri, description: v.note || "" });
    toast("Ticket created ✓"); render();
  });

/* ---- Dashboard: Transport ---- */
VIEWS.transport = () => {
  const rows = TRIPS.map(tp => `<tr>
    <td><b>${tp.id}</b><br><small style="color:var(--muted)">${tp.veh}</small></td>
    <td>${tp.driver}</td><td>${tp.route}</td><td class="r num">${tp.load}</td>
    <td class="num">${tp.dep} → ${tp.eta}</td>
    <td>${chip(tp.status === "Completed" ? "good" : tp.status === "Delayed" ? "crit" : "info", tp.status + (tp.delay ? ` +${tp.delay}m` : ""))}</td></tr>`).join("");
  return pagehead("Transport", "Press dispatch · trips & vehicle compliance") + `
    <div class="grid kpis">
      ${kpi("Trips today", "14", "4 shown below", "fl", "var(--teal-l)", "🚚")}
      ${kpi("Delayed", "1", "T-4471 · 55 min", "dn", "var(--red-l)", "⏰")}
      ${kpi("Cost / copy", "₹0.21", "▼ ₹0.02 MoM", "up", "var(--grn-l)", "₹")}
      ${kpi("Compliance expiring", "2", "insurance · 60 days", "dn", "var(--gold-l)", "📄")}
    </div>` +
    table(["Trip", "Driver", "Route", ">Load", "Dep → ETA", "Status"], [rows]);
};

/* ---- Dashboard: Approvals ---- */
VIEWS.approvals = () => {
  const decided = store.get("approvalsDecided", {});
  const cards = APPROVALS.map(a => {
    const d = decided[a.id];
    return `<div class="card pad" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div>${chip("mut", a.type)} ${chip(a.pri === "High" ? "crit" : a.pri === "Medium" ? "warn" : "mut", a.pri)}
          <span style="color:var(--muted);font-size:11.5px">· ${a.age} ago · by ${a.req}</span></div>
        <b class="num">${a.amt}</b></div>
      <h3 style="margin:8px 0 4px;font-size:14.5px">${a.title}</h3>
      <p style="color:var(--muted);font-size:12.5px">${a.note}</p>
      <div style="display:flex;gap:9px;margin-top:12px">${d
        ? chip(d === "approved" ? "good" : "crit", d === "approved" ? "✓ Approved" : "✕ Rejected")
        : `<button class="btn good sm" onclick="decide('${a.id}','approved')">✓ Approve</button>
           <button class="btn crit sm" onclick="decide('${a.id}','rejected')">✕ Reject</button>`}</div></div>`;
  }).join("");
  return pagehead("Approvals", "Items awaiting your decision — copy variance, refunds, settlements") + cards;
};
window.decide = (id, verdict) => {
  const d = store.get("approvalsDecided", {}); d[id] = verdict; store.set("approvalsDecided", d);
  toast(verdict === "approved" ? "Approved ✓ — requester notified" : "Rejected — sent back with note"); render();
};

/* ---- Dashboard: Reports ---- */
VIEWS.reports = () => {
  const cards = REPORTS_CAT.map(([cat, items]) => `<div class="card pad">
    <div class="cardhead" style="padding:0 0 9px;border:none"><h3>${cat}</h3></div>
    ${items.map(i => `<button class="nav-item" style="width:100%;margin:0 0 2px" onclick="toast('${i} — export queued (demo)')"><span class="nico" style="font-size:12px">📄</span><span>${i}</span></button>`).join("")}</div>`).join("");
  return pagehead("Reports", "Export-ready operational & financial reports") +
    `<div class="applist">${cards}</div>`;
};

/* ---- Dashboard: Masters & Admin ---- */
VIEWS.admin = () => pagehead("Masters & Admin", "Configuration masters — maintained by the admin team") +
  `<div class="applist">${MASTERS.map(m => `<button class="card appcard" onclick="toast('${m.title} — read-only in demo')">
    <div class="aico" style="background:var(--navy-l)">${m.icon}</div><b>${m.title}</b><small>${m.desc}</small></button>`).join("")}</div>`;

/* ═══════════ FIELD APPS ═══════════ */

/* ---- Agent App ---- */
VIEWS.agent_day = () => {
  const rows = ROUTES.map(r => `<tr><td><b>${r.id}</b></td><td>${r.hawker}</td>
    <td class="r num">${r.copies}</td><td>${chip(r.status === "Completed" ? "good" : "info", r.status)}</td></tr>`).join("");
  return pagehead("Agent App — My Day", "Shree Ganesh News Agency · Malviya Nagar") + `
    <div class="grid kpis">
      ${kpi("Today's allocation", "4,820", "6 routes", "fl", "var(--red-l)", "📦")}
      ${kpi("Routes done", "4 / 6", "", "", "var(--grn-l)", "🛣️")}
      ${kpi("Collection due", fmtC(184200), "23 households", "fl", "var(--gold-l)", "₹")}
      ${kpi("June settlement", fmtC(6620), "awaiting approval", "fl", "var(--blue-l)", "🧾")}
    </div>` +
    table(["Route", "Hawker", ">Copies", "Status"], [rows]);
};
VIEWS.agent_supply = () => {
  const saved = store.get("returns", null);
  const rows = SUPPLY.map((s, i) => {
    const ret = saved ? saved[i] : 0;
    return `<tr><td><b>${s.pub}</b></td><td class="r num">${fmtN(s.supply)}</td>
      <td class="r num">₹${s.rate.toFixed(2)}</td>
      <td class="r"><input data-ret="${i}" type="number" min="0" max="${s.supply}" value="${ret}" ${saved ? "disabled" : ""}
        style="width:84px;text-align:right;background:var(--surf2);border:1px solid var(--brd);border-radius:8px;padding:6px 8px"></td>
      <td class="r num" data-net="${i}">${fmtN(s.supply - ret)}</td></tr>`;
  }).join("");
  return pagehead("Supply & Net Sales", "Enter unsold returns to compute today's net sale") + `
    <div class="card"><div class="cardhead"><h3>Today's supply — ${TODAY}</h3>${saved ? chip("good", "Returns saved") : chip("warn", "Returns pending")}</div>
      <div class="tablewrap"><table><thead><tr><th>Publication</th><th class="r">Supply</th><th class="r">Rate</th><th class="r">Returns</th><th class="r">Net sale</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${saved ? "" : `<div style="padding:14px 16px"><button class="btn pri" onclick="saveReturns()">Save returns & lock</button></div>`}</div>
    <div style="height:13px"></div>
    <div class="card pad"><div class="cardhead" style="padding:0 0 9px;border:none"><h3>Competitor copies in my area</h3></div>
      <div class="stat-pair"><span>Dainik Bhaskar</span><b>1,240 <span class="chip good">▼ 40 this month</span></b></div>
      <div class="stat-pair"><span>Times of India</span><b>310 <span class="chip crit">▲ 10 this month</span></b></div>
      <div class="stat-pair"><span>Dainik Navjyoti</span><b>180 <span class="chip mut">flat</span></b></div></div>`;
};
window.saveReturns = () => {
  const vals = [...document.querySelectorAll("[data-ret]")].map(el => Math.max(0, Number(el.value) || 0));
  store.set("returns", vals); toast("Returns saved — net sale updated ✓"); render();
};
VIEWS.agent_ledger = () => {
  const rows = LEDGER.map(l => `<tr><td class="num">${l[0]}</td><td>${l[1]}</td>
    <td class="r num">${l[2]}</td><td class="r num up">${l[3]}</td><td class="r num"><b>${l[4]}</b></td></tr>`).join("");
  return pagehead("Bills & Ledger", "Agency account with Patrika — running balance",
    `<button class="btn pri" onclick="toast('Statement sent on WhatsApp ✓')">Send on WhatsApp</button>`) + `
    <div class="grid kpis">
      ${kpi("Current balance", "₹1,84,200 Dr", "", "", "var(--red-l)", "🧾")}
      ${kpi("June bill", lakh(545420), "1,41,300 copies", "fl", "var(--gold-l)", "📰")}
      ${kpi("June commission", fmtC(41180), "12.4% blended", "up", "var(--grn-l)", "💰")}
    </div>` +
    table(["Date", "Particulars", ">Debit", ">Credit", ">Balance"], [rows]);
};
VIEWS.agent_complaints = () => {
  const mine = COMPLAINTS.filter(c => c.route.startsWith("MN") || c.route.startsWith("CS"));
  const rows = mine.map(c => `<tr><td><b>${c.id}</b></td>
    <td><b>${c.cust}</b><br><small style="color:var(--muted)">${c.cat}</small></td>
    <td>${c.route}</td><td>${chip(c.slaState === "crit" ? "crit" : c.slaState === "warn" ? "warn" : "good", c.sla)}</td>
    <td class="r"><button class="btn sm" onclick="toast('Marked resolved — pending customer confirmation')">Resolve</button></td></tr>`).join("");
  return pagehead("Complaints — My Territory", "Tickets on my agency routes") +
    table(["Ticket", "Customer", "Route", "SLA", ">"], [rows]);
};

/* ---- Hawker App ---- */
function stopState() { return store.get("stops", STOPS.map(s => s.st)); }
VIEWS.hawker_day = () => {
  const st = stopState();
  const done = st.filter(x => x === "done").length, miss = st.filter(x => x === "miss").length;
  const checked = store.get("checkin", null);
  return `<div class="field-col">` + pagehead("Hawker App — My Day", "Route MN-04 · Malviya Nagar") + `
    <div class="bigstat">
      <div class="card"><div class="lbl">Today's copies</div><div class="v num">365</div></div>
      <div class="card"><div class="lbl">Stops</div><div class="v num">${STOPS.length}</div></div>
      <div class="card"><div class="lbl">Delivered</div><div class="v num up">${done}</div></div>
      <div class="card"><div class="lbl">Missed</div><div class="v num ${miss ? "dn" : ""}">${miss}</div></div>
    </div>
    <div class="card pad" style="margin-bottom:13px">
      <div class="cardhead" style="padding:0 0 9px;border:none"><h3>Duty</h3>${checked ? chip("good", "Checked in · " + checked) : chip("warn", "Not checked in")}</div>
      ${checked ? `<p style="color:var(--muted);font-size:12.5px">Bundle verified — RP City 342 + Plus 23. Have a good run! 🛵</p>`
        : `<button class="btn pri block" onclick="store.set('checkin', new Date().toTimeString().slice(0,5));toast('Checked in — GPS stamped ✓');render()">✋ Check in & verify bundle</button>`}
    </div>
    <div class="card pad"><div class="cardhead" style="padding:0 0 9px;border:none"><h3>To collect today</h3></div>
      <div class="stat-pair"><span>Pending amount</span><b class="num">${fmtC(STOPS.filter((s, i) => s.collect && st[i] !== "done").reduce((a, s) => a + s.collect, 0) || 3355)}</b></div>
      <div class="stat-pair"><span>Households</span><b class="num">${STOPS.filter(s => s.collect > 0).length}</b></div>
      <button class="btn navy block" style="margin-top:10px" onclick="go('hawker_collect')">Open collect list →</button>
    </div></div>`;
};
VIEWS.hawker_route = () => {
  const st = stopState();
  const items = STOPS.map((s, i) => `<div class="stop ${st[i] === "done" ? "done" : st[i] === "miss" ? "miss" : ""}">
    <div class="n">${s.n}</div>
    <div class="info"><b>${s.name}</b><small>${s.addr} · ${s.pubs}${s.collect ? " · collect " + fmtC(s.collect) : ""}</small></div>
    ${st[i] === "pending"
      ? `<button class="tapbtn ok" aria-label="delivered" onclick="markStop(${i},'done')">✓</button>
         <button class="tapbtn no" aria-label="missed" onclick="markStop(${i},'miss')">✕</button>`
      : `<span class="chip ${st[i] === "done" ? "good" : "crit"}">${st[i] === "done" ? "Delivered" : "Missed"}</span>`}
  </div>`).join("");
  const done = st.filter(x => x === "done").length;
  return `<div class="field-col">` + pagehead("My Route — MN-04", `${done}/${STOPS.length} stops done · window 05:00–07:30`) + `
    <div class="card">${items}</div>
    <button class="btn block" style="margin-top:12px" onclick="store.set('stops', null);toast('Route reset (demo)');render()">Reset demo route</button></div>`;
};
window.markStop = (i, v) => {
  const st = stopState(); st[i] = v; store.set("stops", st);
  toast(v === "done" ? "Delivered ✓" : "Marked missed — customer notified"); render();
};
VIEWS.hawker_readers = () => {
  const rows = CUSTOMERS.filter(c => c.route === "MN-04").map(c => `<tr class="rowbtn" onclick='custDetail("${c.id}")'>
    <td><b>${c.name}</b><br><small style="color:var(--muted)">${c.addr.split(",")[0]}</small></td>
    <td>${c.plan.split(" · ")[0]}</td><td class="r num">${c.out ? fmtC(c.out) : "—"}</td>
    <td>${chip(c.status === "Active" ? "good" : "warn", c.status)}</td></tr>`).join("");
  return pagehead("My Readers", "126 households on route MN-04") +
    table(["Reader", "Plan", ">Due", "Status"], [rows]);
};
VIEWS.hawker_collect = () => {
  const collected = store.get("hawkerCollected", []);
  const items = PAYMENTS.map((p, i) => {
    const isDone = collected.includes(p.id);
    return `<div class="stop ${isDone ? "done" : ""}">
      <div class="n">₹</div>
      <div class="info"><b>${p.cust}</b><small>${p.id} · ${p.due}</small></div>
      <b class="num" style="margin-right:6px">${fmtC(p.amt)}</b>
      ${isDone ? `<span class="chip good">Collected</span>` : `<button class="btn good sm" onclick="hawkerCollect(${i})">Collect</button>`}</div>`;
  }).join("");
  const total = PAYMENTS.filter(p => collected.includes(p.id)).reduce((a, p) => a + p.amt, 0);
  return `<div class="field-col">` + pagehead("Collect", "Payments due on my route") + `
    <div class="bigstat">
      <div class="card"><div class="lbl">Collected today</div><div class="v num up">${fmtC(1440 + total)}</div></div>
      <div class="card"><div class="lbl">Still pending</div><div class="v num">${fmtC(PAYMENTS.filter(p => !collected.includes(p.id)).reduce((a, p) => a + p.amt, 0))}</div></div>
    </div><div class="card">${items}</div></div>`;
};
window.hawkerCollect = i => {
  const p = PAYMENTS[i];
  formModal("Record payment", `${p.cust} · ${fmtC(p.amt)}`,
    [{ k: "mode", label: "Mode", type: "select", opts: ["UPI (show QR)", "Cash"] }],
    "Confirm received", v => {
      const c = store.get("hawkerCollected", []); c.push(p.id); store.set("hawkerCollected", c);
      store.push("receipts", { no: "R-" + Math.floor(99150 + Math.random() * 800), cust: p.cust, amt: p.amt, mode: v.mode || "UPI", by: S.user.name, at: "just now" });
      api.post("/api/payments", { customer_name: p.cust, amount: p.amt, method: v.mode || "UPI", notes: "hawker collect" });
      toast(`Receipt sent to customer — ${fmtC(p.amt)} ✓`); render();
    });
};
VIEWS.hawker_earn = () => `<div class="field-col">` + pagehead("Earnings — July", "Delivery + incentives + referrals") + `
    <div class="bigstat">
      <div class="card"><div class="lbl">Month so far</div><div class="v num">₹4,318</div></div>
      <div class="card"><div class="lbl">Projected</div><div class="v num up">₹9,860</div></div>
    </div>
    <div class="card pad">
      <div class="stat-pair"><span>Delivery (₹0.35 × 12,336 copies)</span><b class="num">₹4,318</b></div>
      <div class="stat-pair"><span>On-time streak bonus (26 days)</span><b class="num">₹150 on track</b></div>
      <div class="stat-pair"><span>Referrals (2 × ₹100)</span><b class="num">₹200</b></div>
      <div class="stat-pair"><span>Collection incentive</span><b class="num">₹312</b></div>
      <div class="stat-pair"><span>June payout</span><b class="num up">₹9,214 · paid 05 Jul</b></div>
    </div></div>`;

/* ---- DCR Forms ---- */
VIEWS.dcr_att = () => {
  const att = store.get("dcrAtt", null);
  return `<div class="field-col">` + pagehead("DCR — Attendance", "Daily Collection Register · field attendance") + `
    <div class="card pad" style="text-align:center">
      <div style="font-size:44px;margin-bottom:6px">${att ? "✅" : "🕘"}</div>
      <h3 class="serif" style="font-size:18px">${att ? "Checked in at " + att : "You have not checked in"}</h3>
      <p style="color:var(--muted);font-size:12.5px;margin:6px 0 14px">${TODAY} · GPS + selfie stamped on check-in</p>
      ${att
        ? `<button class="btn crit" onclick="store.set('dcrAtt',null);toast('Checked out — day summary saved');render()">Check out</button>`
        : `<button class="btn pri" onclick="store.set('dcrAtt', new Date().toTimeString().slice(0,5));toast('Checked in ✓ GPS 26.85, 75.81');render()">✋ Check in now</button>`}
    </div>
    <div style="height:13px"></div>
    <div class="card"><div class="cardhead"><h3>Today's visit plan</h3><span class="chip mut">${TOUR.length} visits</span></div>
      ${TOUR.map(v => `<div class="exc"><div class="sev" style="background:var(--gold)"></div>
        <div style="flex:1;min-width:0"><b>${v.time} · ${v.type}</b><small>${v.target}<br>${v.why}</small></div></div>`).join("")}</div></div>`;
};
VIEWS.dcr_visit = () => {
  const visits = store.get("dcrVisits", []);
  return `<div class="field-col">` + pagehead("DCR — Visit Entry", "Record each field visit with outcome & collections") + `
    <button class="btn pri block" onclick="newVisit()" style="margin-bottom:13px">＋ New visit entry</button>
    <div class="card">${visits.length ? visits.slice().reverse().map(v => `<div class="exc">
        <div class="sev" style="background:var(--grn)"></div>
        <div style="flex:1;min-width:0"><b>${esc(v.type)} — ${esc(v.target)}</b>
        <small>${esc(v.outcome)}${Number(v.amt) ? " · collected " + fmtC(Number(v.amt)) : ""}${v.notes ? " · " + esc(v.notes) : ""}</small></div>
        <small style="color:var(--muted)">${v.at}</small></div>`).join("")
      : `<div style="padding:22px;text-align:center;color:var(--muted)">No visits recorded yet today.</div>`}</div></div>`;
};
window.newVisit = () => formModal("New visit entry", "GPS and time are stamped automatically.",
  [{ k: "type", label: "Visit type", type: "select", opts: ["Agency visit", "Hawker visit", "Reader visit", "New area survey", "Collection visit"] },
   { k: "target", label: "Visited whom / where", ph: "e.g. Shivam Distributors — Mansarovar" },
   { k: "outcome", label: "Outcome", type: "select", opts: ["Completed — positive", "Completed — follow-up needed", "Payment collected", "Not available", "Rescheduled"] },
   { k: "amt", label: "Amount collected (₹, if any)", type: "number", val: 0 },
   { k: "notes", label: "Notes", type: "textarea", ph: "key points, commitments, issues" }],
  "Save visit", v => {
    if (!v.target) { toast("Enter whom you visited"); return false; }
    store.push("dcrVisits", { ...v, at: new Date().toTimeString().slice(0, 5) });
    api.post("/api/visits", { visit_type: v.type, target: v.target, outcome: v.outcome, amount: Number(v.amt) || 0, notes: v.notes || "" });
    toast("Visit saved ✓"); render();
  });
VIEWS.dcr_report = () => {
  const visits = store.get("dcrVisits", []);
  const total = visits.reduce((a, v) => a + (Number(v.amt) || 0), 0);
  const submitted = store.get("dcrSubmitted", false);
  return `<div class="field-col">` + pagehead("DCR — Day Report", "Submit once at end of day · locks the register") + `
    <div class="bigstat">
      <div class="card"><div class="lbl">Visits logged</div><div class="v num">${visits.length}</div></div>
      <div class="card"><div class="lbl">Collected on visits</div><div class="v num up">${fmtC(total)}</div></div>
    </div>
    <div class="card pad">
      <div class="stat-pair"><span>Attendance</span><b>${store.get("dcrAtt", null) ? "Checked in ✓" : "Missing ✕"}</b></div>
      <div class="stat-pair"><span>Planned visits covered</span><b class="num">${Math.min(visits.length, TOUR.length)} / ${TOUR.length}</b></div>
      <div class="stat-pair"><span>Status</span><b>${submitted ? "Submitted to DMO ✓" : "Draft"}</b></div>
      ${submitted ? "" : `<button class="btn pri block" style="margin-top:12px" onclick="store.set('dcrSubmitted',true);toast('Day report submitted to DMO ✓');render()">Submit day report</button>`}
    </div>
    ${submitted ? `<button class="btn block" style="margin-top:12px" onclick="store.set('dcrSubmitted',false);store.set('dcrVisits',[]);toast('Demo reset');render()">Reset demo</button>` : ""}</div>`;
};

/* ---- Survey Form ---- */
VIEWS.survey_new = () => `<div class="field-col">` + pagehead("Survey — New Lead", "Field lead capture · takes under a minute") + `
    <div class="card pad">
      <div class="fld"><label>Respondent name *</label><input id="sv_name" placeholder="Full name"></div>
      <div class="fld"><label>Mobile *</label><input id="sv_phone" type="tel" maxlength="10" placeholder="10-digit mobile"></div>
      <div class="fld"><label>Area / colony</label><input id="sv_area" placeholder="e.g. Nirman Nagar B"></div>
      <div class="fld"><label>Currently reads</label><select id="sv_current">
        <option>No newspaper</option><option>Rajasthan Patrika</option><option>Dainik Bhaskar</option><option>Times of India</option><option>Other</option></select></div>
      <div class="fld"><label>Interested in</label><select id="sv_pub">
        <option>Rajasthan Patrika City</option><option>RP City + Patrika Plus</option><option>Catch (weekly)</option><option>Trial 14-day (free)</option></select></div>
      <div class="fld"><label>Interest level</label><select id="sv_interest">
        <option>High — start immediately</option><option>Medium — needs follow-up</option><option>Low — revisit later</option></select></div>
      <div class="fld"><label>Remarks</label><textarea id="sv_notes" placeholder="preferences, best time to visit…"></textarea></div>
      <div class="stat-pair" style="border:none"><span>📍 GPS</span><b class="num">26.8512, 75.8125 (auto)</b></div>
      <button class="btn pri block" onclick="submitSurvey()">Submit survey ✓</button>
    </div></div>`;
window.submitSurvey = () => {
  const g = id => document.getElementById(id).value.trim();
  const name = g("sv_name"), phone = g("sv_phone").replace(/\D/g, "");
  if (!name || !/^\d{10}$/.test(phone)) { toast("Name and a valid 10-digit mobile are required"); return; }
  const interest = g("sv_interest");
  store.push("leads", { name, phone, area: g("sv_area") || "—", pub: g("sv_pub"), stage: "Surveyed",
    next: interest.startsWith("High") ? "Start subscription" : "Follow up",
    score: interest.startsWith("High") ? 85 : interest.startsWith("Medium") ? 60 : 35,
    notes: g("sv_notes"), at: TODAY });
  api.post("/api/leads", { name, mobile: phone, area: g("sv_area") || "—", publication: g("sv_pub"), interest, notes: g("sv_notes") });
  toast("Survey submitted ✓ Lead added"); go("survey_leads");
};
VIEWS.survey_leads = () => {
  const mine = store.get("leads", []);
  const all = [...mine.slice().reverse(), ...LEADLIST];
  const rows = all.map(l => `<tr>
    <td><b>${esc(l.name)}</b><br><small style="color:var(--muted)">${esc(l.area)} · ${esc(l.phone)}</small></td>
    <td>${esc(l.pub)}</td>
    <td>${chip(l.stage === "Converted" ? "good" : "info", l.stage)}</td>
    <td><div class="bar"><i style="width:${l.score}%;background:${l.score >= 75 ? "var(--grn)" : "var(--gold)"}"></i></div></td></tr>`).join("");
  return pagehead("My Leads", `${all.length} leads · ${mine.length} captured by you`,
    `<button class="btn pri" onclick="go('survey_new')">＋ New survey</button>`) +
    table(["Lead", "Publication", "Stage", "Score"], [rows]);
};

/* ---- Taxi Fleet ---- */
VIEWS.taxi_trips = () => {
  const mine = store.get("trips", []);
  const rows = [...mine.slice().reverse(), ...TRIPS].map(tp => `<tr>
    <td><b>${tp.id}</b><br><small style="color:var(--muted)">${esc(tp.veh)}</small></td>
    <td>${esc(tp.driver)}</td><td>${esc(tp.route)}</td><td class="r num">${tp.load}</td>
    <td>${chip(tp.status === "Completed" ? "good" : tp.status === "Delayed" ? "crit" : "info", tp.status)}</td></tr>`).join("");
  return pagehead("Taxi Fleet — Today's Trips", "Press dispatch runs · " + TODAY,
    `<button class="btn pri" onclick="go('taxi_log')">＋ Log trip</button>`) +
    table(["Trip", "Driver", "Route", ">Load", "Status"], [rows]);
};
VIEWS.taxi_log = () => `<div class="field-col">` + pagehead("Log Trip", "Record a dispatch run") + `
    <div class="card pad">
      <div class="fld"><label>Vehicle *</label><select id="tx_veh">${VEHICLES.map(v => `<option>${v.no} — ${v.type}</option>`).join("")}</select></div>
      <div class="fld"><label>Route *</label><input id="tx_route" placeholder="e.g. Press → Chomu → Samod"></div>
      <div class="fld"><label>Copies loaded</label><input id="tx_load" type="number" placeholder="e.g. 4200"></div>
      <div class="fld"><label>Departure time</label><input id="tx_dep" type="time" value="04:30"></div>
      <div class="fld"><label>Notes</label><textarea id="tx_notes" placeholder="checkpoints, handover details…"></textarea></div>
      <button class="btn pri block" onclick="logTrip()">Start trip ✓</button>
    </div></div>`;
window.logTrip = () => {
  const g = id => document.getElementById(id).value.trim();
  if (!g("tx_route")) { toast("Enter the route"); return; }
  const vehNo = g("tx_veh").split(" — ")[0];
  store.push("trips", { id: "T-" + Math.floor(4480 + Math.random() * 400), veh: vehNo, driver: S.user.name,
    load: fmtN(Number(g("tx_load")) || 0), route: g("tx_route"), dep: g("tx_dep"), eta: "—", status: "In transit", delay: 0 });
  api.post("/api/trips", { vehicle_no: vehNo, route: g("tx_route"), bundles: Number(g("tx_load")) || 0, departure: g("tx_dep") });
  toast("Trip started — live tracking on ✓"); go("taxi_trips");
};
VIEWS.taxi_vehicles = () => {
  const rows = VEHICLES.map(v => `<tr><td><b>${v.no}</b></td><td>${v.type}</td><td>${v.driver}</td>
    <td class="num">${v.fitness}</td><td class="num">${v.insurance}</td>
    <td>${chip(v.status === "Idle" ? "mut" : v.status === "Delayed" ? "crit" : "good", v.status)}</td></tr>`).join("");
  return pagehead("Vehicles", "Fleet register & compliance") +
    table(["Vehicle", "Type", "Driver", "Fitness", "Insurance", "Status"], [rows]);
};

/* ═══════════ RENDER ═══════════ */
function navGroups() {
  const u = S.user, groups = [], hl = u.hierarchyLevel || 99;
  if (u.dashboard) {
    // L1-L4: full 12-item dashboard; L5-L6: field operations subset only
    const fieldIds = ["routes", "collections", "complaints", "partners"];
    const items = DASH_MENU
      .filter(([id]) => hl <= 4 || fieldIds.includes(id))
      .map(([id, l, ic]) => ({ id, label: l, icon: ic, badge: id === "approvals" ? APPROVALS.length : 0 }));
    groups.push({ label: "Dashboard — Vitran OS", items });
  }
  const apps = u.modules.map(k => ({ key: k, ...APP_MENU[k] }));
  if (apps.length) groups.push({ label: "Field Apps", apps });
  return groups;
}

function sideHTML() {
  const groups = navGroups();
  let html = `<button class="nav-item ${S.screen === "home" ? "on" : ""}" onclick="go('home')" style="margin-top:10px"><span class="nico">🏠</span><span>Home — My Modules</span></button>`;
  for (const g of groups) {
    html += `<div class="sb-lbl">${g.label}</div>`;
    if (g.items) html += g.items.map(i => `<button class="nav-item ${S.screen === i.id ? "on" : ""}" onclick="go('${i.id}')">
      <span class="nico">${i.icon}</span><span>${i.label}</span>${i.badge ? `<span class="cnt num">${i.badge}</span>` : ""}</button>`).join("");
    if (g.apps) html += g.apps.map(a => {
      const active = a.sub.some(s => s[0] === S.screen);
      const open = S.openGroups[a.key] ?? active;
      return `<button class="nav-item ${active ? "on" : ""}" onclick="toggleGroup('${a.key}')" aria-expanded="${open}">
        <span class="nico" style="background:${a.tint}">${a.icon}</span><span>${a.label}</span><span class="chev ${open ? "open" : ""}">▶</span></button>
        ${open ? `<div class="subnav">${a.sub.map(s => `<button class="nav-item ${S.screen === s[0] ? "on" : ""}" onclick="go('${s[0]}')"><span>${s[1]}</span></button>`).join("")}</div>` : ""}`;
    }).join("");
  }
  html += `<div class="side-foot">Patrika Vitran Suite · v1.0<br>Demo build · data is illustrative</div>`;
  return html;
}

function bottomHTML() {
  const u = S.user, hl = u.hierarchyLevel || 99;
  const items = [["home", "Home", "🏠"]];
  if (u.dashboard) {
    if (hl <= 4) items.push(["command", "Dashboard", "📊"], ["approvals", "Approvals", "✅"]);
    else         items.push(["routes",  "Routes",    "🛣️"], ["collections", "Collect", "₹"]);
  } else {
    const first = APP_MENU[u.modules[0]];
    items.push([first.sub[0][0], first.label.split(" ")[0], first.icon]);
    if (u.modules[1]) { const b = APP_MENU[u.modules[1]]; items.push([b.sub[0][0], b.label.split(" ")[0], b.icon]); }
  }
  items.push(["__menu", "Menu", "☰"]);
  return items.map(([id, label, ico]) => `<button class="${S.screen === id ? "on" : ""}"
    onclick="${id === "__menu" ? "toggleSide()" : `go('${id}')`}"><span class="bico">${ico}</span>${label}</button>`).join("");
}

function paintSide() {
  const side = $("#side"), ov = $("#sbOverlay");
  if (side) side.classList.toggle("open", S.sideOpen);
  if (ov) ov.classList.toggle("show", S.sideOpen);
}

function loginHTML() {
  /* Build demo login list — real DB users when loaded, fallback to USERS */
  let demoRows;
  const dbU = S.live && S.live.dbUsers;
  if (dbU && dbU.length) {
    /* One entry per hierarchy level from DB, then show all users grouped by level */
    const lvlOrder = [2, 3, 4, 5, 9];
    const byLevel = {};
    dbU.forEach(u => { (byLevel[u.hierarchyLevel] = byLevel[u.hierarchyLevel] || []).push(u); });

    /* Admin entry (L1) always first — kept from static config */
    const admin = USERS.find(u => u.hierarchyLevel === 1);
    const adminRow = admin ? `<button class="persona" onclick="login(${admin.id})">
      <span class="av" style="background:var(--gold-l);color:var(--gold-d)">${admin.avatar}</span>
      <span style="flex:1;min-width:0"><b>${admin.name}</b><small>${admin.roleLabel} · ${admin.scopeLabel}</small></span>
      <span class="chip mut" style="font-size:10px;padding:1px 6px;flex:none">L1</span></button>` : "";

    // Use roleLabel from the API (derived from _LEVEL_META in server.py)
    const levelLabel = {};
    dbU.forEach(u => { if (!levelLabel[u.hierarchyLevel]) levelLabel[u.hierarchyLevel] = u.roleLabel; });
    const dbRows = lvlOrder.flatMap(lvl => {
      const list = byLevel[lvl] || [];
      if (!list.length) return [];
      /* Show all users for this level (scrollable) */
      const header = `<div style="padding:6px 8px 2px;font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">${levelLabel[lvl] || "Level "+lvl}</div>`;
      const rows = list.map(u => {
        const uJson = esc(JSON.stringify(u));
        return `<button class="persona" onclick="loginWithUser(JSON.parse(this.dataset.u))" data-u="${uJson}">
          <span class="av" style="background:var(--blue-l);color:var(--blue-d)">${esc(u.avatar)}</span>
          <span style="flex:1;min-width:0"><b>${esc(u.name)}</b><small>${esc(u.unit_code)} · ${esc(u.scopeLabel||u.unit_code)}</small></span>
          <span class="chip mut" style="font-size:10px;padding:1px 6px;flex:none">L${u.hierarchyLevel}</span></button>`;
      }).join("");
      return [header + rows];
    }).join("");

    demoRows = adminRow + dbRows;
  } else {
    /* Fallback to static demo users while API loads */
    demoRows = USERS.map(u => `<button class="persona" onclick="login(${u.id})">
      <span class="av" style="background:var(--gold-l);color:var(--gold-d)">${u.avatar}</span>
      <span style="flex:1;min-width:0"><b>${u.name}</b><small>${u.roleLabel} · ${u.scopeLabel}</small></span>
      <span class="chip mut" style="font-size:10px;padding:1px 6px;flex:none">L${u.hierarchyLevel}</span></button>`).join("");
  }

  const demoTitle = dbU ? `Real users from hierarchy master (${(dbU.length)} active)` : "Loading users…";

  return `<div class="login">
    <div class="login-brand">
      <img class="login-logo" src="assets/patrika-logo.png" alt="Patrika Group">
      <h1>Patrika <b>Vitran</b> Suite</h1>
      <p>One platform for the print circulation network — dashboards for leadership, field apps for agents, hawkers, surveyors and fleet.</p>
      <div class="rule"></div>
      <small>Rajasthan Patrika · Circulation Operating System</small>
    </div>
    <div class="login-pane"><div class="login-card">
      <h2>Sign in</h2><p>Use your registered mobile number. Only modules assigned to your role will be visible.</p>
      <div id="loginErr"></div>
      <div class="fld"><label>Mobile number</label><input id="loginMob" type="tel" maxlength="10" placeholder="10-digit mobile" inputmode="numeric"></div>
      <div class="fld"><label>Password</label><input id="loginPwd" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')doLogin()"></div>
      <button class="btn navy block" onclick="doLogin()">Sign in →</button>
      <div class="demo-block">
        <h4>${demoTitle}</h4>
        <div style="max-height:420px;overflow-y:auto;border-radius:8px">${demoRows}</div>
      </div>
    </div></div></div>`;
}
window.doLogin = async () => {
  const mob = $("#loginMob").value.replace(/\D/g, ""), pwd = $("#loginPwd").value.trim();
  // Try PostgreSQL via API first; fall back to local USERS array if API is offline
  const apiUser = await api.post("/api/login", { mobile: mob, password: pwd });
  const u = apiUser
    ? USERS.find(x => x.mobile === mob)  // use local record for role/modules config
    : USERS.find(x => x.mobile === mob && x.password === pwd);
  if (!u) { $("#loginErr").innerHTML = `<div class="err">Invalid mobile number or password. Try a demo login below.</div>`; return; }
  login(u.id);
};

function render() {
  const app = $("#app");
  if (!S.user) { app.innerHTML = loginHTML(); return; }
  const view = VIEWS[S.screen] || VIEWS.home;
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <button class="menu-btn" onclick="toggleSide()" aria-label="Menu">☰</button>
      <div class="brand"><img src="assets/patrika-logo.png" alt="Patrika"><div class="bt"><b>Patrika Vitran</b><small>Circulation Suite</small></div></div>
      <div class="top-sp"></div>
      <button class="iconbtn" onclick="toggleTheme()" title="Toggle theme">◐</button>
      <button class="iconbtn" onclick="toast('3 notifications — vehicle delay, SLA risk, settlement ready')" title="Notifications">🔔<span class="dot"></span></button>
      <button class="me" onclick="logout()" title="Logout"><span class="av">${S.user.avatar}</span>
        <span class="mi"><b>${S.user.name}</b><small>${S.user.roleLabel} · tap to logout</small></span></button>
    </header>
    <aside class="side" id="side">${sideHTML()}</aside>
    <div class="sb-overlay" id="sbOverlay" onclick="S.sideOpen=false;paintSide()"></div>
    <main class="main">${view()}</main>
    <nav class="bottombar">${bottomHTML()}</nav>
  </div>`;
  paintSide();
}

restoreSession();
render();
/* Pre-fetch hierarchy users so the login page shows real names immediately */
if (!S.user) fetchHierarchyUsers();
