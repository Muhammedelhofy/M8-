// M8 Money view — GET a privacy-safe, code-computed summary of the Family
// Wallet (Hofy Home household). See lib/wallet.js for the HARD PRIVACY WALL:
// no transaction free-text is read, returned, logged, or sent to any LLM.
//
// NOTE ON AUTH: like the rest of the M8 app (/api/tasks, /api/chat) this
// endpoint is currently unauthenticated. The payload is financial totals only
// (no line-item text), but decide whether to gate it before shipping to prod.
const wallet = require("../lib/wallet");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }
  try {
    const summary = await wallet.getSummary();
    // Don't let intermediaries cache a private financial payload.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(summary);
  } catch (e) {
    // PRIVACY: log the message only (it never contains row data by construction).
    console.error("[wallet] " + (e && e.message));
    if (e && e.code === "WALLET_UNCONFIGURED") {
      return res.status(503).json({ error: "wallet not configured" });
    }
    return res.status(502).json({ error: "wallet unavailable" });
  }
};

module.exports.config = { maxDuration: 15 };
