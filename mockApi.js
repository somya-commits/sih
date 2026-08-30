/* =========================================================================
   MOCK API & SENSOR DATA LAYER  (js/mockApi.js)
   ------------------------------------------------------------------------
   Simulates the backend REST endpoints for the SIH prototype:

     GET  /api/sensors      -> MockAPI.getSensors()
     GET  /api/prediction   -> MockAPI.getPrediction(sensorData)
     GET  /api/alerts       -> MockAPI.getAlerts()
     GET  /api/history      -> MockAPI.getHistory(range)

   ── PRODUCTION PATH (ESP32 → MQTT/HTTP → Backend → AI Model → Database → Dashboard)
   Real sensors (ESP32 + rain gauge + ultrasonic level sensor + soil probe) publish
   MQTT topics like `flood/+/telemetry`; a backend service ingests them, runs the
   trained ML model, and exposes the same 4 endpoints. To connect:

     GET /api/sensors -> fetch('/api/sensors').then(r => r.json())
     Mutations such as setValue/applyPreset are LOCAL to the demo; in production
     the dashboard only reads. Data flows one way: sensor -> backend -> dashboard.
   ========================================================================= */

"use strict";

/* -------------------------------------------------------------------------
 * Sensor definitions — metadata + normal/safe operating ranges.
 * Simulated deployment: Alaknanda river basin, Garhwal Himalaya, Uttarakhand.
 * Coordinates are real-world plausible (no API keys needed — Leaflet OSM tiles).
 * ---------------------------------------------------------------------- */
const SENSOR_DEFS = [
  { id: "RAIN-01", type: "rain",     name: "Rainfall Intensity", unit: "mm/hr", icon: "🌧️", color: "#38bdf8",
    location: "Upper Catchment · Sector 3",  sector: "Sector 3", lat: 30.808, lng: 79.184,
    normMin: 0, normMax: 30, danger: 80, battery: 92, status: "online",  calibration: "Calibrated 12 Aug 2026", healthy: true },
  { id: "RIV-01", type: "level",    name: "River Water Level",  unit: "m",    icon: "🌊", color: "#22d3ee",
    location: "Alaknanda Bridge · Sector 3", sector: "Sector 3", lat: 30.716, lng: 79.231,
    normMin: 0, normMax: 3.5, danger: 4.5, battery: 87, status: "online",  calibration: "Calibrated 10 Aug 2026", healthy: true },
  { id: "SOIL-01", type: "soil",     name: "Soil Moisture",      unit: "%",    icon: "🪨", color: "#a3e635",
    location: "Riverside Terraces · Sector 2", sector: "Sector 2", lat: 30.738, lng: 79.178,
    normMin: 20, normMax: 60, danger: 85, battery: 74, status: "online",  calibration: "Calibrated 02 Aug 2026", healthy: true },
  { id: "TEMP-01", type: "temp",     name: "Temperature",        unit: "°C",   icon: "🌡️", color: "#fb923c",
    location: "Helipad Station · Sector 1",  sector: "Sector 1", lat: 30.764, lng: 79.152,
    normMin: 15, normMax: 35, danger: 40, battery: 96, status: "online",  calibration: "Calibrated 14 Aug 2026", healthy: true },
  { id: "HUM-01",  type: "humidity", name: "Humidity",           unit: "%",    icon: "💧", color: "#60a5fa",
    location: "Forest Guard Post · Sector 3", sector: "Sector 3", lat: 30.787, lng: 79.216,
    normMin: 40, normMax: 90, danger: 95, battery: 81, status: "online",  calibration: "Calibrated 09 Aug 2026", healthy: true },
  { id: "FLOW-01", type: "flow",     name: "Water Flow Velocity", unit: "m/s", icon: "🏞️", color: "#2dd4bf",
    location: "Gauge Station · Downstream",  sector: "Sector 2", lat: 30.674, lng: 79.263,
    normMin: 0.5, normMax: 3, danger: 6, battery: 68, status: "offline", calibration: "Due 18 Aug 2026", healthy: false },
  { id: "PRE-01",  type: "pressure", name: "Atmospheric Pressure", unit: "hPa", icon: "🕳️", color: "#c084fc",
    location: "Sub-divisional HQ · Sector 1", sector: "Sector 1", lat: 30.795, lng: 79.146,
    normMin: 950, normMax: 1050, danger: 930, battery: 90, status: "online",  calibration: "Calibrated 05 Aug 2026", healthy: true }
];

/* Baseline "normal conditions" values for each sensor */
const SENSOR_BASELINE = {
  "RAIN-01": 8,  "RIV-01": 1.9, "SOIL-01": 44, "TEMP-01": 24.5,
  "HUM-01": 61,  "FLOW-01": 1.8, "PRE-01": 1012
};

