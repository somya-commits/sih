/* =========================================================================
   AI FLOOD-RISK PREDICTION SERVICE  (js/aiModel.js)
   ------------------------------------------------------------------------
   A clean, replaceable prediction interface:

     AIModel.predictFloodRisk(sensorData)  ->  {
        score, level, confidence, probability, etaMinutes, factors, explanation
     }

   ▼▼▼  DEMO AI LOGIC — WEIGHTED RISK SCORING  ▼▼▼
   The implementation below is a transparent, explainable weighted model
   (rainfall, water level, soil moisture, flow, humidity, pressure) intended
   ONLY for the SIH prototype. It is clearly separated behind this interface so
   a trained ML model can drop in without touching the UI:

   ── REPLACE WITH A TRAINED MODEL ──────────────────────────────────────────
   1. Random Forest / XGBoost classifier  — features: 60-min rainfall sum,
      Δwater level, soil moisture, flow velocity, humidity, pressure trend.
      Output: P(flood within 6h) → rescale to the 0–100 risk score.
   2. LSTM / time-series model — ingest the last N telemetry windows
      (e.g. 24 × 5-min samples as a tensor) and forecast water level +
      flood probability for the next 1–3 h.
   3. Serving: expose POST /api/predict on the backend (FastAPI/Flask),
      log inputs/outputs for a feedback loop, and call it here:

        const res = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sensors: sensorData })
        });
        return res.json();

   The UI only ever consumes the returned object shape — swap the body of
   predictFloodRisk() and everything downstream keeps working.
   ========================================================================= */

"use strict";

const RiskLevels = {
  thresholds: [30, 60, 80],
  label(score) {
    if (score <= 30) return "LOW";
    if (score <= 60) return "MODERATE";
    if (score <= 80) return "HIGH";
    return "CRITICAL";
  }
};

