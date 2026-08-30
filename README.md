# 🌊 AI FloodGuard — AI-Powered Flash Flood Prediction & Early Warning System for Hilly Regions

**Smart India Hackathon (SIH) prototype** · Simulated IoT sensor network + AI risk engine + early-warning dashboard
Demo deployment: **Alaknanda river basin, Chamoli district, Garhwal Himalaya, Uttarakhand**

> Fully functional in **demo mode** — no servers, no API keys, no physical sensors required. Open `index.html` and present.

---

## 🚀 1. Running the project

No build step. Any static file server works:

```bash
# Option A — Python
cd flood-system
python3 -m http.server 8000

# Option B — Node
npx serve flood-system

# Option C — npx live-server
npx live-server flood-system
```

Then open **http://localhost:8000** (or click the index.html in a file browser).

**Pages**

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `index.html` | Live sensors, AI risk hero, charts, map, alerts, emergency |
| Sensors | `sensors.html` | Inventory table, battery, calibration, add sensor |
| Historical | `history.html` | Today / 7-day / 30-day trends, events, accuracy |
| Admin | `admin.html` | District stats, charts, hotspots, rescue teams |

**Role switcher** — click your profile (top-right) to switch Administrator / DMA / Rescue Team / Public. Each role sees a tailored UI (Public hides simulation & command controls).
**Theme** — the ☀️/🌙 button toggles dark/light (persisted in `localStorage`).
**Simulation** — on the dashboard, move the five sliders or tap a scenario button (`Normal Conditions`, `Heavy Rain`, `Flood Warning`, `Critical Flood`). Presets drive the risk score across the 0–30 / 31–60 / 61–80 / 81–100 thresholds, triggering the warning banner, alerts, channels and evacuation readiness live. Try `Critical Flood` at the demo.

---

## 📁 Project structure

```
flood-system/
├── index.html            # Main dashboard
├── sensors.html          # Sensor management page
├── history.html          # Historical analysis page
├── admin.html            # Administation console
├── css/
│   └── style.css         # Dark/light design system, responsive grid
├── js/
│   ├── mockApi.js        # ★ Mock REST layer: GET /api/sensors, /api/prediction,
│   │                     #   /api/alerts, /api/history  (+ sensor simulation hub)
│   ├── aiModel.js        # ★ AIModel.predictFloodRisk(sensorData)  ← DEMO AI LOGIC
│   ├── alerts.js         # ★ Early warning engine + SMS/push/email/authority senders
│   ├── simulation.js     # Sliders + presets → same pipeline as real telemetry
│   ├── ui.js             # Header, clock, role/theme, toasts, master refresh loop
│   ├── pages-dashboard.js# Dashboard renderers + Leaflet map
│   ├── pages-other.js    # Sensors/history/admin renderers
│   └── vendor/           # Chart.js 4.4.3, Leaflet 1.9.4 (offline-capable)
└── backend-example/      # Reference Node/FastAPI skeleton (see §4)
```

**Data flow (production shape)**

```
ESP32 / Arduino ──MQTT/HTTP──▶ Backend ──▶ AI/ML Model ──▶ Database ──▶ Dashboard
   (sensors)                  (ingest)    (prediction)     (history)    (this UI)
```

The dashboard only consumes the four mock endpoints. Point them at a real backend and nothing else changes.

---

## 🔌 2. Connecting ESP32 sensors

Each node is an ESP32 with any of these sensors:

| Sensor | Typical part | ESP32 pin | Data |
|---|---|---|---|
| Rainfall | Tipping-bucket rain gauge (pulse) | GPIO 34 (interrupt) | mm/hr |
| Water level | JSN-SR04T ultrasonic + stilling well | GPIO 4 (trig) / 5 (echo) | meters |
| Soil moisture | Capacitive probe (e.g. v2.0) + ADC | GPIO 35 (ADC1) | % |
| Flow velocity | Doppler/current meter (RS485 → MAX485) | UART2 | m/s |
| Temperature / humidity | DHT22 / SHT31 | GPIO 21/22 (I²C) | °C / % |
| Pressure | BMP280 | GPIO 21/22 (I²C) | hPa |

**Publish loop (pseudo-code)**

```cpp
void loop() {
  StaticJsonDocument<256> doc;
  doc["id"]     = "RIV-01";            // match sensor ids in js/mockApi.js
  doc["type"]   = "level";
  doc["value"]  = readUltrasonic();    // meters
  doc["unit"]   = "m";
  doc["battery"]= round((analogRead(35)/4095.0)*100);
  mqtt.publish("flood/sector3/telemetry", doc);   // or HTTP POST /api/telemetry
  delay(5000);                          // 5 s sampling, battery-saver LoRa option
}
```