/* Presets for the Simulation Mode (see js/simulation.js for the UI) */
const SIM_PRESETS = {
  normal:   { label: "Normal Conditions", desc: "Clear sky, steady river, dry slopes.",
              values: { "RAIN-01": 8,  "RIV-01": 1.9, "SOIL-01": 44, "TEMP-01": 24.5, "HUM-01": 61, "FLOW-01": 1.8, "PRE-01": 1012 } },
  heavy:    { label: "Heavy Rain",       desc: "Cloudburst over upper catchment, river rising.",
              values: { "RAIN-01": 68, "RIV-01": 3.7, "SOIL-01": 71, "TEMP-01": 21.5, "HUM-01": 89, "FLOW-01": 4.4, "PRE-01":  997 } },
  warning:  { label: "Flood Warning",    desc: "Sustained downpour, river near danger mark.",
              values: { "RAIN-01": 96, "RIV-01": 4.9, "SOIL-01": 84, "TEMP-01": 20.0, "HUM-01": 93, "FLOW-01": 6.2, "PRE-01":  985 } },
  critical: { label: "Critical Flood",   desc: "Extreme rainfall, danger-level breached, landslides.",
              values: { "RAIN-01": 138,"RIV-01": 6.3, "SOIL-01": 96, "TEMP-01": 19.0, "HUM-01": 97, "FLOW-01": 8.6, "PRE-01":  958 } }
};

const VILLAGES = [
  { name: "Joshimath",     pop: 16800, lat: 30.555, lng: 79.564, risk: "HIGH" },
  { name: "Pandukeshwar",  pop:  2400, lat: 30.522, lng: 79.598, risk: "MODERATE" },
  { name: "Helang",        pop:  3200, lat: 30.609, lng: 79.452, risk: "HIGH" },
  { name: "Govindghat",    pop:  1900, lat: 30.625, lng: 79.556, risk: "HIGH" },
  { name: "Tapovan",       pop:  4100, lat: 30.492, lng: 79.625, risk: "MODERATE" },
  { name: "Nauti",         pop:   920, lat: 30.547, lng: 79.421, risk: "LOW" },
  { name: "Pulna",         pop:  1300, lat: 30.570, lng: 79.505, risk: "MODERATE" },
  { name: "Lata Village",  pop:   760, lat: 30.468, lng: 79.622, risk: "LOW" },
  { name: "Bhyundar",      pop:   540, lat: 30.453, lng: 79.540, risk: "LOW" },
  { name: "Reni",          pop:   690, lat: 30.512, lng: 79.475, risk: "LOW" },
  { name: "Marwari",       pop:  1200, lat: 30.589, lng: 79.490, risk: "MODERATE" },
  { name: "Sankri",        pop:  2800, lat: 30.648, lng: 79.408, risk: "HIGH" },
  { name: "Kakbhitta",     pop:   830, lat: 30.634, lng: 79.532, risk: "HIGH" },
  { name: "Gwaldam",       pop:  1500, lat: 30.600, lng: 79.380, risk: "MODERATE" }
];

/* River course (Alaknanda-style) — polyline points north → south */
const RIVER_PATH = [
  [30.838, 79.122], [30.805, 79.158], [30.778, 79.183], [30.748, 79.212],
  [30.716, 79.231], [30.686, 79.245], [30.655, 79.268], [30.622, 79.301]
];

/* High-risk zones & flood-prone areas (circles / polygons on the map) */
const RISK_ZONES = [
  { id: "Z1", name: "Helang Bend",      lat: 30.609, lng: 79.452, r: 950,  base: "HIGH" },
  { id: "Z2", name: "Govindghat Confluence", lat: 30.625, lng: 79.556, r: 800, base: "HIGH" },
  { id: "Z3", name: "Joshimath Slopes", lat: 30.555, lng: 79.564, r: 1100, base: "MODERATE" }
];
const FLOOD_PLAINS = [
  [[30.716, 79.225],[30.728, 79.238],[30.719, 79.252],[30.705, 79.249],[30.701, 79.235]],
  [[30.652, 79.290],[30.664, 79.305],[30.655, 79.318],[30.641, 79.314],[30.638, 79.298]]
];

