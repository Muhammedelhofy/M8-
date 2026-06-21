/**
 * M8 L5 — Odysseus attestation sink   ·   POST /api/loop-attest
 * Written by tests/odysseus/run-battery.ps1 -AttestTo after a live battery run. The
 * runner computes pass/fail vs the FROZEN baseline-L5.json (regression = a probe
 * true in baseline, false now) and POSTs the verdict here; lib/loop.js records it to
 * m8_odysseus_runs and recomputes the promotion gate for the target run date.
 *
 * The L5 regression set = battery-l5.json (autonomy family) + battery-m3-armed.json
 * (generation/novelty/survivor/scaffold lanes). Deterministic regex graders only —
 * NO LLM judge anywhere in the gate.
 *
 * Auth: CRON_SECRET bearer (the only writer is the operator's local harness).
 *
 * Body: { run_date, pass, regressions:[{probeId,baseline,now}], total, passed,
 *         failed, baseline_ref, metadata }
 */
const { recordAttestation } = require("../loop");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    const result = await recordAttestation({
      run_date:     body.run_date,
      pass:         !!body.pass,
      regressions:  Array.isArray(body.regressions) ? body.regressions : [],
      total:        body.total | 0,
      passed:       body.passed | 0,
      failed:       body.failed | 0,
      baseline_ref: body.baseline_ref || null,
      metadata:     body.metadata || {},
    });
    res.status(result.ok ? 200 : 500).json({ ok: result.ok, id: result.id || null, error: result.error || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
