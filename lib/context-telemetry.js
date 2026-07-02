/**
 * Build-168 — lib/context-telemetry.js
 *
 * E2 "context diet" — STEP 1: MEASURE. Changes NOTHING about routing or answers.
 *
 * WHY (STRATEGY_2026H2.md, E2): Muhammad's #1 daily pain is mid-chat drift —
 * M8 forgetting the thread and hallucinating. The systemInstruction packet is
 * assembled from ~45 conditional blocks (orchestrator.js compose sections) and
 * nobody has ever measured what actually reaches the model per turn. This module
 * classifies the final packet into labelled sections by their known headers and
 * records sizes-only telemetry, so the diet (step 2) cuts from evidence, not vibes.
 *
 * PRIVACY CONTRACT: only section LABELS and CHARACTER COUNTS are stored or
 * logged — never packet content, never message text. No redaction needed
 * because no content ever leaves this module.
 *
 * SAFETY CONTRACT (side-channel, never a gate — same doctrine as miss-logger):
 *   - recordPacket NEVER throws and NEVER blocks the reply path on failure.
 *   - DB insert timeout is 1500ms (tighter than miss-logger's 5s: this runs
 *     every turn). The insert IS awaited — un-awaited Vercel writes are dropped.
 *   - Kill switch: M8_CTX_TELEMETRY=off (or "0"). Default ON (log-only).
 *
 * Classification is approximate by design: a block whose header we don't know
 * yet is counted inside the preceding known section. Add a marker when a big
 * unknown shows up in the numbers.
 */

const TABLE = "m8_router_misses"; // reuse the miss-review table; lane "ctx:packet"

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY ||
                process.env.SUPABASE_KEY || "").trim();

// ── SECTION MARKERS ───────────────────────────────────────────────────────────
// [label, headerPrefix]. A section starts where "\n\n" + headerPrefix occurs
// (or at offset 0 for the packet head). Prefixes are the literal header strings
// the orchestrator injects — see compose sections (orchestrator.js ~4727+, ~5834+).
const MARKERS = [
  ["SYS",      "CURRENT DATE:"],                 // date anchor + M8_SYSTEM_PROMPT
  ["MEM",      "RELEVANT MEMORY"],               // pastMemory recall block
  ["HH",       "HOUSEHOLD ("],                   // Build-137 household roster
  ["CONFLICT", "NOTE — possible conflicting"],   // Build-147 contradiction note
  ["EVID",     "GROUNDED EVIDENCE"],             // Build-84 merged KG+entity
  ["KG",       "KNOWLEDGE GRAPH"],               // Build-82 raw KG injection
  ["ENT",      "KNOWN ENTITIES"],                // entity roster
  ["BRIDGE",   "ENTITY <-> GRAPH LINKS"],        // entity↔graph bridge
  ["TOPICS",   "RECURRING TOPICS"],              // Build-86 longitudinal
  ["CARD",     "ENTITY CARD"],                   // Build-85b entity card
  ["WEB",      "WEB SEARCH RESULTS"],            // live search snippets
  ["FLEET",    "FLEET "],                        // all fleet packets (DATA/ROLLUP/ALERT/…)
  ["COMPANY",  "COMPANY "],                      // company context/roster
  ["EOSB",     "EOSB "],                         // EOSB calculation packet
  ["RESEARCH", "RESEARCH "],                     // research directives/catalog
];

// ── PURE: classify the packet ─────────────────────────────────────────────────
/**
 * analyzePacket(systemInstruction, history) → {
 *   total, historyTurns, historyChars,
 *   sections: [{ label, chars }]  (sorted largest-first, labels merged),
 *   head: chars before the first recognized marker (0 when SYS leads, as normal)
 * }
 * Pure string work — PS-mirror-testable, no IO, never throws on sane input.
 */
function analyzePacket(systemInstruction, history) {
  const s = typeof systemInstruction === "string" ? systemInstruction : "";
  const hits = [];
  for (const [label, prefix] of MARKERS) {
    if (s.startsWith(prefix)) hits.push({ label, start: 0 });
    const needle = "\n\n" + prefix;
    let from = 0, idx;
    while ((idx = s.indexOf(needle, from)) !== -1) {
      hits.push({ label, start: idx });
      from = idx + needle.length;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  // de-dupe identical starts (SYS matches both startsWith and would re-match)
  const uniq = hits.filter((h, i) => i === 0 || h.start !== hits[i - 1].start);

  const byLabel = {};
  for (let i = 0; i < uniq.length; i++) {
    const end = i + 1 < uniq.length ? uniq[i + 1].start : s.length;
    byLabel[uniq[i].label] = (byLabel[uniq[i].label] || 0) + (end - uniq[i].start);
  }
  const head = uniq.length > 0 ? uniq[0].start : s.length;

  const h = Array.isArray(history) ? history : [];
  let historyChars = 0;
  for (const m of h) {
    if (m && typeof m.content === "string") historyChars += m.content.length;
  }

  const sections = Object.keys(byLabel)
    .map((label) => ({ label, chars: byLabel[label] }))
    .sort((a, b) => b.chars - a.chars);

  return { total: s.length, historyTurns: h.length, historyChars, sections, head };
}

/** Compact one-line form for the DB row (sizes only, ≤280 chars). */
function formatCompact(analysis, lane) {
  const a = analysis || {};
  const parts = [
    `L:${lane || "?"}`,
    `TOT:${a.total || 0}`,
    `H:${a.historyTurns || 0}t/${a.historyChars || 0}c`,
  ];
  if (a.head > 0) parts.push(`HEAD:${a.head}`);
  for (const sec of a.sections || []) parts.push(`${sec.label}:${sec.chars}`);
  return parts.join(" ").slice(0, 280);
}

// ── IO ────────────────────────────────────────────────────────────────────────
async function _sbPost(row) {
  if (!SB_URL || !SB_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500); // every turn → tight cap
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function telemetryEnabled() {
  const v = String(process.env.M8_CTX_TELEMETRY || "").trim().toLowerCase();
  return v !== "off" && v !== "0";
}

/**
 * recordPacket({ systemInstruction, history, lane, db }) — measure + log + store.
 * NEVER throws. Await it (bounded ≤1.5s); on any failure the reply is unaffected.
 */
async function recordPacket({ systemInstruction, history, lane, db } = {}) {
  try {
    if (!telemetryEnabled()) return { ok: false, skipped: true };
    const analysis = analyzePacket(systemInstruction, history);
    // Full detail → Vercel runtime logs (short retention, rich shape)
    console.log("[M8] ctx:telemetry", JSON.stringify({ lane, ...analysis }));
    // Compact sizes-only row → Supabase (long retention, queryable with the misses)
    const row = {
      message_redacted: formatCompact(analysis, lane), // labels+counts only, no content
      lane:   "ctx:packet",
      reason: `lane=${String(lane || "?").slice(0, 24)} total=${analysis.total}`.slice(0, 120),
    };
    const poster = (db && typeof db.sbPost === "function") ? db.sbPost : _sbPost;
    await poster(row);
    return { ok: true, analysis };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

module.exports = { analyzePacket, formatCompact, recordPacket, MARKERS, TABLE };
