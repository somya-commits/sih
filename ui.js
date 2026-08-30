/* =========================================================================
   UI CORE  (js/ui.js)
   ------------------------------------------------------------------------
   • Header: live clock, theme toggle, role switcher, notification bell
   • Toasts, modals, shared DOM helpers
   • The master refresh loop: every ~2.2 s it reads sensors via MockAPI,
     re-computes the AI prediction, evaluates alerts and re-renders the
     current page through PAGE.render[page](pred, sensors).

   ── PRODUCTION PATH ─────────────────────────────────────────────────────
   The loop below is the only place that touches MockAPI. Point MockAPI's
   methods at the real backend (FastAPI/Flask + MQTT bridge) and this file
   needs no changes at all.
   ========================================================================= */

"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

window.PAGE = window.PAGE || { init: {}, render: {} };

const App = {
  autoSim: false,
  _cycling: false,

  /* ---------------- init ---------------- */
  init() {
    this.bindTheme();
    this.bindRole();
    this.bindClock();
    this.bindBell();
    this.bindModals();
    this.highlightNav();

    /* first refresh */
    setTimeout(() => this.cycle(), 250);
    setInterval(() => this.cycle(), 2200);

    /* dispatch page-specific initialisation */
    const pg = document.body.dataset.page;
    if (PAGE.init[pg]) PAGE.init[pg]();

    window.addEventListener("resize", () => {
      if (window.ffMap) setTimeout(() => window.ffMap.invalidateSize(), 180);
    });
  },

  /* ---------------- master refresh loop ---------------- */
  async cycle() {
    if (this._cycling) return;
    this._cycling = true;
    try {
      const sensors = await MockAPI.getSensors();                 // GET /api/sensors
      const pred = await MockAPI.getPrediction(SensorHub.sensors);// POST /api/prediction
      AlertManager.evaluate(pred);                                // early-warning engine
      this.updateSystemStatus(pred);
      this.updateNotifBadge();
      const pg = document.body.dataset.page;
      if (PAGE.render[pg]) await PAGE.render[pg](pred, sensors);
    } catch (err) {
      console.warn("[cycle]", err);
    } finally {
      this._cycling = false;
    }
  },

  /* ---------------- theme ---------------- */
  bindTheme() {
    const btn = $("#themeBtn");
    if (!btn) return;
    const saved = localStorage.getItem("ff-theme");
    document.body.classList.toggle("light", saved === "light");
    btn.textContent = saved === "light" ? "☀️" : "🌙";
    btn.addEventListener("click", () => {
      const light = document.body.classList.toggle("light");
      btn.textContent = light ? "☀️" : "🌙";
      localStorage.setItem("ff-theme", light ? "light" : "dark");
      this.rethemeCharts();
      if (window.ffMap) setTimeout(() => window.ffMap.invalidateSize(), 120);
    });
  },

  rethemeCharts() {
    const grid = this.cssVar("--border"), tick = this.cssVar("--muted");
    Object.values(PAGE.charts || {}).forEach(c => {
      if (!c) return;
      c.options.scales.x.grid.color = grid;
      c.options.scales.y.grid.color = grid;
      c.options.scales.x.ticks.color = tick;
      c.options.scales.y.ticks.color = tick;
      c.update("none");
    });
  },

  cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },

  /* ---------------- role switcher ---------------- */
  bindRole() {
    const wrap = $("#profileWrap"), menu = $("#roleMenu"), btn = $("#profileBtn");
    if (!wrap || !menu || !btn) return;

    const saved = localStorage.getItem("ff-role") || "admin";
    this.setRole(saved);

    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) menu.classList.remove("open");
    });

    menu.querySelectorAll("[data-role]").forEach(item => {
      item.addEventListener("click", () => {
        this.setRole(item.dataset.role);
        menu.classList.remove("open");
        App.toast("info", "Role Switched", `${item.querySelector(".r-name").textContent} dashboard active (demo).`);
      });
    });
  },

  setRole(role) {
    document.body.classList.remove("role-admin", "role-dma", "role-rescue", "role-public");
    document.body.classList.add("role-" + role);
    localStorage.setItem("ff-role", role);
    const pg = document.body.dataset.page;
    const gate = $("#adminGate"), content = $("#adminContent");
    if (pg === "admin" && gate && content) {
      const isAdmin = role === "admin";
      gate.style.display = isAdmin ? "none" : "block";
      content.style.display = isAdmin ? "block" : "none";
    }
    const names = {
      admin:   ["A. Dev", "Administrator"],
      dma:     ["P. Rawat", "Disaster Mgmt."],
      rescue:  ["R. Negi", "Rescue Team"],
      public:  ["Villager", "Public User"]
    };
    const [nm, rl] = names[role] || names.admin;
    const n = $("#profileName"), r = $("#profileRole");
    if (n) n.textContent = nm;
    if (r) r.textContent = rl;
    const emoji = { admin: "🛡️", dma: "🏛️", rescue: "🚑", public: "👥" }[role];
    const av = $("#avatar");
    if (av) av.textContent = emoji;
    $$("#roleMenu [data-role]").forEach(i => i.classList.toggle("active", i.dataset.role === role));
    if (PAGE.render[pg]) this.cycle();
  },

  /* ---------------- clock ---------------- */
  bindClock() {
    const t = $("#clockTime"), d = $("#clockDate");
    if (!t && !d) return;
    const tick = () => {
      const now = new Date();
      if (t) t.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (d) d.textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    };
    tick(); setInterval(tick, 1000);
  },

  updateSystemStatus(pred) {
    const el = $("#sysStatus");
    if (!el) return;
    const critical = pred.level === "CRITICAL" || pred.level === "HIGH";
    el.classList.toggle("critical", critical);
    el.innerHTML = `<span class="dot"></span>${critical ? "⚠ " + pred.level + " RISK" : "All Systems Operational"}`;
  },

  /* ---------------- notification bell ---------------- */
  bindBell() {
    const bell = $("#bellBtn"), drop = $("#notifDrop");
    if (!bell || !drop) return;
    bell.addEventListener("click", (e) => { e.stopPropagation(); drop.classList.toggle("open"); });
    document.addEventListener("click", (e) => { if (!bell.parentElement.contains(e.target)) drop.classList.remove("open"); });
  },

  updateNotifBadge() {
    const badge = $("#bellBadge");
    if (!badge) return;
    const n = SensorHub.alerts.filter(a => a.status === "ACTIVE").length;
    badge.textContent = n;
    badge.style.display = n ? "grid" : "none";
    const list = $("#notifList");
    if (!list) return;
    const items = SensorHub.alertHistory.slice(0, 5).map(a => `
      <div class="alert-item">
        <div class="a-ico ${a.level === "CRITICAL" ? "danger" : a.level === "HIGH" ? "danger" : a.level === "MODERATE" ? "warn" : "info"}">${a.level === "CRITICAL" || a.level === "HIGH" ? "⚠️" : "ℹ️"}</div>
        <div>
          <div class="a-title">${a.title} <span class="muted small">(${a.level})</span></div>
          <div class="a-text">${a.loc}</div>
          <div class="a-time">${a.time} · ${a.status}</div>
        </div>
      </div>`).join("");
    list.innerHTML = items || `<div class="empty-state">No alerts yet</div>`;
  },

  /* ---------------- nav ---------------- */
  highlightNav() {
    const pg = document.body.dataset.page;
    $$(".app-nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === pg));
  },

  /* ---------------- modals ---------------- */
  bindModals() {
    const backdrop = $("#modalBackdrop");
    if (!backdrop) return;
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-modal-open]");
      if (opener) { this.openModal(opener.dataset.modalOpen); return; }
      if (e.target.closest("[data-modal-close]") || e.target === backdrop) this.closeModal();
    });
  },

  openModal(name) {
    const backdrop = $("#modalBackdrop");
    if (!backdrop) return;
    $$("#modalBackdrop .modal-content").forEach(el => el.style.display = "none");
    const target = $(`#modal-${name}`);
    if (target) target.style.display = "block";
    backdrop.classList.add("open");
    if (name === "viewAlert" && window.PAGE.populateViewAlert) PAGE.populateViewAlert();
  },
  closeModal() { const b = $("#modalBackdrop"); if (b) b.classList.remove("open"); },

  /* ---------------- toast ---------------- */
  toast(type, title, text) {
    const wrap = $("#toastWrap");
    if (!wrap) return;
    const icons = { success: "✅", danger: "🚨", warn: "⚠️", info: "ℹ️" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="t-ico">${icons[type] || "ℹ️"}</span><div><div class="t-title">${title}</div><div class="t-text">${text || ""}</div></div>`;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 380); }, 4600);
  },

  /* ---------------- shared render helpers ---------------- */
  levelColor(l) {
    return { LOW: "#34d399", MODERATE: "#fbbf24", HIGH: "#f87171", CRITICAL: "#ef4444" }[l] || "#22d3ee";
  },

  sparkline(hist, color, w = 120, h = 30) {
    if (!hist || hist.length < 2) return '<svg class="spark"></svg>';
    const vals = hist.map(p => p.v);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const rng = (mx - mn) || 1;
    const pts = vals.map((v, i) =>
      `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / rng) * (h - 5)).toFixed(1)}`
    ).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  },

  gaugeSVG() {
    return `<svg viewBox="0 0 200 200" aria-label="Flood risk gauge">
      <circle cx="100" cy="100" r="84" fill="none" stroke="var(--bg-soft)" stroke-width="15"/>
      <circle id="gaugeArc" cx="100" cy="100" r="84" fill="none" stroke="#34d399" stroke-width="15"
        stroke-linecap="round" stroke-dasharray="527.8" stroke-dashoffset="0"
        transform="rotate(-90 100 100)" style="transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1),stroke .6s"/>
    </svg>`;
  },

  updateGauge(score) {
    const arc = $("#gaugeArc");
    if (!arc) return;
    const C = 527.8;
    arc.style.strokeDashoffset = (C * (1 - score / 100)).toFixed(1);
    arc.style.stroke = this.levelColor(AIModel.label(score));
    const sc = $("#gaugeScore"), pct = $("#gaugePct");
    if (sc) sc.textContent = score;
    if (pct) pct.textContent = "FLOOD RISK SCORE";
  },

  /* Sensor card markup (shared by dashboard + sensors page) */
  sensorCards(sensors) {
    return sensors.map(s => {
      const pct = Math.max(0, Math.min(100, ((s.value - s.normMin) / ((s.normMax - s.normMin) || 1)) * 100));
      const pos = Math.max(0, Math.min(100, ((s.value - s.normMin) / ((s.normMax - s.normMin) || 1)) * 100));
      return `
      <div class="sensor-card ${s.status === "offline" ? "offline" : ""}" style="--sc:${s.color};--sc-soft:${s.color}22" >
        <div class="sensor-top">
          <div class="sensor-ico">${s.icon}</div>
          <span class="sensor-id">${s.id}</span>
          <span class="sensor-status ${s.status}">${s.status}</span>
        </div>
        <div class="sensor-name">${s.name}</div>
        <div class="sensor-value">${s.value}<span class="unit">${s.unit}</span></div>
        <div class="sensor-loc">📍 ${s.location}</div>
        <div class="range-bar">
          <div class="fill" style="width:${pct}%"></div>
          <div class="now" style="left:${pos}%"></div>
        </div>
        <div class="range-labels"><span>Safe: ${s.normMin}-${s.normMax}</span><span>Danger &gt; ${s.danger}</span></div>
        <div class="sensor-foot">
          <span>⏱ ${s.status === "online" ? "Updated " + new Date(s.lastUpdate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "No signal"}</span>
          <span>🔋 ${s.battery}%</span>
        </div>
        ${this.sparkline(s.history, s.color)}
      </div>`;
    }).join("");
  }
};

/* =========================================================================
   MOCK ANY CHART.JS / LEAFLET WORLD — page renderers live in
   js/pages-dashboard.js and js/pages-other.js
   ========================================================================= */

window.addEventListener("load", () => App.init());
