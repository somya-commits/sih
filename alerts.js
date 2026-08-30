/* =========================================================================
   EARLY WARNING & ALERT ENGINE  (js/alerts.js)
   ------------------------------------------------------------------------
   • Threshold-crossing detection (LOW→HIGH/CRITICAL) raises alerts
   • Simulated notification channels — SMS / Push / Email / Authority
   ── PRODUCTION PATH ─────────────────────────────────────────────────────
   Replace each simulated send*() with a real API call, e.g.:
     SMS      → SMS provider REST API (Msg91 / Twilio) to registered mobiles
     Push     → FCM (Firebase Cloud Messaging) / OneSignal web push
     Email    → backend mailer (NodeMailer / SES) to subscribed officials
     Authority→ DMA control-room webhook / CAP (Common Alerting Protocol)
   AlertManager.evaluate() itself stays unchanged — it just calls the
   channel senders, which are isolated for easy swapping.
   ========================================================================= */

"use strict";

const AlertManager = {
  _prevLevel: null,
  _activeAlert: null,

  /* Called every prediction cycle (ui.js). Detects level crossings. */
  evaluate(pred) {
    const lvl = pred.level;
    const crossedHigh = (lvl === "HIGH" || lvl === "CRITICAL") && this._prevLevel !== "HIGH" && this._prevLevel !== "CRITICAL";
    const cleared = this._activeAlert && (lvl === "LOW" || lvl === "MODERATE");

    if (crossedHigh) {
      this._raise(pred);
    } else if (cleared) {
      this._resolve(pred);
    }
    this._prevLevel = lvl;
  },

  _raise(pred) {
    const t = new Date();
    const alert = {
      id: "AL-" + (105 + SensorHub.alertHistory.length),
      level: pred.level,
      title: pred.level === "CRITICAL"
        ? "CRITICAL FLASH FLOOD WARNING"
        : "FLASH FLOOD WARNING",
      loc: this._hotspotSector(),
      reason: pred.explanation.split(". ")[0] + ".",
      time: t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      status: "ACTIVE",
      channels: ["sms", "push", "email", "authority"]
    };

    SensorHub.alerts.unshift(alert);
    SensorHub.alertHistory.unshift(alert);
    SensorHub.counts.warnings += 1;
    if (pred.level === "CRITICAL") SensorHub.counts.criticals += 1;
    this._activeAlert = alert;

    /* Simulate broadcast over every channel (with confirmation toasts) */
    this._broadcast(alert, pred);
  },

  _resolve(pred) {
    if (this._activeAlert) {
      this._activeAlert.status = "RESOLVED";
      this._activeAlert.resolvedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      App.toast("success", "Alert Cleared", `Conditions eased — ${pred.level} risk. ${this._activeAlert.loc} is returning to normal.`);
      this._activeAlert = null;
    }
  },

  /* Highest-risk populated area (demo: from the villages dataset) */
  _hotspotSector() {
    const hot = VILLAGES.filter(v => v.risk === "HIGH" || v.risk === "CRITICAL");
    const v = hot.length ? hot[0] : VILLAGES[0];
    return `${v.name} · Alaknanda Basin`;
  },

  /* ---- Simulated channel senders (replace with real APIs) ---- */
  _broadcast(alert, pred) {
    const msg = `${alert.title} | ${alert.loc} | Risk ${pred.score}% (${pred.level}) | ${pred.etaMinutes} min to impact. Evacuate to nearest shelter.`;
    this.send("sms", msg, alert);
    this.send("push", msg, alert, 600);
    this.send("email", `Subject: ${alert.title} — ${alert.loc}\n\n${pred.explanation}\n\nRecommended action: ${Actions.recommendFor(pred.level)}\n\n— AI FloodGuard System`, alert, 1200);
    this.send("authority", `DMA Control Room notified: ${alert.loc} escalated to ${pred.level}. SDRF teams mobilised for ${pred.etaMinutes} min ETA.`, alert, 400);
  },

  /**
   * send(channel, message, alert, delay)
   * Simulates delivery; increments the channel counter used by Admin charts.
   */
  async send(channel, message, alert, delay = 500) {
    await new Promise(r => setTimeout(r, delay));
    SensorHub.channels[channel] = (SensorHub.channels[channel] || 0) + 1;
    const meta = {
      sms:  ["📱", "SMS Alerts Sent", "Broadcast to registered residents in the affected sector."],
      push: ["🔔", "Push Notifications Sent", "Delivered to mobile app users in the warning zone."],
      email:["📧", "Emails Sent", "Sent to subscribed officials, schools and media."],
      authority: ["🏛️", "Authority Notified", "DMA / SDRF control room has acknowledged the alert."]
    }[channel] || ["📡", "Alert Sent", ""];
    App.toast(channel, meta[1], `${meta[2]} (${alert ? alert.loc : ""})`);
    return { channel, ok: true, deliveredAt: Date.now() };
  },

  /* ---- Manual re-send from the "Send Alert" modal ---- */
  async sendManual(channels, alert) {
    for (const c of channels) await this.send(c, `Re-alert: ${alert.title} — ${alert.loc}`, alert, 400);
  }
};

/* Emergency guidance shared by alerts, modal and evacuation flow */
const Actions = {
  recommendFor(level) {
    if (level === "CRITICAL")
      return "Immediate evacuation to the nearest shelter. Do NOT cross bridges or ford streams. Follow SDRF / police instructions. Move livestock to high ground. Carry emergency kit (water, food, torch, documents).";
    if (level === "HIGH")
      return "Remain alert. Move to higher ground, avoid riverbanks and landslide-prone slopes. Keep emergency kit ready and monitor official alerts.";
    return "No action needed yet. Continue monitoring official updates.";
  },
  instructions: [
    "Move to the highest floor or nearest shelter immediately.",
    "Never walk, drive or wade through floodwater.",
    "Disconnect electrical appliances and turn off gas cylinders.",
    "Carry torch, first-aid kit, drinking water and important documents.",
    "Follow SDRF, NDRF and local administration instructions only.",
    "Call 112 (National Emergency) or 1078 (Disaster Helpline) if trapped."
  ],
  evacuate() {
    SensorHub.channels.evac = (SensorHub.channels.evac || 0) + 1;
    App.toast("success", "Evacuation Initiated", "Evacuation order broadcast — shelters opened, teams deployed. (Demo simulation)");
  }
};
