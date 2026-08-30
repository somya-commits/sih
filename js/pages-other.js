/* =========================================================================
   SENSORS · HISTORY · ADMIN PAGE RENDERERS  (js/pages-other.js)
   ========================================================================= */

"use strict";

/* =========================================================================
   HISTORICAL DATA ASSEMBLY  (mirrors GET /api/history?range=)
   ========================================================================= */
PAGE.data = {
  buildHistory(range) {
    const days = DAILY_HISTORY;
    if (range === "24H") {
      const p = s => SensorHub.sensors[s] ? SensorHub.sensors[s].history.slice(-48) : [];
      const rain = p("RAIN-01"), wtr = p("RIV-01"), soil = p("SOIL-01");
      return {
        labels: rain.map(x => x.t),
        rainfall: rain.map(x => x.v),
        waterLevel: wtr.map(x => x.v),
        soilMoisture: soil.map(x => x.v),
        risk: SensorHub.predictionHistory.map(x => x.score),
        riskLabels: SensorHub.predictionHistory.map(x => x.t),
        stats: {
          rainTotal: rain.reduce((a, b) => a + b.v, 0).toFixed(0) + " mm",
          peakWater: Math.max(...wtr.map(x => x.v)).toFixed(1) + " m",
          warnings: SensorHub.counts.warnings,
          criticals: SensorHub.counts.criticals,
          accuracy: "96.2%",
          events: PAST_FLOOD_EVENTS.filter(e => e.severity !== "CRITICAL" || true).length
        },
        events: PAST_FLOOD_EVENTS.slice(0, 3)
      };
    }
    const n = range === "7D" ? 7 : 30;
    const slice = days.slice(-n);
    return {
      labels: slice.map(d => d.label),
      rainfall: slice.map(d => d.rainfall),
      waterLevel: slice.map(d => d.waterLevel),
      soilMoisture: slice.map(d => d.soilMoisture),
      risk: slice.map(d => d.risk),
      stats: {
        rainTotal: slice.reduce((a, d) => a + d.rainfall, 0).toFixed(0) + " mm",
        peakWater: Math.max(...slice.map(d => d.waterLevel)).toFixed(1) + " m",
        warnings: slice.reduce((a, d) => a + d.warnings, 0),
        criticals: slice.reduce((a, d) => a + d.criticals, 0),
        accuracy: (slice.reduce((a, d) => a + d.accuracy, 0) / slice.length).toFixed(1) + "%",
        events: PAST_FLOOD_EVENTS.filter(e => (new Date() - new Date(e.date)) / 86400000 <= n).length
      },
      events: PAST_FLOOD_EVENTS
    };
  }
};

/* =========================================================================
   SENSORS PAGE
   ========================================================================= */
function initSensorsPage() {
  $("#addSensorBtn").addEventListener("click", () => App.openModal("addSensor"));
  $("#addSensorGo").addEventListener("click", async () => {
    const name = $("#nsName").value.trim(), loc = $("#nsLoc").value.trim();
    const type = $("#nsType").value, unit = $("#nsUnit").value.trim();
    const id = await MockAPI.addSensor({ name: name || type, location: loc || "Sector 3 · Unassigned", type, unit });
    App.toast("success", "Sensor Added", `Sensor ${id} registered. Calibration pending (demo).`);
    App.closeModal();
    $("#nsName").value = ""; $("#nsLoc").value = ""; $("#nsUnit").value = "";
    renderSensorsTable();
  });
}

function renderSensorsTable() {
  const tb = $("#sensorsTableBody");
  if (!tb) return;
  const arr = SensorHub.getSensorArray();
  const on = arr.filter(s => s.status === "online").length;
  const setS = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };
  setS("sTotal", arr.length);
  setS("sOnline", on);
  setS("sOffline", arr.length - on);
  setS("sBattery", Math.round(arr.reduce((a, s) => a + s.battery, 0) / Math.max(1, arr.length)) + "%");
  const rows = arr.map(s => {
    const bat = s.battery;
    const batCls = bat > 50 ? "" : bat > 25 ? "mid" : "low";
    const last = new Date(s.lastUpdate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `
    <tr>
      <td><b>${s.name}</b><div class="small muted">${s.id}</div></td>
      <td><div class="loc">📍 ${s.location}</div></td>
      <td><b>${s.value}</b> <span class="muted">${s.unit}</span>
        <div class="small muted">Range ${s.normMin}–${s.normMax}</div></td>
      <td><span class="badge ${s.status === "online" ? "online" : "offline"}">${s.status === "online" ? "● Online" : "○ Offline"}</span></td>
      <td><div class="battery"><span class="bt-fill"><i class="${batCls}" style="width:${bat}%"></i></span><span>${bat}%</span></div></td>
      <td><span class="mono">${last}</span></td>
      <td><span class="badge ${s.calibration.includes("Due") ? "offline" : "cal"}">${s.calibration.includes("Due") ? "⚠ " + s.calibration : "✔ " + s.calibration}</span></td>
      <td><button class="btn btn-sm" data-toggle="${s.id}">${s.status === "online" ? "Deactivate" : "Activate"}</button></td>
    </tr>`;
  }).join("");
  tb.innerHTML = rows;

  /* toggle buttons */
  $$("#sensorsTableBody [data-toggle]").forEach(b => {
    b.addEventListener("click", async () => {
      await MockAPI.toggleSensor(b.dataset.toggle);
      renderSensorsTable();
      App.toast("info", "Sensor Updated", `${b.dataset.toggle} status toggled (demo).`);
    });
  });
}

