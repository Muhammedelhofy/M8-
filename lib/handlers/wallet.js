"use strict";
/**
 * GET /api/wallet  (routed via /api/ops?fn=wallet — Hobby 12-function consolidation)
 *
 * M8 Money view — a privacy-safe, code-computed summary of the Family Wallet
 * (Hofy Home household). See lib/wallet.js for the HARD PRIVACY WALL: no
 * transaction free-text is read, returned, logged, or sent to any LLM.
 *
 * GATE — money must NOT be world-readable. Requires a pre-shared key: the owner
 * sets M8_WALLET_KEY in Vercel and enters the same value once in the app (stored
 * in localStorage, sent as the `x-m8-key` header). FAIL CLOSED: if M8_WALLET_KEY
 * isn't configured, the endpoint denies (503 "wallet locked") — financials are
 * never exposed by default.
 */
const crypto = require("crypto");
const wallet = require("../wallet");

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch (_) { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }
  // ── GATE ──────────────────────────────────────────────────────────────────
  const expected = process.env.M8_WALLET_KEY || "";
  if (!expected) return res.status(503).json({ error: "wallet locked" });
  const given = req.headers["x-m8-key"] || (req.query && req.query.k) || "";
  if (!safeEqual(given, expected)) return res.status(401).json({ error: "unauthorized" });

  try {
    const summary = await wallet.getSummary();
    res.setHeader("Cache-Control", "no-store"); // never cache a private financial payload
    return res.status(200).json(summary);
  } catch (e) {
    // PRIVACY: log the message only (never contains row data by construction).
    console.error("[wallet] " + (e && e.message));
    if (e && e.code === "WALLET_UNCONFIGURED") {
      return res.status(503).json({ error: "wallet not configured" });
    }
    return res.status(502).json({ error: "wallet unavailable" });
  }
};