Broker: `broker.emqx.io` (public test) or your own Mosquitto. Topics: `flood/<sector>/telemetry`, `flood/<id>/status`.

The frontend's `SensorHub.setValue(id, value)` (in `js/mockApi.js`) is the exact seam where MQTT/HTTP telemetry lands — the simulator writes there today.

---

## 🔄 3. Replacing mock sensor data with real data

**Option A — keep the static page, poll a real backend.** In `js/mockApi.js`, rewrite the four methods to `fetch()`:

```js
async getSensors() {
  const r = await fetch("/api/sensors");     // real backend now
  return r.json();
}
async getPrediction(data) {
  const r = await fetch("/api/prediction", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();                            // must return the AIModel result shape
}
```

**Option B — WebSocket / MQTT-over-WebSocket.** Subscribe in `ui.js` and call `SensorHub.setValue(...)` on each incoming packet, then `App.cycle()` — identical to what the simulator does.

The alerts engine (`js/alerts.js`) reacts to any data arriving via `SensorHub` — no UI changes needed.

---

## 🧠 4. Connecting a real AI/ML model

**The contract (stable):**

```js
// js/aiModel.js — currently DEMO (weighted scoring, explicitly labelled)
AIModel.predictFloodRisk(sensorData)
  → { score, level, confidence, probability, etaMinutes, factors, explanation, model, generatedAt }
```

**Swap in a trained model — three options:**

1. **FastAPI/Python service (recommended)** — see `backend-example/`. Serve `POST /api/predict` that loads your model and returns the same JSON shape; change `predictFloodRisk()` to call it.
2. **ONNX/TF.js in-browser** — export the model to ONNX, run with `onnxruntime-web`, keep the same wrapper.
3. **Training notes**
   - **Random Forest / XGBoost classifier**: features = 60-min rainfall sum, Δwater level, soil moisture, flow velocity, humidity, pressure trend → target = flood within 6 h. Rescale output probability to 0–100 risk.
   - **LSTM**: sequences of the last N telemetry windows (e.g. 24 × 5-min samples) → forecast water level + flood probability for next 1–3 h. Ideal for the `history` arrays the sensors already maintain.

Keep an evaluation window (see the History page accuracy tile): log every prediction and actual outcome to measure precision and tune thresholds 30/60/80.

---

## ☁️ 5. Deploying the application online

Static hosting — the whole app is plain HTML/CSS/JS:

- **GitHub Pages**: push `flood-system/` to a repo → Settings → Pages → deploy from branch. Works at `/` or any sub-path (all links/asset paths are relative).
- **Netlify / Vercel**: drag-and-drop the folder. Netlify: *Deploy manually* → drop `flood-system`.
- **nginx**: `server { root /var/www/flood-system; }` (add `try_files $uri $uri/ =404;`).
- **With a backend**: deploy the FastAPI/Node service (render.com, Railway, EC2) + MQTT broker, deploy this static folder to a CDN, and enable HTTPS (required for secure FCM push / geolocation).

---

## 🏆 SIH innovation checklist — where it lives in the code

| # | Feature | Location |
|---|---|---|
| 1 | Multi-sensor environmental monitoring | `js/mockApi.js` → `SENSOR_DEFS` (7 parameters) |
| 2 | AI flood-risk prediction | `js/aiModel.js` → `predictFloodRisk()` (replaceable) |
| 3 | Real-time sensor dashboard | `index.html` + `js/ui.js` refresh loop |
| 4 | Early-warning alerts | `js/alerts.js` → `AlertManager.evaluate()` |
| 5 | Location-based risk visualization | `index.html` map (Leaflet) + villages/zones data |
| 6 | Historical trend analysis | `history.html` + `PAGE.data.buildHistory()` |
| 7 | AI-generated explanations | `AIModel.explain()` — plain language for officials |
| 8 | Emergency response coordination | Shelters / hospitals / SDRF-NDRF / evacuation |
| 9 | Sensor health monitoring | `sensors.html` — battery, calibration, online/offline |
| 10 | Simulation mode | `js/simulation.js` — sliders + 4 scenarios |

Built for **Smart India Hackathon** by team AI FloodGuard. All sensor, village and event data inside is simulated for demonstration. 🌊
