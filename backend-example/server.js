/* =========================================================================
   REFERENCE BACKEND — Node.js/Express ingestion + prediction proxy
   backend-example/server.js
   ------------------------------------------------------------------------
   Minimal skeleton showing how the SIH prototype connects later:

     ESP32 ─MQTT─▶ MQTT Broker ─▶ this server ─▶ ML service ─▶ MongoDB/Postgres
                                                          │
     Dashboard ──GET /api/sensors──────────────────────────┘
     Dashboard ──POST /api/prediction ──▶ /predict (FastAPI, see ml_model.py)

   Run:  npm install express mqtt cors && node server.js
   ========================================================================= */

const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

/* ---- In-memory telemetry store (replace with MongoDB/Postgres) ---- */
const store = { sensors: {}, history: [] };

/* ---- MQTT ingest: flood/<sector>/telemetry ---- */
const client = mqtt.connect("mqtt://broker.emqx.io:1883");
client.on("connect", () => client.subscribe("flood/+/telemetry"));
client.on("message", (topic, payload) => {
  const msg = JSON.parse(payload.toString());            // {id, value, unit, battery}
  store.sensors[msg.id] = { ...msg, lastUpdate: Date.now() };
  store.history.push({ ...msg, ts: Date.now() });
  if (store.history.length > 10000) store.history.shift();
  console.log("telemetry:", msg.id, msg.value, msg.unit);
});

/* ---- REST endpoints consumed by the dashboard (see js/mockApi.js) ---- */
app.get("/api/sensors", (req, res) => res.json(Object.values(store.sensors)));
app.post("/api/telemetry", (req, res) => {               // HTTP fallback for ESP32
  const msg = req.body;
  store.sensors[msg.id] = { ...msg, lastUpdate: Date.now() };
  res.json({ ok: true });
});
app.post("/api/prediction", async (req, res) => {
  // Forward to the ML service (FastAPI) — see ml_model.py
  const r = await fetch("http://localhost:8000/predict", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });
  res.json(await r.json());
});
app.get("/api/alerts", (req, res) => res.json({ alerts: [] }));
app.get("/api/history", (req, res) => res.json({ samples: store.history }));

app.listen(3000, () => console.log("flood backend on :3000"));
