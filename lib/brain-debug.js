"use strict";

/**
 * lib/brain-debug.js — Build-110 Part-2 diagnostic (TEMPORARY — remove after).
 *
 * The Vercel runtime-log tool collapses to ~1 line per request, so console.log
 * is blind to us. To find out WHY the reflector / reasoning-chain / entity store
 * never write rows, we record their decision path to a table we CAN query
 * (m8_brain_debug). Awaited best-effort insert; never throws; cheap; no LLM.
 *
 * Each writer is on the AWAITED request path (reflect(), runChain()), so these
 * inserts land before the lambda freezes — unlike the brain writes we're debugging.
 */

const { createClient } = require("@supabase/supabase-js");

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * debugBrain(feature, sessionId, event, detail) — record one decision-path row.
 * feature: 'reflector' | 'chain' | 'entity'. event: short tag. detail: free text.
 */
async function debugBrain(feature, sessionId, event, detail) {
  try {
    const db = getDb();
    if (!db) return;
    await db.from("m8_brain_debug").insert({
      feature:    feature || null,
      session_id: sessionId || null,
      event:      event || null,
      detail:     detail == null ? null : String(detail).slice(0, 500),
    });
  } catch (_) { /* diagnostic only — never disturb the turn */ }
}

module.exports = { debugBrain };
