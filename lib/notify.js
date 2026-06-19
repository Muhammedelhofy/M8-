/**
 * M8 Hands — lib/notify.js  (Build-70)
 *
 * The reusable DELIVERY layer: M8's first real "Hands" muscle for reaching
 * Muhammad outside the chat. Today it sends the morning fleet brief by email;
 * the Track-A nudge action-loop (next build) will send driver messages through
 * the SAME sendEmail() seam. CODE owns delivery; nothing here reasons.
 *
 * SAFETY CONTRACT:
 *   - Sends NOTHING unless RESEND_API_KEY is set (inert until opted in) — so the
 *     whole layer can ship live and stay silent until Muhammad adds the key.
 *   - Three independent kill switches (any one stops the daily email):
 *       1. env M8_BRIEF_EMAIL_ENABLED=off  (hard off, code-level)
 *       2. the m8_settings 'morning_brief_email' { enabled:false } flag
 *          (flipped by the unsubscribe link OR a chat command)
 *       3. no RESEND_API_KEY (nothing to send through)
 *   - Every export fails SAFE (returns a skipped/error result, never throws).
 *
 * Free stack: Resend REST API (free tier), called with plain fetch (no SDK).
 */
const crypto = require("crypto");

const SB_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
                process.env.SUPABASE_ANON_KEY || "").trim();

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const BRIEF_FROM = (process.env.M8_BRIEF_FROM || "M8 Fleet <onboarding@resend.dev>").trim();
// Default recipient = the Gmail the Resend account is registered with (required
// on Resend's free tier until a sending domain is verified). Override anytime
// with env M8_BRIEF_EMAIL once a domain is set up.
const BRIEF_TO   = (process.env.M8_BRIEF_EMAIL || "mohd.hofy@gmail.com").trim();
// Public base URL for the unsubscribe link in emails (Vercel sets VERCEL_URL).
const PUBLIC_BASE = (process.env.M8_PUBLIC_BASE ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://m8-alpha.vercel.app")).replace(/\/+$/, "");

const PREF_KEY = "morning_brief_email";

// Hard env off-switch (kill switch #1).
function envHardOff() {
  return /^(off|0|false|no|disabled?)$/i.test((process.env.M8_BRIEF_EMAIL_ENABLED || "").trim());
}

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

async function settingsGet(key) {
  const rows = await sbFetch(`m8_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rows[0].value || null;
}

async function settingsUpsert(key, value) {
  return sbFetch("m8_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

/**
 * Load (and lazily create) the morning-brief email prefs.
 * Default when no row exists: enabled=true (Muhammad asked for it "good to go"),
 * with a stable random unsubscribe token. Fails SAFE: if Supabase is unreachable,
 * returns an in-memory default (enabled true, no token → unsub link omitted).
 */
async function ensureBriefPrefs() {
  const fallback = { enabled: true, recipient: BRIEF_TO, unsubscribe_token: null };
  if (!SB_URL || !SB_KEY) return fallback;
  let value = await settingsGet(PREF_KEY);
  if (!value || typeof value !== "object") {
    value = { enabled: true, recipient: BRIEF_TO, unsubscribe_token: crypto.randomBytes(16).toString("hex") };
    await settingsUpsert(PREF_KEY, value);
    return value;
  }
  // Backfill a token if an older row lacks one.
  if (!value.unsubscribe_token) {
    value.unsubscribe_token = crypto.randomBytes(16).toString("hex");
    await settingsUpsert(PREF_KEY, value);
  }
  if (!value.recipient) value.recipient = BRIEF_TO;
  return value;
}

// Effective "should the daily email go out?" — env hard-off wins, else the flag.
async function isBriefEmailEnabled() {
  if (envHardOff()) return false;
  const prefs = await ensureBriefPrefs();
  return !!(prefs && prefs.enabled);
}

// Flip the flag (chat command path). Returns the new boolean state.
async function setBriefEmailEnabled(enabled) {
  const prefs = await ensureBriefPrefs();
  prefs.enabled = !!enabled;
  await settingsUpsert(PREF_KEY, prefs);
  return prefs.enabled;
}

// Unsubscribe / resubscribe by the email-link token. Returns { ok, enabled } or
// { ok:false } if the token doesn't match (anti-tamper: a wrong token is a no-op).
async function setEnabledByToken(token, enabled) {
  const prefs = await ensureBriefPrefs();
  if (!token || !prefs.unsubscribe_token || token !== prefs.unsubscribe_token) return { ok: false };
  prefs.enabled = !!enabled;
  await settingsUpsert(PREF_KEY, prefs);
  return { ok: true, enabled: prefs.enabled };
}

function unsubscribeUrl(token) {
  if (!token) return null;
  return `${PUBLIC_BASE}/api/notify-prefs?action=unsubscribe&token=${encodeURIComponent(token)}`;
}

// ── Email send (Resend REST; inert without a key) ─────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "no RESEND_API_KEY (inert)" };
  const recipient = to || BRIEF_TO;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: BRIEF_FROM, to: [recipient], subject: subject || "M8",
        html: html || undefined, text: text || undefined,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.id || null, to: recipient };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Chat command detection: "stop / resume the morning email" ─────────────────
const STOP_RE = /\b(stop|cancel|turn\s*off|disable|unsubscribe\s*(?:me\s*)?from|mute|pause)\b[^.?!\n]{0,30}\b(morning|daily|fleet|brief)\b[^.?!\n]{0,20}\b(email|e-?mail|brief|report)?\b/i;
// NOTE: deliberately excludes "send"/"start" here — "send me the morning brief"
// is a request to SEE the brief, not to re-enable the email. Those verbs only
// re-enable when paired explicitly with "email" (RESUME_RE2 below).
const RESUME_RE = /\b(resume|restart|turn\s*on|enable|re-?subscribe|re-?enable)\b[^.?!\n]{0,30}\b(morning|daily|fleet|brief)\b[^.?!\n]{0,20}\b(email|e-?mail|brief|report)?\b/i;
// Tighter fallbacks for bare "stop the morning email" / "stop emailing me the brief".
const STOP_RE2 = /\b(stop|cancel|turn\s*off|disable|unsubscribe|mute)\b[^.?!\n]{0,25}\b(email|e-?mail)\b/i;
const RESUME_RE2 = /\b(resume|turn\s*on|enable|re-?subscribe|start)\b[^.?!\n]{0,25}\b(email|e-?mail)\b/i;

function detectBriefEmailCommand(message) {
  const s = (message || "");
  // Must reference the brief/morning context so a generic "stop the email" about
  // something else doesn't trip it — require a brief/morning/fleet/daily cue.
  const hasBriefCue = /\b(morning|daily|fleet|brief|report)\b/i.test(s);
  if (!hasBriefCue) return null;
  if (STOP_RE.test(s) || STOP_RE2.test(s)) return { action: "stop" };
  if (RESUME_RE.test(s) || RESUME_RE2.test(s)) return { action: "resume" };
  return null;
}

// On-demand "send me the brief email now" — sends the brief by email RIGHT NOW
// (regardless of the enabled flag; the user explicitly asked). Requires an
// explicit email/inbox word so "send me the morning brief" (show in chat) does
// NOT trip it; excludes stop/resume verbs so those route to the toggle instead.
function detectSendBriefEmailNow(message) {
  const s = (message || "");
  const hasEmail = /\b(e-?mail|inbox)\b/i.test(s);
  const hasBrief = /\b(brief|morning|fleet|daily)\b/i.test(s);
  const hasSendVerb = /\b(send|deliver|email|mail|get|give\s+me|push)\b/i.test(s);
  const isToggle = /\b(stop|cancel|turn\s*off|disable|unsubscribe|mute|pause|resume|re-?enable|turn\s*on)\b/i.test(s);
  return hasEmail && hasBrief && hasSendVerb && !isToggle;
}

/**
 * Compute the current brief and email it immediately. Honest about every failure
 * mode (no key / no data / send error). Ignores the enabled flag (explicit ask).
 */
async function sendBriefNow() {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "no RESEND_API_KEY" };
  const { computeLiveBrief, formatBriefHTML } = require("./morning-brief");
  const brief = await computeLiveBrief();
  if (!brief) return { ok: false, error: "no fleet data available" };
  const prefs = await ensureBriefPrefs();
  const html = formatBriefHTML(brief, unsubscribeUrl(prefs.unsubscribe_token));
  const subj = `Fleet brief (on-demand) ${brief.asOfDate || brief.date}`;
  const r = await sendEmail({ to: prefs.recipient, subject: subj, html });
  return { ...r, recipient: prefs.recipient, counts: brief.counts };
}

module.exports = {
  sendEmail,
  ensureBriefPrefs,
  isBriefEmailEnabled,
  setBriefEmailEnabled,
  setEnabledByToken,
  unsubscribeUrl,
  detectBriefEmailCommand,
  detectSendBriefEmailNow,
  sendBriefNow,
  envHardOff,
  // exported for tests / reuse:
  BRIEF_TO, BRIEF_FROM, PREF_KEY,
};
