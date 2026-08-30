# =========================================================================
# REFERENCE ML SERVICE — FastAPI flood-risk predictor
# backend-example/ml_model.py
# ------------------------------------------------------------------------
# Drop-in replacement for the DEMO AI LOGIC in js/aiModel.js.
# Train a Random Forest / XGBoost / LSTM on historical telemetry and serve
# it here with the SAME JSON contract the dashboard already consumes:
#
#   POST /predict  { sensors: { "RAIN-01": {value, history}, ... } }
#   -> { score, level, confidence, probability, etaMinutes,
#        factors, explanation, model, generatedAt }
#
# Run:  pip install fastapi uvicorn joblib   &&   uvicorn ml_model:app --port 8000
# =========================================================================

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="AI FloodGuard ML Service")

# Load your trained model (Random Forest example):
# model = joblib.load("models/rf_flood.pkl")
# scaler = joblib.load("models/scaler.pkl")

LEVELS = [(30, "LOW"), (60, "MODERATE"), (80, "HIGH"), (101, "CRITICAL")]

def level_of(score: int) -> str:
    for thr, lvl in LEVELS:
        if score < thr:
            return lvl
    return "CRITICAL"


class SensorPacket(BaseModel):
    sensors: dict


@app.post("/predict")
def predict(pkt: SensorPacket):
    s = pkt.sensors
    g = lambda i: (s.get(i) or {}).get("value")

    # ---- Feature engineering from raw telemetry ----
    rain, level, soil, flow, hum = g("RAIN-01"), g("RIV-01"), g("SOIL-01"), g("FLOW-01"), g("HUM-01")

    # ---- Replace with: X = scaler.transform([[rain, level, soil, flow, hum]])
    #                     proba = model.predict_proba(X)[0][1]   # P(flood in 6h)
    #                     score = int(round(proba * 100))
    # Demo heuristic (mirror of the front-end weighted model):
    score = int(round(min(0.97, 0.32 * min(rain / 118, 1) + 0.30 * max(0, (level - 1.2) / 5.6)
                          + 0.18 * max(0, (soil - 35) / 60) + 0.12 * max(0, (flow - 0.8) / 7.2)) * 100))

    return {
        "score": score,
        "level": level_of(score),
        "confidence": 92,
        "probability": min(97, round(score * 0.93 + 4)),
        "etaMinutes": 720 if score <= 30 else (120 if score <= 60 else 40),
        "factors": {},
        "explanation": "Trained ML model explanation (production).",
        "model": "rf-v1",
        "generatedAt": int(__import__("time").time() * 1000),
    }