/* 30-day daily history (rainfall mm total, mean river level m, warnings, criticals, accuracy) */
const DAILY_HISTORY = (() => {
  const days = [], now = new Date();
  const seed = [18,42,9,3,27,58,8,0,0,0,24,71,46,12,2,0,0,34,88,23,5,1,0,0,0,19,52,17,4,36];
  const seedLvl = [2.1,2.4,1.9,1.7,2.2,3.1,1.8,1.6,1.6,1.6,2.3,3.4,2.9,2.0,1.7,1.6,1.6,2.8,3.9,2.5,1.8,1.6,1.6,1.6,1.6,2.2,2.8,2.1,1.8,2.5];
  for (let i = 0; i < 30; i++) {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i));
    const rain = seed[i];
    const critical = rain >= 80 ? 1 : 0;
    const warnings = (rain >= 50 ? 1 : 0) + (rain >= 30 && rain < 50 ? 1 : 0);
    days.push({
      date: d.toISOString().slice(0, 10),
      label: `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`,
      rainfall: rain, waterLevel: seedLvl[i],
      soilMoisture: Math.min(98, Math.round(40 + rain * 0.62)),
      warnings, criticals: critical, risk: Math.min(96, Math.round(rain * 0.9 + seedLvl[i] * 5)),
      accuracy: Number((96.4 - Math.random() * 3.3).toFixed(1))
    });
  }
  return days;
})();

/* Past flood events (demo data — dates relative to "today") */
const PAST_FLOOD_EVENTS = (() => {
  const now = new Date();
  const mk = (daysAgo, title, sector, severity, victims) => {
    const d = new Date(now); d.setDate(d.getDate() - daysAgo);
    return { date: d.toISOString().slice(0, 10), title, sector, severity, victims, evacuations: victims * 3 };
  };
  return [
    mk(6,  "Flash flood after cloudburst", "Sector 3 · Helang Bend", "CRITICAL", 1120),
    mk(13, "River breached danger level",  "Sector 2 · Govindghat",   "HIGH",     640),
    mk(19, "Landslide + water surge",      "Sector 1 · Joshimath",    "MODERATE", 180),
    mk(28, "Monsoon surge alert",          "Sector 3 · Alaknanda Br.", "MODERATE", 95)
  ];
})();

const RESCUE_TEAMS = [
  { id: "SDRF-1",  team: "SDRF Joshimath",     status: "Active",  members: 24, vehicles: "2 boats, 1 ambulance", eta: "ON STATION" },
  { id: "NDRF-11", team: "NDRF 11th Bn (Rishikesh)", status: "Active", members: 46, vehicles: "4 boats, 2 trucks", eta: "35 min" },
  { id: "FIRE-3",  team: "Fire & Emergency, Chamoli", status: "Standby", members: 18, vehicles: "2 tenders", eta: "50 min" },
  { id: "MED-2",   team: "District Hospital Medical Team", status: "Active", members: 30, vehicles: "3 ambulances", eta: "ON STATION" }
];

const SAFE_SHELTERS = [
  { name: "Govt. Inter College · Joshimath", capacity: 500, occupied: 210, dist: "1.2 km", status: "OPEN" },
  { name: "Community Hall · Tapovan",        capacity: 300, occupied: 95,  dist: "2.4 km", status: "OPEN" },
  { name: "ITBP Camp · Pandukeshwar",        capacity: 400, occupied: 0,   dist: "4.1 km", status: "READY" }
];
const HOSPITALS = [
  { name: "District Hospital Chamoli", beds: 120, phone: "01372-252188", dist: "8 km" },
  { name: "Primary Health Centre Joshimath", beds: 40, phone: "01389-222144", dist: "1.5 km" }
];
const POLICE = [
  { name: "Joshimath Police Station", phone: "01389-222233", dist: "1.1 km" },
  { name: "Chamoli Control Room",     phone: "01372-252333", dist: "8 km" }
];

/* -------------------------------------------------------------------------
 * SensorHub — in-memory live state shared across all pages.
 * Each sensor keeps a rolling 90-point history (one point per update tick).
 * ---------------------------------------------------------------------- */