/* =========================================================================
   HISTORY PAGE
   ========================================================================= */
let historyRange = "7D";
function initHistoryPage() {
  const seg = $("#rangeSeg");
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    historyRange = b.dataset.range;
    $$("#rangeSeg button").forEach(x => x.classList.toggle("active", x === b));
    renderHistory();
  });
  renderHistory();
}

function renderHistory() {
  const h = PAGE.data.buildHistory(historyRange);
  const canvas = (id) => document.getElementById(id);

  /* charts (create once, then update) */
  PAGE.charts.histRain = PAGE.charts.histRain || makeChart("histRain", "Rainfall", "#38bdf8", "bar", true);
  PAGE.charts.histWater = PAGE.charts.histWater || makeChart("histWater", "Water level (m)", "#22d3ee");
  PAGE.charts.histRisk = PAGE.charts.histRisk || makeChart("histRisk", "Flood risk (%)", "#f87171");

  setChartData(PAGE.charts.histRain, h.labels, h.rainfall);
  setChartData(PAGE.charts.histWater, h.labels, h.waterLevel);
  setChartData(PAGE.charts.histRisk, historyRange === "24H" ? h.riskLabels : h.labels, h.risk);

  /* stats */
  const stats = h.stats;
  $("#hRain").innerHTML = `${stats.rainTotal.split(" ")[0]}<span class="small muted"> mm</span>`;
  $("#hPeak").innerHTML = `${stats.peakWater.split(" ")[0]}<span class="small muted"> m</span>`;
  $("#hWarn").textContent = stats.warnings;
  $("#hCrit").textContent = stats.criticals;
  $("#hAcc").textContent = stats.accuracy;
  $("#hEvents").textContent = stats.events;
  const ai = $("#accInline"); if (ai) ai.textContent = stats.accuracy;

  /* events table */
  $("#histEventsBody").innerHTML = h.events.map(e => `
    <tr>
      <td><b>${new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</b></td>
      <td>${e.title}</td>
      <td>${e.sector}</td>
      <td><span class="badge offline" style="background:${e.severity === "CRITICAL" ? "var(--critical-soft)" : "var(--warn-soft)"};color:${e.severity === "CRITICAL" ? "var(--critical)" : "var(--warn)"}">${e.severity}</span></td>
      <td>${e.evacuations.toLocaleString()}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty-state">No events in range</td></tr>`;

  $("#histNote").textContent = `Showing ${historyRange === "24H" ? "live telemetry (last 48 samples)" : "daily aggregates — last " + (historyRange === "7D" ? "7" : "30") + " days"} · demo data`;
}

/* =========================================================================
   ADMIN PAGE
   ========================================================================= */
function initAdminPage() {
  if (localStorage.getItem("ff-role") !== "admin" && localStorage.getItem("ff-role") !== "dma") {
    const gate = $("#adminGate");
    if (gate) {
      gate.style.display = "block";
      $$("#adminContent").forEach(el => el.style.display = "none");
    }
  }
  renderAdmin();
}

function renderAdmin() {
  if ($("#adminGate") && $("#adminGate").style.display === "block") return;
  const sensors = SensorHub.getSensorArray();
  const active = sensors.filter(s => s.status === "online").length;
  const offline = sensors.length - active;
  const alertsActive = SensorHub.alerts.filter(a => a.status === "ACTIVE").length;
  const hotspots = VILLAGES.filter(v => v.risk === "HIGH" || v.risk === "CRITICAL").length;

  const tile = (id, val, sub) => { const el = $("#" + id); if (el) el.innerHTML = val + (sub ? `<div class="st-sub">${sub}</div>` : ""); };
  const chSum = Object.values(SensorHub.channels).reduce((a, b) => a + b, 0);
  tile("adChannels", chSum, "broadcast messages");
  tile("adTotal", sensors.length, sensors.length + " deployed nodes");
  tile("adActive", active, "reporting normally");
  tile("adOffline", offline, "need attention");
  tile("adAlerts", alertsActive, "active warnings");
  tile("adHot", hotspots, "HIGH/CRITICAL villages");
  tile("adVillages", VILLAGES.length, "registered communities");
  tile("adTeams", RESCUE_TEAMS.filter(t => t.status === "Active").length + " / " + RESCUE_TEAMS.length, "rescue units ready");

  /* doughnut: sensor status */
  const dn = $("#adminDoughnut");
  if (dn) {
    if (!PAGE.charts.adminDoughnut) {
      PAGE.charts.adminDoughnut = new Chart(dn.getContext("2d"), {
        type: "doughnut",
        data: { labels: ["Online", "Offline"], datasets: [{ data: [active, offline], backgroundColor: ["#34d399", "#f87171"], borderWidth: 0, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
          plugins: { legend: { position: "bottom", labels: { color: App.cssVar("--muted"), font: { size: 11 } } } } }
      });
    } else {
      PAGE.charts.adminDoughnut.data.datasets[0].data = [active, offline];
      PAGE.charts.adminDoughnut.update();
    }
  }

  /* bar: messages by channel */
  const ch = Object.entries(SensorHub.channels).map(([k, v]) => ({ k, v }));
  const barc = $("#adminBar");
  if (barc) {
    const names = { sms: "SMS", push: "Push", email: "Email", authority: "Authority", evac: "Evacuations" };
    if (!PAGE.charts.adminBar) {
      PAGE.charts.adminBar = new Chart(barc.getContext("2d"), {
        type: "bar",
        data: { labels: ch.map(c => names[c.k] || c.k), datasets: [{ label: "Messages", data: ch.map(c => c.v), backgroundColor: ["#34d399","#22d3ee","#60a5fa","#fbbf24","#f87171"], borderRadius: 7 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { display: false }, ticks: { color: App.cssVar("--muted") } },
                    y: { beginAtZero: true, ticks: { stepSize: 1, color: App.cssVar("--muted") }, grid: { color: App.cssVar("--border") } } } }
      });
    } else {
      PAGE.charts.adminBar.data.labels = ch.map(c => names[c.k] || c.k);
      PAGE.charts.adminBar.data.datasets[0].data = ch.map(c => c.v);
      PAGE.charts.adminBar.update();
    }
  }

  /* hotspots list */
  const hl = $("#hotspotList");
  if (hl) {
    hl.innerHTML = VILLAGES.filter(v => v.risk !== "LOW")
      .sort((a, b) => ({ HIGH: 2, MODERATE: 1, CRITICAL: 3 }[b.risk] - { HIGH: 2, MODERATE: 1, CRITICAL: 3 }[a.risk]))
      .slice(0, 6).map(v => `
      <div class="alert-item">
        <div class="a-ico ${v.risk === "HIGH" || v.risk === "CRITICAL" ? "danger" : "warn"}">📍</div>
        <div style="flex:1">
          <div class="a-title">${v.name} <span class="badge offline" style="background:${App.levelColor(v.risk)}22;color:${App.levelColor(v.risk)}">${v.risk}</span></div>
          <div class="a-text">Population ${v.pop.toLocaleString()} · ${v.lat.toFixed(3)}, ${v.lng.toFixed(3)}</div>
        </div>
      </div>`).join("");
  }

  /* rescue teams table */
  const rt = $("#rescueTableBody");
  if (rt) {
    rt.innerHTML = RESCUE_TEAMS.map(t => `
      <tr>
        <td><b>${t.team}</b><div class="small muted mono">${t.id}</div></td>
        <td><span class="badge ${t.status === "Active" ? "online" : "warn"}">● ${t.status.toUpperCase()}</span></td>
        <td>${t.members}</td>
        <td>${t.vehicles}</td>
        <td><b class="${t.eta.includes("ON STATION") ? "" : "muted"}">${t.eta}</b></td>
      </tr>`).join("");
  }

  /* recent alerts */
  const ra = $("#adminAlerts");
  if (ra) {
    ra.innerHTML = SensorHub.alertHistory.slice(0, 5).map(a => `
      <div class="alert-item">
        <div class="a-ico ${a.level === "CRITICAL" || a.level === "HIGH" ? "danger" : "warn"}">${a.level === "CRITICAL" || a.level === "HIGH" ? "🚨" : "⚠️"}</div>
        <div style="flex:1">
          <div class="a-title">${a.title}</div>
          <div class="a-text">${a.loc}</div>
          <div class="a-time">${a.time} · ${a.status}</div>
        </div>
      </div>`).join("") || `<div class="empty-state">No alerts this session</div>`;
  }
}

/* =========================================================================
   REGISTER PAGE HOOKS
   ========================================================================= */
PAGE.init.sensors = initSensorsPage;
PAGE.render.sensors = renderSensorsTable;

PAGE.init.history = initHistoryPage;
PAGE.render.history = null;   // static per range selection

PAGE.init.admin = initAdminPage;
PAGE.render.admin = renderAdmin;
