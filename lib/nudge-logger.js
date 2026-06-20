/**
 * M8 Track-A — lib/nudge-logger.js  (Build-96)
 *
 * The audit trail for driver NUDGES. lib/nudges.js drafts per-driver Arabic
 * messages (draft-only — Muhammad sends them on WhatsApp); until now those drafts
 * were fire-and-forget with no record. This module logs each one to m8_nudge_log
 * so M8 can answer "what did we send <driver>, and when?" and roll a weekly
 * "nudge activity" line into the morning brief.
 *
 * SAFETY CONTRACT (this is a side-channel, never a gate):
 *   - logNudge NEVER throws and NEVER blocks the drafted output. A bad payload is
 *     skipped (returns {skipped:true}); a Supabase hiccup is swallowed (returns
 *     {ok:false}). The drafts are returned to Muhammad regardless.
 *   - Reads (history / summary) fail SAFE: empty list / zeroed summary on any error.
 *
 * The first arg of every export is `db` — an optional injection seam
 * `{ sbFetch(path, opts) }` (used by tests / alternate callers). When omitted it
 * falls back to this module's own env-based Supabase REST fetch, matching the
 * pattern in lib/morning-brief.js and lib/notify.js (one source of truth: the same
 * SUPABASE_URL + SERVICE_KEY the rest of the spine reads).
 */

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
                process.env.SUPABASE_ANON_KEY || "").trim();

const TABLE = "m8_nudge_log";
const PREVIEW_MAX = 120;       // chars of the nudge text we keep as a preview
const DEFAULT_DAYS = 7;

// ── Supabase IO (fails SAFE — null on any error) ──────────────────────────────
async function sbFetch(path, opts = {}) {
  if (!SB_URL || !SB_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
        ...(opts.headers || {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Resolve the Supabase seam: an injected db.sbFetch wins, else the module default.
function resolveFetcher(db) {
  if (db && typeof db.sbFetch === "function") return db.sbFetch;
  return sbFetch;
}

// First PREVIEW_MAX chars of the nudge text (trimmed). null/empty -> "".
function toPreview(text) {
  const s = (text == null ? "" : String(text)).trim();
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) : s;
}

// A finite number or null (never NaN into numeric column).
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Number of days back to look, clamped to a sane window (default 7, cap 365).
function clampDays(days) {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, 365);
}

// ISO timestamp for "now minus N days" — the >= filter for history / summary.
function sinceDaysISO(days) {
  return new Date(Date.now() - clampDays(days) * 86400000).toISOString();
}

/**
 * Validate + normalize a nudge payload into a DB row.
 * driverName + toneBucket are REQUIRED (the two NOT-NULL columns); everything
 * else is optional and nulled when absent. Returns { ok, row } or { ok:false, reason }.
 */
function buildRow(payload) {
  const p = payload || {};
  const name = (p.driverName == null ? "" : String(p.driverName)).trim();
  const tone = (p.toneBucket == null ? "" : String(p.toneBucket)).trim();
  if (!name) return { ok: false, reason: "missing driverName" };
  if (!tone) return { ok: false, reason: "missing toneBucket" };
  const reason = (p.triggerReason == null ? "" : String(p.triggerReason)).trim();
  return {
    ok: true,
    row: {
      driver_name: name,
      tone_bucket: tone,
      message_preview: toPreview(p.messagePreview),
      trigger_reason: reason || null,
      driver_net_sar: toNum(p.driverNetSar),
    },
  };
}

/**
 * Log one drafted nudge — fire-and-forget insert into m8_nudge_log.
 * NEVER throws; a bad payload is skipped, a Supabase error is swallowed. Callers
 * may await (bounded by the 6s sbFetch timeout) or not; either way the drafted
 * messages are unaffected.
 * @param {object|null} db  optional { sbFetch } seam (else env-based default)
 * @param {object} payload  { driverName, toneBucket, messagePreview, triggerReason, driverNetSar }
 */
async function logNudge(db, payload) {
  try {
    const built = buildRow(payload);
    if (!built.ok) return { ok: false, skipped: true, reason: built.reason };
    const fetcher = resolveFetcher(db);
    const res = await fetcher(TABLE, { method: "POST", body: JSON.stringify(built.row) });
    return { ok: res != null, row: built.row };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

/**
 * Last N days of nudges for one driver, newest first. Returns [] on any error or
 * when driverName is blank (never throws). Rows carry the raw column names.
 */
async function getNudgeHistory(db, driverName, days = DEFAULT_DAYS) {
  const name = (driverName == null ? "" : String(driverName)).trim();
  if (!name) return [];
  try {
    const fetcher = resolveFetcher(db);
    const since = sinceDaysISO(days);
    const cols = "driver_name,tone_bucket,message_preview,trigger_reason,driver_net_sar,created_at";
    const path = `${TABLE}?driver_name=eq.${encodeURIComponent(name)}` +
      `&created_at=gte.${encodeURIComponent(since)}&select=${cols}&order=created_at.desc`;
    const rows = await fetcher(path, { method: "GET" });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Pure aggregation over nudge rows (the unit the test mirrors).
 *   totalSent     — total rows in window
 *   byTone        — { tone: count }
 *   driversNudged — distinct driver names, in first-seen order
 *   byDriver      — { name: { count, tones:[...] } }  (drives the brief line)
 * Defensive: tolerates missing/blank fields ("unknown" tone, blank name skipped).
 */
function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byTone = {};
  const byDriver = {};
  const driversNudged = [];
  for (const r of list) {
    const tone = (r && r.tone_bucket != null && String(r.tone_bucket).trim()) || "unknown";
    byTone[tone] = (byTone[tone] || 0) + 1;
    const name = (r && r.driver_name != null ? String(r.driver_name).trim() : "");
    if (!name) continue;
    if (!byDriver[name]) { byDriver[name] = { count: 0, tones: [] }; driversNudged.push(name); }
    byDriver[name].count += 1;
    if (!byDriver[name].tones.includes(tone)) byDriver[name].tones.push(tone);
  }
  return { totalSent: list.length, byTone, driversNudged, byDriver };
}

/**
 * Weekly nudge summary for the morning brief. Fails SAFE to a zeroed summary.
 */
async function getNudgeSummary(db, days = DEFAULT_DAYS) {
  try {
    const fetcher = resolveFetcher(db);
    const since = sinceDaysISO(days);
    const path = `${TABLE}?created_at=gte.${encodeURIComponent(since)}` +
      `&select=driver_name,tone_bucket&order=created_at.desc`;
    const rows = await fetcher(path, { method: "GET" });
    return summarize(rows);
  } catch {
    return summarize([]);
  }
}

module.exports = {
  logNudge,
  getNudgeHistory,
  getNudgeSummary,
  // exported for tests / reuse:
  summarize,
  buildRow,
  toPreview,
  clampDays,
  TABLE,
  PREVIEW_MAX,
  DEFAULT_DAYS,
};