const AIModel = {
  version: "v0.1-demo-weighted",

  /* Feature weights — tune these to match historical flood events */
  weights: { rain: 0.32, water: 0.30, soil: 0.18, flow: 0.12, humidity: 0.05, pressure: 0.03 },

  /**
   * predictFloodRisk(sensorData)
   * sensorData: { RAIN-01: {value, history:[...]}, ... } (from SensorHub)
   * Returns a full prediction object used by every page.
   */
  predictFloodRisk(sensorData) {
    const d = sensorData || SensorHub.sensors;
    const g = id => (d[id] && d[id].value != null) ? d[id].value : null;

    const rain = g("RAIN-01"), level = g("RIV-01"), soil = g("SOIL-01"),
          flow = g("FLOW-01"), hum = g("HUM-01"), press = g("PRE-01");

    /* ---- 1. Normalise each feature to a 0..1 hazard contribution ---- */
    const sub = {
      rain:     rain === null ? 0 : clamp((rain - 2) / 118, 0, 1),          // 2–120 mm/hr
      water:    level === null ? 0 : clamp((level - 1.2) / 5.6, 0, 1),      // danger mark ≈ 4.5 m
      soil:     soil === null ? 0 : clamp((soil - 35) / 60, 0, 1),          // 35–95 %
      flow:     flow === null ? 0 : clamp((flow - 0.8) / 7.2, 0, 1),        // 0.8–8 m/s
      humidity: hum  === null ? 0 : clamp((hum - 30) / 65, 0, 1),           // 30–95 %
      pressure: press === null ? 0 : clamp((1020 - press) / 70, 0, 1)       // falling pressure
    };

    /* ---- 2. Weighted combination (core DEMO score) ---- */
    let score = this.weights.rain * sub.rain + this.weights.water * sub.water +
                this.weights.soil * sub.soil + this.weights.flow * sub.flow +
                this.weights.humidity * sub.humidity + this.weights.pressure * sub.pressure;

    /* ---- 3. Dynamics boost: rapid rise in water level / rain adds urgency ---- */
    score += this._rateBoost(sensorData);

    score = clamp(score, 0, 0.97);
    const pct = Math.round(score * 100);
    const levelLabel = RiskLevels.label(pct);

    /* ---- 4. Confidence & derived metrics ---- */
    const confidence = Math.round(clamp(88 + sub.water * 9 - Math.random() * 3, 82, 97));
    const probability = Math.round(clamp(pct * 0.93 + 4, 2, 97));           // P(flood within 6 h)
    const etaMinutes = this._estimatedWarningTime(pct, level);

    /* ---- 5. Human-readable explanation for officials & public ---- */
    const explanation = this.explain(pct, levelLabel, sensorData);

    return {
      score: pct,
      level: levelLabel,
      confidence,
      probability,
      etaMinutes,
      subScores: { ...sub },
      factors: this._factors(sensorData),
      explanation,
      model: this.version,
      generatedAt: Date.now()
    };
  },

  /* ---- Dynamic urgency: level rising >0.25 m in last 20 min, or rain surge ---- */
  _rateBoost(d) {
    let boost = 0;
    const hist = id => (d[id] && d[id].history) || (SensorHub.sensors[id] && SensorHub.sensors[id].history) || [];
    const hWater = hist("RIV-01"), hRain = hist("RAIN-01");
    if (hWater.length > 3) {
      const rise = hWater[hWater.length - 1].v - hWater[hWater.length - 4].v;
      if (rise > 0.25) boost += 0.05;
      else if (rise > 0.6) boost += 0.08;
    }
    if (hRain.length > 3) {
      const surge = hRain[hRain.length - 1].v - hRain[hRain.length - 4].v;
      if (surge > 25) boost += 0.04;
    }
    return boost;
  },

  _estimatedWarningTime(pct, level) {
    if (pct > 80) return 10 + Math.round(Math.random() * 20);     // 10–30 min
    if (pct > 60) return 35 + Math.round(Math.random() * 40);     // 35–75 min
    if (pct > 30) return 120 + Math.round(Math.random() * 120);   // 2–4 h
    return 720;                                                   // > 12 h
  },

  /* Per-sensor 60-min deltas used both by the explanation and the UI chips */
  _factors(d) {
    const hist = id => (d[id] && d[id].history) || [];
    const delta = (id) => {
      const h = hist(id);
      if (h.length < 2) return { pct: 0, abs: 0, dir: "steady" };
      const a = h[0].v, b = h[h.length - 1].v;
      const abs = +(b - a).toFixed(2);
      const pct = a === 0 ? 0 : Math.round((abs / a) * 100);
      return { pct, abs, dir: abs > 0.5 ? "up" : abs < -0.5 ? "down" : "steady" };
    };
    return {
      rain:  delta("RAIN-01"), water: delta("RIV-01"), soil: delta("SOIL-01"),
      flow:  delta("FLOW-01"), hum:   delta("HUM-01")
    };
  },

  /* ---- Natural-language insight, kept simple for non-technical readers ---- */
  explain(pct, level, d) {
    const f = this._factors(d);
    const parts = [];
    if (f.rain.dir === "up")      parts.push(`Rainfall intensity has increased by ${f.rain.pct}% during the last hour.`);
    else if (f.rain.abs > 15)     parts.push(`Rainfall intensity is elevated at ${rounded(d,"RAIN-01")} mm/hr.`);
    else                          parts.push(`Rainfall is currently ${rounded(d,"RAIN-01")} mm/hr — ${f.rain.pct >= 0 ? "stable" : "easing"}.`);

    const lvl = rounded(d, "RIV-01");
    if (f.water.dir === "up")     parts.push(`River water level is rising rapidly (${f.water.abs > 0 ? "+" : ""}${f.water.abs} m) and now reads ${lvl} m.`);
    else if (lvl > 4)             parts.push(`River water level is ${lvl} m — above the danger mark of 4.5 m.`);
    else                          parts.push(`River water level is ${lvl} m, within the safe range.`);

    const soil = rounded(d, "SOIL-01");
    if (soil > 80)                parts.push(`Soil is saturated at ${soil}% — further rain will mostly run off into the river.`);
    else if (soil > 60)           parts.push(`Soil moisture is rising (${soil}%) reducing natural absorption.`);
    else                          parts.push(`Soil moisture is ${soil}% — slopes can still absorb water.`);

    if (pct > 60) parts.push(`Based on these combined indicators, the system has raised the flood risk to ${level}.`);
    else if (pct > 30) parts.push(`These indicators point to a rising flood risk (${level}).`);
    else parts.push(`All indicators are within normal bounds — flood risk is ${level}.`);

    return parts.join(" ");
  },

  label: RiskLevels.label
};

function rounded(d, id) { return d[id] && d[id].value != null ? d[id].value : "—"; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
