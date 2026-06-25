/**
 * Build-150 — lib/miss-logger.js
 *
 * Logs messages that fell through to the Phase-0 capability-decline safety net
 * so Muhammad can review unhandled phrasings and teach M8 new routes.
 *
 * PRIVACY CONTRACT:
 *   - Digits, currency codes/symbols, and Arabic/Latin money nouns are stripped
 *     before anything touches the DB. A money-lane miss never contains a balance
 *     or amount after redaction.
 *   - The raw message is never stored. Only message_redacted reaches Supabase.
 *   - The table (m8_router_misses) holds NO PII beyond the stripped phrasing.
 *
 * SAFETY CONTRACT (side-channel, never a gate):
 *   - logMiss NEVER throws and NEVER blocks the reply. Callers fire-and-forget.
 *   - All reads fail SAFE — empty list / placeholder text on any error.
 *   - The seam { sbPost, sbFetch } is injectable for tests (same pattern as nudge-logger).
 */

const TABLE  = "m8_router_misses";
const MAX_LEN = 280; // enough to diagnose a phrasing, not a novel

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY ||
                process.env.SUPABASE_KEY || "").trim();

// ── REDACTION ─────────────────────────────────────────────────────────────────
// Strip sequences of digits (amounts), currency codes, and money domain words.
// Order matters: digits first so "50 sar" → "[#] [CUR]" not "[#] sar".
const _DIGIT_RE      = /\d+(?:[.,]\d+)*/g;
const _CURRENCY_RE   = /\b(?:sar|rial|riyal|sr|egp|usd|dollar|pound|ريال|جنيه|دولار)\b/gi;
const _MONEY_NOUN_RE = /\b(?:expenses?|wallet|balance|transactions?|spend(?:ing)?|spent|paid|salary|salary|راتب|مصروف|مصاريف|محفظة|رصيد|معاملة|معاملات)\b/gi;

function redact(raw) {
  let s = String(raw || "").trim().slice(0, 600);
  s = s.replace(_DIGIT_RE,      "[#]");
  s = s.replace(_CURRENCY_RE,   "[CUR]");
  s = s.replace(_MONEY_NOUN_RE, "[MONEY]");
  return s.slice(0, MAX_LEN);
}

// ── SUPABASE IO (default, env-based) ─────────────────────────────────────────
async function _sbPost(row) {
  if (!SB_URL || !SB_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
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

async function _sbFetch(path, opts = {}) {
  if (!SB_URL || !SB_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        ...(opts.headers || {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Log a router miss — fire-and-forget insert into m8_router_misses.
 * NEVER throws; callers should NOT await (or may await; both safe).
 *
 * @param {string}      message  raw user message (will be redacted before storage)
 * @param {string}      lane     "money" | "task" | "note" | "unknown"
 * @param {string}      reason   label for WHY it missed, e.g. "phase0_safety_net"
 * @param {object|null} db       optional { sbPost } test seam
 */
async function logMiss(message, lane, reason, db) {
  try {
    const redacted = redact(message);
    if (!redacted) return { ok: false, skipped: true, reason: "empty_after_redact" };
    const row = {
      message_redacted: redacted,
      lane:             String(lane   || "unknown").slice(0, 40),
      reason:           String(reason || "").slice(0, 120),
    };
    const poster = (db && typeof db.sbPost === "function") ? db.sbPost : _sbPost;
    await poster(row);
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

/**
 * Build-152 — log a wallet⇄fleet ARBITER route decision for later review.
 * Same privacy contract as logMiss (digits/currency/money-nouns stripped). Stored
 * as lane="arbiter:<domain>", reason="<why> conf=<c>". Fire-and-forget; NEVER throws.
 *
 * @param {string} message     raw user message (redacted before storage)
 * @param {string} domain      "wallet" | "fleet" | "ask"
 * @param {string} why         the arbiter's reason code (e.g. "llm", "wallet_strong")
 * @param {number} confidence  0..1
 * @param {object|null} db     optional { sbPost } test seam
 */
async function logRoute(message, domain, why, confidence, db) {
  try {
    const redacted = redact(message);
    if (!redacted) return { ok: false, skipped: true, reason: "empty_after_redact" };
    const c = Number(confidence);
    const row = {
      message_redacted: redacted,
      lane:   ("arbiter:" + String(domain || "?")).slice(0, 40),
      reason: (String(why || "") + (Number.isFinite(c) ? ` conf=${c.toFixed(2)}` : "")).slice(0, 120),
    };
    const poster = (db && typeof db.sbPost === "function") ? db.sbPost : _sbPost;
    await poster(row);
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

// ── DETECTION — "show my recent misses" read command ─────────────────────────
// Catches: "show my recent misses", "what did M8 not understand",
// "what did you miss", "show router misses", "unhandled messages".
const MISS_READ_RE = /\b(?:show(?:\s+me)?\s+(?:(?:my|recent|last)\s+)?(?:misses?\b|router\s+misses?\b|unhandled\s+messages?\b)|what\s+(?:did\s+)?(?:m8|you)\s+(?:not\s+understand\b|miss(?:ed)?\b|fail(?:ed)?\s+(?:on|at|to\s+handle)\b|couldn.t\s+handle\b)|(?:recent|last)\s+(?:\d+\s+)?misses?\b|router\s+misses?\b|unhandled\s+(?:messages?\b|turns?\b)|what\s+(?:m8|you)\s+(?:can.t|couldn.t)\s+handle\b)\b/i;

function detectMissRead(message) {
  const s = String(message || "").trim();
  if (s.length < 5) return false;
  return MISS_READ_RE.test(s);
}

/**
 * Fetch the most-recent N miss rows, newest first. Returns [] on any error.
 * @param {number}      limit  max rows (1-50, default 10)
 * @param {object|null} db     optional { sbFetch } test seam
 */
async function fetchRecentMisses(limit, db) {
  const n = Math.min(Math.max(1, Math.floor(Number(limit) || 10)), 50);
  try {
    const cols = "id,created_at,message_redacted,lane,reason";
    const path = `${TABLE}?select=${cols}&order=created_at.desc&limit=${n}`;
    const fetcher = (db && typeof db.sbFetch === "function") ? db.sbFetch : _sbFetch;
    const rows = await fetcher(path, { method: "GET" });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/**
 * Format miss rows into a human-readable packet (pure — PS-mirror-testable).
 */
function buildMissPacket(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return "No router misses on record yet — M8 hasn't hit the Phase-0 safety net since logging started (Build-150).";
  }
  const lines = list.map((r, i) => {
    const ts = r.created_at
      ? new Date(r.created_at).toLocaleString("en-GB", {
          timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short",
        })
      : "?";
    const lane   = r.lane   || "?";
    const reason = r.reason ? ` | ${r.reason}` : "";
    const msg    = r.message_redacted || "";
    return `${i + 1}. [${ts}] lane=${lane}${reason}\n   "${msg}"`;
  });
  return [
    `**Router Misses — last ${list.length}**`,
    `These messages hit the Phase-0 safety net (every parser returned null). Each is a phrasing M8 could learn to handle:\n`,
    lines.join("\n\n"),
  ].join("\n");
}

module.exports = {
  logMiss,
  logRoute,
  detectMissRead,
  fetchRecentMisses,
  buildMissPacket,
  // exported for tests:
  redact,
  TABLE,
  MAX_LEN,
};
