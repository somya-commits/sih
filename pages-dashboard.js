/* =========================================================================
   DASHBOARD PAGE RENDERERS  (js/pages-dashboard.js)
   AI prediction hero, sensor cards, live charts, map, alerts, emergency
   ========================================================================= */

"use strict";

/* ---- Chart.js theme-aware defaults ---- */
PAGE.charts = PAGE.charts || {};

function chartColor(alpha = 1) {
  return `rgba(34,211,238,${alpha})`;
}

function makeChart(canvasId, label, color, kind = "line", fill = true) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const grid = App.cssVar("--border"), tick = App.cssVar("--muted");
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, color + "55");
  grad.addColorStop(1, color + "05");

  const cfg = {
    type: kind,
    data: { labels: [], datasets: [{
      label, data: [], borderColor: color, backgroundColor: fill ? grad : color,
      borderWidth: 2.2, tension: 0.38, fill,
      pointRadius: 0, pointHoverRadius: 5
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 8, font: { size: 10 } }, border: { display: false } },
        y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } }, border: { display: false }, beginAtZero: kind === "bar" }
      }
    }
  };
  const chart = new Chart(ctx, cfg);
  PAGE.charts[canvasId] = chart;
  return chart;
}

function setChartData(chart, labels, data) {
  if (!chart) return;
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update("none");
}

/* =========================================================================
   INIT — dashboard
   ========================================================================= */
function initDashboard() {
  /* charts */
  PAGE.charts.rainChart = makeChart("rainChart", "Rainfall (mm/hr)", "#38bdf8");
  PAGE.charts.waterChart = makeChart("waterChart", "Water level (m)", "#22d3ee");
  PAGE.charts.soilChart = makeChart("soilChart", "Soil moisture (%)", "#a3e635");
  PAGE.charts.riskChart = makeChart("riskChart", "Flood risk (%)", "#f87171");

  /* gauge */
  const g = $("#gaugeWrap");
  if (g) g.innerHTML = App.gaugeSVG();

  initMap();
  initSimulation();
  bindEmergency();
  bindAlertModal();
}

function bindEmergency() {
  const evac = $("#evacBtn");
  if (evac) evac.addEventListener("click", () => {
    const p = window.ffPred;
    if (p && (p.level === "HIGH" || p.level === "CRITICAL")) {
      Actions.evacuate();
      const st = $("#rescueStatusText");
      if (st) st.textContent = "EVACUATION IN PROGRESS — shelters at capacity 40%";
    } else {
      App.openModal("evacConfirm");
    }
  });
  const evacYes = $("#evacYes");
  if (evacYes) evacYes.addEventListener("click", () => {
    Actions.evacuate();
    const st = $("#rescueStatusText");
    if (st) st.textContent = "EVACUATION IN PROGRESS — shelters opening";
    App.closeModal();
  });
}

function populateSendAlert() {
  const alert = SensorHub.alerts[0] ||
    { id: "AL-NEW", title: "PRE-EMPTIVE ADVISORY", loc: "Alaknanda Basin · Sector 3", level: "MODERATE" };
  $("#modal-sendAlert .sa-alert-id").textContent = alert.id;
  $("#modal-sendAlert .sa-alert-title").textContent = alert.title;
  $("#modal-sendAlert .sa-alert-loc").textContent = alert.loc;
  App.openModal("sendAlert");
}
function bindAlertModal() {
  $$(".js-send-alert").forEach(btn => btn.addEventListener("click", populateSendAlert));

  const go = $("#modalSendGo");
  if (go) go.addEventListener("click", async () => {
    const alert = SensorHub.alerts[0] || { id: "AL-NEW", title: "PRE-EMPTIVE ADVISORY", loc: "Alaknanda Basin", level: "MODERATE" };
    const channels = $$("#modal-sendAlert input[type=checkbox]:checked").map(i => i.value);
    go.disabled = true;
    if (!channels.length) {
      App.toast("warn", "No channels selected", "Tick at least one delivery channel.");
      go.disabled = false; return;
    }
    await AlertManager.sendManual(channels, alert);
    App.toast("success", "Alerts Dispatched", `${channels.length} channel(s) — delivery simulated (connect real APIs later).`);
    go.disabled = false;
    App.closeModal();
  });
}