const SensorHub = {
  sensors: {},          // id -> { ...SENSOR_DEFS entry, value, history:[{t,v}], lastUpdate }
  alerts: [],           // active warning feed
  alertHistory: [],     // all alerts raised this session (with resolved status)
  predictionHistory: [],// {t, score, level}
  counts: { warnings: 0, criticals: 0, presetsApplied: 0 },
  channels: { sms: 0, push: 0, email: 0, authority: 0, evac: 0 },

  init() {
    for (const def of SENSOR_DEFS) {
      const base = SENSOR_BASELINE[def.id];
      this.sensors[def.id] = {
        ...def,
        value: base,
        lastUpdate: Date.now(),
        history: this._genHistory(def.type, base, def.normMax)
      };
    }
    this.predictionHistory = this._genPredictionHistory();
    this.seedAlerts();
    return this;
  },

  _genHistory(type, base, max, n = 60) {
    const out = [], now = Date.now();
    let v = base;
    for (let i = n; i >= 0; i--) {
      // gentle random walk backward from the baseline
      v = Math.max(0, v + (Math.random() - 0.5) * max * 0.05);
      out.push({ t: new Date(now - i * 60000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), v: +v.toFixed(1) });
    }
    return out;
  },

  _genPredictionHistory() {
    const out = [], now = Date.now();
    for (let i = 60; i >= 0; i--) {
      const s = 12 + Math.random() * 10;
      out.push({ t: new Date(now - i * 60000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), score: +s.toFixed(0) });
    }
    return out;
  },

  seedAlerts() {
    this.alertHistory = [
      { id: "AL-104", level: "MODERATE", title: "Rainfall crossing watch threshold", loc: "Sector 3 · Upper Catchment",
        reason: "Rainfall intensity above 40 mm/hr for 20 minutes.", time: this._ago(46), status: "RESOLVED", channel: "push" },
      { id: "AL-103", level: "LOW", title: "Soil moisture easing", loc: "Sector 2 · Riverside Terraces",
        reason: "Moisture fell below 55% after dry spell.", time: this._ago(320), status: "RESOLVED", channel: "log" }
    ];
    this.counts.warnings = this.alertHistory.filter(a => a.level === "MODERATE").length;
  },

  _ago(mins) { const d = new Date(Date.now() - mins * 60000); return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); },

  /* SET value from simulation slider / preset — push into history */
  setValue(id, v) {
    const s = this.sensors[id];
    if (!s) return;
    s.value = +v;
    s.history.shift();
    s.history.push({ t: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), v: +v });
    s.lastUpdate = Date.now();
  },

  applyPreset(key) {
    const p = SIM_PRESETS[key];
    if (!p) return;
    for (const [id, v] of Object.entries(p.values)) this.setValue(id, v);
    this.counts.presetsApplied++;
  },

  /* Random drift — used by "Auto simulation" toggle (small, realistic noise) */
  autoTick() {
    for (const id of Object.keys(this.sensors)) {
      const s = this.sensors[id];
      const noise = (Math.random() - 0.5) * (s.normMax - s.normMin) * 0.02;
      this.setValue(id, Math.max(0, s.value + noise));
    }
  },

  getSensorArray() { return Object.values(this.sensors).map(s => ({ ...s, history: s.history.slice(-30) })); },
  getSensorById(id) { return this.sensors[id]; }
};

/* -------------------------------------------------------------------------
 * MockAPI — Promise-based façade matching the future REST backend.
 * Replace each method body with a fetch() to swap in the real backend.
 * ---------------------------------------------------------------------- */
const MockAPI = {
  delay: (ms = 120) => new Promise(r => setTimeout(r, ms)),

  async getSensors() {
    await this.delay();
    // PRODUCTION: return fetch("/api/sensors").then(r => r.json());
    return SensorHub.getSensorArray();
  },

  async getPrediction(sensorData) {
    await this.delay(160);
    // PRODUCTION: return fetch("/api/prediction", { method: "POST", body: JSON.stringify(sensorData) }).then(r => r.json());
    return AIModel.predictFloodRisk(sensorData);   // js/aiModel.js
  },

  async getAlerts() {
    await this.delay();
    // PRODUCTION: return fetch("/api/alerts").then(r => r.json());
    return { active: SensorHub.alerts, history: SensorHub.alertHistory.slice().reverse() };
  },

  async getHistory(range) {
    await this.delay();
    // PRODUCTION: return fetch(`/api/history?range=${range}`).then(r => r.json());
    return DashboardStore.buildHistory(range);     // js/ui.js (data assembly)
  },

  /* Stub CRUD used by "Add Sensor" modal */
  async addSensor(payload) {
    await this.delay(400);
    // PRODUCTION: return fetch("/api/sensors", { method: "POST", ... })
    const id = "NEW-" + String(8 + SensorHub.getSensorArray().length).padStart(2, "0");
    const def = {
      id, type: payload.type, name: payload.name || payload.type.toUpperCase(), unit: payload.unit || "—",
      icon: "📡", color: "#22d3ee", location: payload.location || "Unassigned", sector: "Sector 3",
      lat: 30.66 + Math.random() * 0.15, lng: 79.20 + Math.random() * 0.15,
      normMin: 0, normMax: 100, danger: 90, battery: 100, status: "online",
      calibration: "Awaiting calibration", healthy: true
    };
    SensorHub.sensors[id] = {
      ...def, value: 0, lastUpdate: Date.now(),
      history: Array.from({ length: 61 }, (_, i) => ({ t: "", v: 0 }))
    };
    return id;
  },

  async toggleSensor(id) {
    await this.delay(120);
    const s = SensorHub.sensors[id];
    if (s) s.status = s.status === "online" ? "offline" : "online";
    return s;
  }
};

/* Initialise the hub immediately (simulated sensors start running) */
SensorHub.init();
