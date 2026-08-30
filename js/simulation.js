/* =========================================================================
   SIMULATION MODE  (js/simulation.js)
   ------------------------------------------------------------------------
   Lets judges/presenters drive the demo without physical sensors:

     • 5 sliders → write straight into SensorHub (same path real MQTT data
       would take: SensorHub.setValue()).
     • 4 presets  → SIM_PRESETS (js/mockApi.js) — Normal / Heavy Rain /
       Flood Warning / Critical Flood.
     • Auto-sim  → small random drift every few seconds so the live graphs
       always move.

   Everything downstream (AIModel, charts, map, alerts) reacts identically
   to slider input and to a real ESP32 feed — only the data source differs.
   ========================================================================= */

"use strict";

const SIM_SLIDERS = [
  { id: "sim-rain", sensor: "RAIN-01", min: 0,  max: 150, step: 1,  unit: "mm/hr" },
  { id: "sim-water", sensor: "RIV-01", min: 0.5, max: 7,   step: 0.1, unit: "m" },
  { id: "sim-soil", sensor: "SOIL-01", min: 15, max: 100, step: 1,  unit: "%" },
  { id: "sim-flow", sensor: "FLOW-01", min: 0.5, max: 9,   step: 0.1, unit: "m/s" },
  { id: "sim-hum",  sensor: "HUM-01",  min: 20, max: 100, step: 1,  unit: "%" }
];

function initSimulation() {
  const wrap = document.getElementById("simPanel");
  if (!wrap) return;

  /* --- Build slider UI --- */
  const grid = wrap.querySelector(".sim-grid");
  grid.innerHTML = SIM_SLIDERS.map(s => {
    const cur = SensorHub.sensors[s.sensor].value;
    return `
    <div class="sim-row">
      <div class="sim-lbl"><span>${SensorHub.sensors[s.sensor].name} (${s.unit})</span><span class="sim-val" id="simval-${s.sensor}">${cur}</span></div>
      <input type="range" id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}"
             value="${cur}" aria-label="${SensorHub.sensors[s.sensor].name}" data-fill="0">
    </div>`;
  }).join("");

  /* sync slider gradient fill */
  const paint = (el) => {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty("--fill", p + "%");
    const lbl = document.getElementById("simval-" + SIM_SLIDERS.find(s => s.id === el.id).sensor);
    if (lbl) lbl.textContent = el.value;
  };
  grid.querySelectorAll("input[type=range]").forEach(paint);

  /* --- Live input → sensor → prediction cycle --- */
  grid.addEventListener("input", (e) => {
    if (!e.target.matches("input[type=range]")) return;
    const s = SIM_SLIDERS.find(x => x.id === e.target.id);
    if (!s) return;
    SensorHub.setValue(s.sensor, parseFloat(e.target.value));
    paint(e.target);
    App.cycle();                       // same path as a real telemetry packet
  });

  /* --- Preset buttons --- */
  wrap.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      const p = SIM_PRESETS[key];
      if (!p) return;
      SensorHub.applyPreset(key);
      App.toast("info", `Preset: ${p.label}`, p.desc);
      syncSliders();
      App.cycle();
    });
  });

  /* --- Auto simulation drift --- */
  const auto = document.getElementById("autoSim");
  auto.addEventListener("change", () => {
    App.autoSim = auto.checked;
    App.toast("info", App.autoSim ? "Auto-simulation ON" : "Auto-simulation OFF",
      App.autoSim ? "Sensors drifting automatically — live graphs will keep moving." : "Sensor values are now manual.");
  });
  setInterval(() => {
    if (App.autoSim) { SensorHub.autoTick(); syncSliders(); App.cycle(); }
  }, 2600);

  /* --- Reset --- */
  const resetBtn = document.getElementById("simReset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    SensorHub.applyPreset("normal");
    syncSliders(); App.cycle();
    App.toast("success", "Simulation Reset", "All sensors restored to normal baseline.");
  });

  function syncSliders() {
    SIM_SLIDERS.forEach(s => {
      const el = document.getElementById(s.id);
      if (!el) return;
      el.value = SensorHub.sensors[s.sensor].value;
      paint(el);
    });
  }

  /* URL shortcut: index.html?preset=critical — handy for demo links & screenshots */
  const urlP = new URLSearchParams(location.search).get("preset");
  if (urlP && SIM_PRESETS[urlP]) {
    SensorHub.applyPreset(urlP);
    setTimeout(() => { syncSliders(); App.cycle(); }, 300);
  }
}
window.initSimulation = initSimulation;