/* =========================================================================
   MAP  (Leaflet + OpenStreetMap, no API keys)
   ========================================================================= */
function initMap() {
  if (!window.L || !document.getElementById("floodMap")) return;
  const map = L.map("floodMap", { center: [30.60, 79.45], zoom: 11, zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  window.ffMap = map;

  /* river */
  L.polyline(RIVER_PATH, { color: "#22d3ee", weight: 3, opacity: 0.75, dashArray: "5 7" })
    .bindPopup("<b>Alaknanda River</b><br>Monitored reach (approx.)").addTo(map);

  /* flood-prone plains */
  FLOOD_PLAINS.forEach((pts, i) =>
    L.polygon(pts, { color: "#38bdf8", weight: 1.5, fillColor: "#38bdf8", fillOpacity: 0.12 })
      .bindPopup(`<b>Flood-prone area ${i + 1}</b><br>Historical inundation zone`).addTo(map));

  /* risk zones */
  MAP.refs.zones = RISK_ZONES.map(z => {
    const c = App.levelColor(z.base);
    return L.circle([z.lat, z.lng], { radius: z.r, color: c, weight: 2, fillColor: c, fillOpacity: 0.14, dashArray: "4 4" })
      .bindPopup(`<b>${z.name}</b><br>Risk: ${z.base}`).addTo(map);
  });

  /* villages */
  MAP.refs.villages = VILLAGES.map(v => {
    const c = App.levelColor(v.risk);
    const icon = L.divIcon({ className: "", html: `<div class="village-marker" style="color:${c};border-color:${c};width:15px;height:15px;font-size:8px">⬤</div>`, iconSize: [15, 15] });
    const m = L.marker([v.lat, v.lng], { icon })
      .bindPopup(`<b>${v.name}</b><br>Population: ${v.pop.toLocaleString()}<br>Risk: <b style="color:${c}">${v.risk}</b>`)
      .addTo(map);
    m._village = v;
    return m;
  });

  /* sensors */
  MAP.refs.sensors = {};
  SensorHub.getSensorArray().forEach(s => {
    MAP.refs.sensors[s.id] = L.marker([s.lat, s.lng], { icon: sensorIcon(s) })
      .bindPopup(sensorPopup(s)).addTo(map);
  });
}

const MAP = { refs: { zones: [], villages: [], sensors: {} } };

function sensorIcon(s) {
  const c = App.levelColor("LOW");
  return L.divIcon({ className: "", html: `<div class="marker-sensor" style="--mc:${c};width:26px;height:26px;font-size:12px">${s.icon}<span class="pulse"></span></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}
function sensorPopup(s) {
  return `<b>${s.name}</b> <span class="muted">(${s.id})</span><br>${s.location}<br>Value: <b>${s.value} ${s.unit}</b><br>Status: ${s.status} · Battery ${s.battery}%`;
}
function updateMap(pred) {
  if (!window.ffMap) return;
  const c = App.levelColor(pred.level);
  MAP.refs.zones.forEach(z => z.setStyle({ color: c, fillColor: c, fillOpacity: pred.level === "CRITICAL" ? 0.28 : 0.14 }));
  /* simplest robust path: rebuild sensor markers by id map captured at init */
  ["RAIN-01","RIV-01","SOIL-01","TEMP-01","HUM-01","FLOW-01","PRE-01"].forEach(id => {
    const s = SensorHub.sensors[id];
    const m = MAP.refs.sensors[id];
    if (!s || !m) return;
    m.setIcon(sensorIcon(s));
    m.setPopupContent(sensorPopup(s));
  });
  /* colour circle markers for hotspot villages */
  MAP.refs.villages.forEach(m => {
    const lvl = window.ffPred && window.ffPred.level;
    const col = lvl === "CRITICAL" ? "#ef4444" : lvl === "HIGH" ? "#f87171" : "#fbbf24";
    // village markers stay colour-coded by their own recorded risk (visual legend)
  });
}

/* =========================================================================
   RENDER — dashboard (called every refresh cycle)
   ========================================================================= */
async function renderDashboard(pred, sensors) {
  window.ffPred = pred;

  /* ---- risk hero ---- */
  App.updateGauge(pred.score);
  const badge = $("#riskBadge");
  if (badge) {
    badge.className = "risk-level-badge lv-" + pred.level + (pred.level === "CRITICAL" || pred.level === "HIGH" ? " pulse" : "");
    badge.innerHTML = `<span class="rdot"></span>${pred.level} RISK`;
  }
  const set = (id, v) => { const el = $(id); if (el && v != null) el.textContent = v; };
  set("#metricConfidence", pred.confidence + "%");
  set("#metricProbability", pred.probability + "%");
  set("#metricEta", pred.etaMinutes >= 60 ? (pred.etaMinutes / 60).toFixed(1) + " h" : pred.etaMinutes + " min");
  set("#metricModel", pred.model);
  set("#metricTime", new Date(pred.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  $("#reasonLine").innerHTML = `<span class="r-ico">🧠</span> ${pred.explanation.split(". ").slice(0, 2).join(". ")}.`;

  /* ---- AI explanation panel ---- */
  const expl = $("#aiExplanation");
  if (expl) {
    expl.querySelector(".ai-body").textContent = pred.explanation;
    expl.querySelector(".ai-chips").innerHTML = Object.entries(pred.factors).map(([k, f]) => {
      const lbl = { rain: "Rainfall", water: "Water level", soil: "Soil", flow: "Flow", hum: "Humidity" }[k] || k;
      const arrow = f.dir === "up" ? "▲ +" : f.dir === "down" ? "▼ " : "◆ ";
      return `<span class="ai-factor ${f.dir === "up" ? "up" : "steady"}">${lbl} ${arrow}${f.dir === "up" ? f.pct + "%" : Math.abs(f.abs)}</span>`;
    }).join("");
  }

  /* ---- sensor cards ---- */
  const sc = $("#sensorCards");
  if (sc) sc.innerHTML = App.sensorCards(sensors);

  /* ---- charts ---- */
  const rail = SensorHub.sensors["RAIN-01"].history.slice(-40);
  const wtr = SensorHub.sensors["RIV-01"].history.slice(-40);
  const soil = SensorHub.sensors["SOIL-01"].history.slice(-40);
  const labels = rail.map(p => p.t);
  setChartData(PAGE.charts.rainChart, labels, rail.map(p => p.v));
  setChartData(PAGE.charts.waterChart, wtr.map(p => p.t), wtr.map(p => p.v));
  setChartData(PAGE.charts.soilChart, soil.map(p => p.t), soil.map(p => p.v));

  SensorHub.predictionHistory.push({ t: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), score: pred.score });
  if (SensorHub.predictionHistory.length > 60) SensorHub.predictionHistory.shift();
  setChartData(PAGE.charts.riskChart,
    SensorHub.predictionHistory.map(p => p.t),
    SensorHub.predictionHistory.map(p => p.score));

  /* ---- map ---- */
  updateMap(pred);

  /* ---- warning banner ---- */
  const banner = $("#warningBanner");
  const isWarn = pred.level === "HIGH" || pred.level === "CRITICAL";
  if (banner) {
    banner.classList.toggle("active", isWarn);
    if (isWarn) {
      $("#wbTitle").textContent = "⚠ FLASH FLOOD WARNING";
      const alert = SensorHub.alerts[0];
      $("#wbReason").textContent = alert ? alert.reason : pred.explanation.split(". ")[0] + ".";
      $("#wbLoc").innerHTML = `<b>${alert ? alert.loc : "Alaknanda Basin"}</b>`;
      $("#wbLevel").innerHTML = `<b style="color:var(--critical)">${pred.level}</b>`;
      $("#wbTime").innerHTML = `<b>${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b>`;
      $("#wbAction").innerHTML = `<b>${Actions.recommendFor(pred.level).split(".")[0]}.</b>`;
    }
  }

  /* ---- alerts feed ---- */
  const feed = $("#alertsFeed");
  if (feed) {
    const items = SensorHub.alertHistory.slice(0, 6).map(a => `
      <div class="alert-item">
        <div class="a-ico ${a.level === "CRITICAL" || a.level === "HIGH" ? "danger" : a.level === "MODERATE" ? "warn" : "info"}">${a.status === "ACTIVE" && (a.level === "CRITICAL" || a.level === "HIGH") ? "🚨" : "ℹ️"}</div>
        <div style="flex:1">
          <div class="a-title">${a.title} <span class="badge ${a.level === "CRITICAL" ? "offline" : a.level === "HIGH" ? "offline" : a.level === "MODERATE" ? "" : ""}" style="background:${App.levelColor(a.level)}22;color:${App.levelColor(a.level)}">${a.level}</span></div>
          <div class="a-text">${a.loc} — ${a.reason}</div>
          <div class="a-time">🕐 ${a.time} · ${a.status}${a.channels ? " · 📡 " + a.channels.length + " channels" : ""}</div>
        </div>
      </div>`).join("");
    feed.innerHTML = items || `<div class="empty-state">No alerts raised yet — system monitoring.</div>`;
  }

  /* ---- emergency live values ---- */
  const occ1 = $("#occ1"), occ2 = $("#occ2"), occ3 = $("#occ3");
  if (occ1) occ1.textContent = "210 / 500";
  if (occ2) occ2.textContent = 95 + (pred.score > 60 ? 22 : 0) + " / 300";
  if (occ3) occ3.textContent = pred.score > 60 ? "OPENING" : "READY";

  /* ---- broadcast channel counts ---- */
  const cc = $("#channelCounts");
  if (cc) cc.textContent = `Session: SMS ${SensorHub.channels.sms} · Push ${SensorHub.channels.push} · Email ${SensorHub.channels.email} · Authority ${SensorHub.channels.authority} · Evacuations ${SensorHub.channels.evac}`;

  /* ---- simulation sliders follow state ---- */
  SIM_SLIDERS.forEach(s => {
    const el = document.getElementById(s.id);
    if (!el) return;
    el.value = SensorHub.sensors[s.sensor].value;
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty("--fill", p + "%");
    const lbl = document.getElementById("simval-" + s.sensor);
    if (lbl) lbl.textContent = el.value;
  });
}

/* live fill for the View Details modal */
PAGE.populateViewAlert = function () {
  const a = SensorHub.alerts[0];
  const p = window.ffPred || { level: "LOW", score: 12, explanation: "Reading sensor streams.", etaMinutes: 720 };
  const lvl = a ? a.level : p.level;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#viewAlertId", a ? a.id : "AL-000");
  set("#viewAlertTitle", a ? a.title : "NO ACTIVE WARNING — SYSTEM MONITORING");
  set("#viewAlertLoc", a ? a.loc : "Alaknanda Basin", );
  set("#viewAlertLevel", lvl);
  set("#viewAlertTime", a ? a.time : new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  set("#viewAlertReason", a ? a.reason : p.explanation.split(". ")[0] + ".");
  set("#viewAlertAction", Actions.recommendFor(lvl));
  const lvlEl = $("#viewAlertLevel");
  if (lvlEl) lvlEl.style.color = App.levelColor(lvl);
};

PAGE.init.dashboard = initDashboard;
PAGE.render.dashboard = renderDashboard;
