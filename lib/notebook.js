/**
 * M8 Research Notebook — lib/notebook.js
 *
 * Persistent research memory: a STRUCTURED ledger of lines of inquiry so M8 stops
 * restarting from zero every session. One record per entry — conjecture / evidence
 * / counterexample / dead-end / status / next-step / note — grouped by THREAD (a
 * line of inquiry). This is the substrate the North Star (resolving open problems)
 * needs: it turns clever single turns into actual research, and it's the one thing
 * the big labs can't give Muhammad — memory of HIS exploration.
 *
 * SAME CONTRACT AS THE FLEET / STATE SPINE (the moat): code owns the ledger, the
 * LLM only NARRATES a deterministic packet. M8 never invents a finding and never
 * upgrades a recorded conjecture into a proof. Deterministic + honest — a ledger
 * of verified facts and dead-ends, not a hallucination surface.
 *
 * Supersession (mirrors lib/memory.js): the SINGLETON kinds — status and
 * next_step — keep one CURRENT row per thread; a new one flips the prior false.
 * The ACCUMULATING kinds — conjecture / evidence / counterexample / dead_end /
 * note — append and all stay current (a dead end is a permanent finding).
 *
 * Orchestrator entry point: buildNotebookContext(message, history, sessionId)
 *   → { text, mode, data } — text is the prompt block (empty when not a notebook
 *   turn or on any failure). The actual WRITE is staged on data.write and
 *   persisted ONCE at the orchestrator STORE phase via persistNote() (so a turn
 *   that is read-built in two code paths can never double-write).
 *
 * Fails SAFE everywhere — any Supabase error returns an empty/degraded packet,
 * never throws to the orchestrator.
 */
const { createClient } = require("@supabase/supabase-js");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Eval / smoke sessions are stateless (mirrors lib/memory.js): they neither read
// nor write the persistent notebook, so probes can't pollute Muhammad's real
// ledger and a read can't surface real research into a hermetic eval.
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

const TABLE = "m8_research_notes";

// Canonical entry kinds. SINGLETON kinds keep one current row per thread.
const SINGLETON_KINDS = new Set(["status", "next_step"]);
const KIND_LABEL = {
  conjecture:     "Conjecture",
  evidence:       "Evidence",
  counterexample: "Counterexample",
  dead_end:       "Dead end",
  status:         "Status",
  next_step:      "Next step",
  note:           "Note",
};
const STATUS_VALUES = new Set(["open", "supported", "refuted", "resolved", "parked"]);

const DEFAULT_THREAD = "general";

// ─────────────────────────────────────────────────────────────────
// PARSE — turn a message into { mode, kind, thread, content, stance, status }
// ─────────────────────────────────────────────────────────────────

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

// Map a spoken kind word to a canonical kind (+ stance for evidence).
function canonKind(raw) {
  const k = (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/^conjecture|^hypothesis/.test(k))       return { kind: "conjecture", stance: null };
  if (/^counter\s*-?\s*example/.test(k))       return { kind: "counterexample", stance: null };
  if (/^dead[\s-]?end/.test(k))                return { kind: "dead_end", stance: null };
  if (/^next[\s-]?step/.test(k))               return { kind: "next_step", stance: null };
  if (/^status/.test(k))                       return { kind: "status", stance: null };
  if (/^evidence/.test(k)) {
    const stance = /\bagainst\b|\brefut/.test(k) ? "against"
                 : /\bfor\b|\bsupport/.test(k)   ? "for"
                 : null;
    return { kind: "evidence", stance };
  }
  // finding / observation / result / lead / idea / note → a generic note
  return { kind: "note", stance: null };
}

// Map a spoken status word to a canonical status value.
function canonStatus(raw) {
  const s = (raw || "").toLowerCase();
  if (/\bresolved|solved|prove[dn]?|complete/.test(s)) return "resolved";
  if (/\brefuted|disprove|false\b/.test(s))            return "refuted";
  if (/\bparked|on\s*hold|shelved|stuck|paused/.test(s)) return "parked";
  if (/\bsupported|promising|looks?\s+true|holding/.test(s)) return "supported";
  if (/\bopen|active|reopen/.test(s))                  return "open";
  return null;
}

// ── WRITE-KIND INFERENCE (Build-4 2C) ─────────────────────────────────────────
// A `notebook:` statement with no explicit kind word gets its kind inferred from
// phrasing, so "notebook: I think every orbit hits a power of 2" lands as a
// CONJECTURE, not a flat note. Order matters: the specific research outcomes
// (counterexample/dead-end/next-step) are checked before the looser conjecture/
// evidence stems, and status last (its markers are the loosest). Falls back to
// 'note' — inference never blocks a write.
const INFER_RULES = [
  { kind: "counterexample", stance: null,  re: /\bcounter\s*-?\s*examples?\b|\bfound\s+a\s+case\s+where\b|\bbreaks\s+down\s+at\b/i },
  { kind: "dead_end",       stance: null,  re: /\bdead[\s-]?end\b|\bdoesn'?t\s+work\b|\bfailed\b|\btried\s+and\b|\bruled\s+out\b|\bno\s+pattern\b/i },
  { kind: "next_step",      stance: null,  re: /\bnext\s+step\b|\bshould\s+try\b|\bplan\s+to\b|\bwant\s+to\s+check\b/i },
  { kind: "conjecture",     stance: null,  re: /\bi\s+think\b|\bi\s+believe\b|\bhypothes\w*\b|\bconjectur\w*\b|\bpropose\b/i },
  { kind: "evidence",       stance: "for", re: /\bfound\s+that\b|\bshows\b|\bconfirms\b|\bevidence\s+that\b|\bsupports\b|\bverified\b/i },
  { kind: "status",         stance: null,  re: /\bstatus\s+is\b|\bupdate\b|\bcurrently\b/i },
];
function inferKind(message) {
  const m = message || "";
  for (const r of INFER_RULES) {
    if (r.re.test(m)) return { kind: r.kind, stance: r.stance };
  }
  return { kind: "note", stance: null };
}

// A thread slug that is really "the research in general", not a specific line of
// inquiry — a read against one of these gets the REGISTRY overview, never an
// empty single-thread packet ("where are we on our research?" parses to
// thread='research').
const GENERIC_THREAD_RE = /^(research|researches|our-research|my-research|the-research|notebook|the-notebook)$/;

// A kind word that must never be mistaken for a thread name.
const KIND_WORD_RE = /^(conjecture|hypothesis|evidence|counter-?example|dead-?end|next-?step|status|note|finding|observation|result|it|that|this|us|now|today|the|a|an|one|some)$/;

// Pull an explicit thread reference out of a message. Conservative on purpose —
// a mis-slugged thread fragments the ledger, so we only take an EXPLICIT marker
// ([thread], "thread X", or an "on/about/for X" clause that ends at a delimiter).
// No explicit marker → null (the caller defaults to continuity or 'general').
// Fuzzy topic-from-content inference is a documented fast-follow.
function parseThread(body) {
  const b = body || "";
  let m = b.match(/\[([^\]]{1,50})\]/);
  if (m) return slugify(m[1]);
  m = b.match(/\bthread\s+["']?([a-z0-9][^"':.\-—\n]{1,48})/i);
  if (m) return slugify(m[1]);
  m = b.match(/\b(?:on|about|for|re|regarding|under)\s+(?:the\s+|our\s+|my\s+|this\s+)?([a-z0-9][^"':.\-—\n]{1,48}?)(?:\s+(?:thread|conjecture|problem|line\s+of\s+inquiry|investigation))?\s*(?:[:.\-—]|$)/i);
  if (m) {
    const t = slugify(m[1].replace(/\s+(thread|conjecture|problem|investigation)\s*$/i, ""));
    if (t && !KIND_WORD_RE.test(t)) return t;
  }
  return null;
}

// Strip a leading "on/about/for <topic> —/:" clause off the content of a write,
// so "log a conjecture on Collatz — every sequence terminates" stores the
// statement, not the topic prefix.
function stripThreadClause(content) {
  return (content || "")
    .replace(/^(?:on|about|for|re|regarding|under)\s+[^:—\-,.\n]{1,48}\s*[:—\-,]\s*/i, "")
    .trim();
}

// ── READ detection ────────────────────────────────────────────────────────────
// (A) a direct research/notebook noun query, or (B) a "where are we / status /
// recap / pick up" stem AND a research-context noun.
const READ_DIRECT = new RegExp(
  [
    "\\bresearch\\s+(?:notebook|ledger|memory|notes?|threads?|status|log|progress)\\b",
    "\\b(?:the\\s+|my\\s+|our\\s+)?notebook\\b",
    "\\b(?:what|which)\\s+(?:dead\\s*ends?|conjectures?|counter\\s*-?\\s*examples?|findings?|evidence|threads?|next\\s+steps?)\\s+(?:have|did|do|are|were)\\b",
  ].join("|"),
  "i"
);
const READ_STEM = /\b(where\s+(?:are|do|did|were)\s+we|what'?s\s+(?:our|the)\s+(?:status|progress|state|latest|standing)|catch\s+me\s+up|pick\s+up\s+where|recap|review|pull\s+up|status\s+of|update\s+me)\b/i;
const READ_CONTEXT = /\b(research|notebook|ledger|conjectures?|inquir|investigation|dead[\s-]?ends?|line\s+of\s+inquiry|next\s+steps?|findings?|threads?)\b/i;
// "where are we on collatz" / "what's our next step on goldbach" — any topic following
// "on/with/for/about". Fleet/finance/eosb are checked before notebook in the orchestrator
// so "where are we on the fleet" still hits the fleet spine, not this path.
const WHERE_ON = /\b(?:where\s+(?:are|do|did|were)\s+we|what'?s\s+(?:our\s+)?(?:next\s+step|status|progress|standing|plan)|how\s+are\s+we\s+doing|update\s+(?:on|me\s+on))\s+(?:on|with|for|regarding|about)\b/i;
function isNotebookRead(body) {
  if (READ_DIRECT.test(body)) return true;
  if (READ_STEM.test(body) && READ_CONTEXT.test(body)) return true;
  if (WHERE_ON.test(body)) return true;
  return false;
}

// ── WRITE detection ───────────────────────────────────────────────────────────
// (1) explicit "kind: content"; (2) "log/record/note/jot/capture/save/add a
// <kind> [: | that] content"; (3) "mark ... as <status>" in a research context.
const KIND_ALT = "(conjecture|hypothesis|evidence(?:\\s+(?:for|against|supporting|refuting))?|counter\\s*-?\\s*example|dead[\\s-]?end|next[\\s-]?step|status(?:\\s+update)?|finding|observation|result|lead|idea|note)";
const WRITE_COLON = new RegExp("^" + KIND_ALT + "\\s*[:\\-—]\\s*(.+)$", "is");
const WRITE_VERB  = new RegExp(
  "\\b(?:log|record|note|jot(?:\\s+down)?|capture|save|add|write\\s+down|put\\s+(?:in|into)(?:\\s+the\\s+notebook)?)\\s+(?:a\\s+|an\\s+|the\\s+|this\\s+|that\\s+|new\\s+|down\\s+)*"
  + KIND_ALT + "\\b\\s*(?:[:\\-—]\\s*|that\\s+)?(.*)$",
  "is"
);
const WRITE_STATUS = /\bmark\b[\s\S]*?\b(?:as\s+)?(resolved|solved|proven?|proved|completed?|refuted|disproved|disproven|false|parked|on\s*hold|shelved|stuck|paused|open|active|reopen(?:ed)?|supported|promising|holding)\b/i;
const STATUS_CONTEXT = /\b(thread|conjecture|problem|research|notebook|inquir|investigation|line\s+of\s+inquiry|hypothesis)\b/i;
// Generic capture words (note/finding/observation/result/idea/lead all map to
// 'note') only route to the research ledger with an explicit notebook: prefix or
// a research-context signal — so "note: buy milk" is NOT hijacked into the
// notebook, while the research-specific kinds (conjecture/evidence/dead-end/...)
// always route.
const RESEARCH_CONTEXT = /\b(research|notebook|conjectur|hypothes|theorem|proof|lemma|inquir|investigat|experiment|finding|evidence|counter\s*-?\s*example|dead[\s-]?end|next\s+step|prime|sequence|series|axiom|proble)\b/i;

function parseWrite(body, forced) {
  let m = body.match(WRITE_COLON);
  if (m) { const w = mkWrite(m[1], m[2], body, forced); if (w) return w; }

  m = body.match(WRITE_VERB);
  if (m && (m[2] || "").trim()) { const w = mkWrite(m[1], m[2], body, forced); if (w) return w; }

  m = body.match(WRITE_STATUS);
  if (m && (forced || STATUS_CONTEXT.test(body))) {
    const status = canonStatus(m[1]) || "open";
    return { kind: "status", content: status, status, stance: null, thread: parseThread(body) };
  }
  return null;
}

function mkWrite(kindRaw, content, body, forced) {
  const { kind, stance } = canonKind(kindRaw);
  // Don't let a generic note/idea capture hijack non-research note-taking.
  if (kind === "note" && !forced && !RESEARCH_CONTEXT.test(body)) return null;
  const thread = parseThread(body);
  if (kind === "status") {
    const status = canonStatus(content) || "open";
    return { kind, content: status, status, stance: null, thread };
  }
  let c = stripThreadClause((content || "").trim()).slice(0, 2000).trim();
  if (!c) return null;
  return { kind, content: c, status: null, stance, thread };
}

/**
 * Classify a message: a notebook READ, a notebook WRITE, or neither.
 * A `notebook:` / `research notebook:` prefix forces notebook handling.
 * @returns {{mode:"read"|"write"|null, kind?, thread?, content?, stance?, status?, forced?, cleaned?}}
 */
function detectNotebook(message) {
  const raw = (message || "").trim();
  if (raw.length < 2) return { mode: null };

  let body = raw, forced = false;
  const pfx = raw.match(/^\s*(?:research\s+)?notebook\b[\s:,\-]+/i);
  if (pfx) { body = raw.slice(pfx[0].length).trim(); forced = true; }

  // WRITE wins over READ ("log a status..." is a write, not a status query).
  const w = parseWrite(body, forced);
  if (w) return { mode: "write", forced, cleaned: body, ...w };

  if (isNotebookRead(body)) return { mode: "read", forced, cleaned: body, thread: parseThread(body) };

  // A `notebook:` prefix with no explicit kind: a substantive STATEMENT is logged
  // with its kind INFERRED from phrasing (Build-4 2C; falls back to a general
  // note); an empty/short/query-shaped body shows the overview.
  if (forced) {
    const looksQuery = body.replace(/\s/g, "").length < 4
      || /[?؟]\s*$/.test(body)
      || READ_STEM.test(body)
      || /^(show|list|what|which|where|recap|review|status|open|display|give)\b/i.test(body);
    if (!looksQuery) {
      const inf = inferKind(body);
      return {
        mode: "write", forced, cleaned: body,
        kind: inf.kind, content: body.slice(0, 2000), stance: inf.stance,
        status: inf.kind === "status" ? (canonStatus(body) || "open") : null,
        thread: parseThread(body),
        inferred: inf.kind !== "note",
      };
    }
    return { mode: "read", forced, cleaned: body, thread: parseThread(body) };
  }

  return { mode: null };
}

// Cheap external gate (parallels looksFleet) — true if this is a notebook turn.
function looksNotebook(message) {
  return detectNotebook(message).mode != null;
}

// Continuity: the most recent explicit thread named in the recent transcript, so a
// follow-up write/read with no thread marker stays on the same line of inquiry.
function recentThread(history) {
  const h = (history || []).filter((m) => m && typeof m.content === "string");
  for (let i = h.length - 1; i >= 0 && i >= h.length - 10; i--) {
    const t = parseThread(h[i].content);
    if (t) return t;
  }
  return null;
}

// Replay the notebook WRITES already made in this conversation from the chat
// history (user turns only). This is how an EPHEMERAL (eval) session reads its
// own writes back without ever touching the DB — the hermetic invariant holds,
// but a multi-turn probe that writes then reads sees real in-session state
// instead of a false "empty". Thread continuity mirrors the live path: an
// unthreaded write stays on the most recently named thread.
function stagedNotesFromHistory(history) {
  const notes = [];
  let lastThread = null;
  for (const m of history || []) {
    if (!m || typeof m.content !== "string") continue;
    if (m.role && m.role !== "user") continue;
    const named = parseThread(m.content);
    const det = detectNotebook(m.content);
    if (det.mode === "write" && det.kind) {
      notes.push({
        kind: det.kind,
        content: det.content,
        stance: det.stance || null,
        status: det.status || null,
        thread: det.thread || lastThread || DEFAULT_THREAD,
        title: null,
        created_at: null,
      });
    }
    if (named) lastThread = named;
  }
  return notes;
}

// Group staged (in-session) notes into the same registry shape as the DB
// overview: [{ thread, title, status, count, last }], newest-touched first.
function registryFromNotes(notes) {
  const byThread = new Map();
  (notes || []).forEach((n, i) => {
    let t = byThread.get(n.thread);
    if (!t) { t = { thread: n.thread, title: n.thread.replace(/-/g, " "), status: null, count: 0, last: "this session", order: i }; byThread.set(n.thread, t); }
    t.count++;
    t.order = i;
    if (n.kind === "status") t.status = n.status;
  });
  return [...byThread.values()].sort((a, b) => b.order - a.order);
}

// ── KNOWN-THREAD READ INFERENCE (Build-5) ─────────────────────────────────────
// "any progress on collatz?" carries no notebook/research keyword and no
// where-are-we stem, so detectNotebook misses it — the turn used to fall
// through to search/LLM, the same confabulation door Build-4 closed for
// WHERE_ON. Mirrors the known-driver registry: a progress-stem message whose
// topic matches a thread that ACTUALLY EXISTS routes to that thread's briefing.
// An unknown topic ("any progress on the visa?") falls through untouched, so
// ordinary chat is never hijacked — the registry is the gate.
const PROGRESS_STEM = /\b(?:any\s+(?:progress|updates?|movement|luck|news)|made?\s+any\s+(?:progress|headway)|any\s+headway|how(?:['’]s|\s+is)\s+[\s\S]{0,40}?(?:going|coming(?:\s+along)?|progressing|looking|shaping\s+up)|what['’]?s\s+the\s+latest\s+(?:on|with)|did\s+we\s+get\s+anywhere|how\s+far\s+(?:did|have|are)\s+we)\b/i;

// True thread match only: the thread's slug words must appear verbatim in the
// message. Generic/default threads never match (the word "general" in a chat
// message must not hijack the turn).
function matchKnownThread(message, threads) {
  const norm = " " + String(message || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ") + " ";
  for (const t of threads || []) {
    const slug = t.thread || "";
    if (!slug || slug === DEFAULT_THREAD || GENERIC_THREAD_RE.test(slug)) continue;
    if (norm.includes(" " + slug.replace(/-/g, " ") + " ")) return slug;
  }
  return null;
}

// Best-effort: any failure (no table, DB down) returns null and the turn falls
// through to normal routing — inference must never add a new failure mode.
async function inferKnownThreadRead(message, history, sessionId) {
  if (!PROGRESS_STEM.test(message || "")) return null;
  try {
    if (isEphemeralSession(sessionId)) {
      const staged = stagedNotesFromHistory(history);
      const hit = matchKnownThread(message, registryFromNotes(staged));
      if (!hit) return null;
      const notes = staged.filter((n) => n.thread === hit);
      if (!notes.length) return null;
      return { text: renderThreadPacket(hit, notes), mode: "read", data: { thread: hit, inferredThread: true } };
    }
    const registry = await getActiveThreads();
    const hit = matchKnownThread(message, registry);
    if (!hit) return null;
    const supabase = getClient();
    const notes = await fetchThreadNotes(supabase, hit);
    if (!notes.length) return null;
    return { text: renderThreadPacket(hit, notes), mode: "read", data: { thread: hit, inferredThread: true } };
  } catch (err) {
    console.error("[M8] notebook thread-inference error (non-fatal):", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// DB — read the current ledger; stage + persist a write
// ─────────────────────────────────────────────────────────────────

async function fetchThreadNotes(supabase, thread) {
  const { data } = await supabase
    .from(TABLE)
    .select("kind, content, stance, status, title, importance, created_at")
    .eq("thread", thread)
    .eq("is_current", true)
    .order("created_at", { ascending: true })
    .limit(200);
  return data || [];
}

// Distinct current threads with their status + counts + last-touched, newest first.
async function fetchThreadOverview(supabase) {
  const { data } = await supabase
    .from(TABLE)
    .select("thread, title, kind, status, created_at")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(400);
  const rows = data || [];
  const byThread = new Map();
  for (const r of rows) {
    let t = byThread.get(r.thread);
    if (!t) { t = { thread: r.thread, title: r.title || r.thread, status: null, count: 0, last: r.created_at }; byThread.set(r.thread, t); }
    t.count++;
    if (r.title && !t.title) t.title = r.title;
    if (r.kind === "status" && !t.status) t.status = r.status;  // newest status wins (rows are desc)
    if (r.created_at > t.last) t.last = r.created_at;
  }
  return [...byThread.values()].sort((a, b) => (b.last > a.last ? 1 : -1));
}

/**
 * Build-4 2A — the thread REGISTRY: every distinct current thread with its entry
 * count and last-touched date, newest first. Public, self-clienting wrapper so
 * the "where are we on our research?" overview reads a REAL registry instead of
 * leaving the LLM to fabricate one. Throws on DB failure — the caller's catch
 * degrades to the hardened empty packet.
 */
// Short-TTL cache (mirrors fleet's getFleetRecord cache): the Build-5 inference
// probes the registry on every progress-stem turn ("how's it going?"), so the
// warm path must not pay a Supabase query each time. Invalidated on write.
let _threadCache = { at: 0, data: null };
async function getActiveThreads() {
  const ttl = parseInt(process.env.NOTEBOOK_REGISTRY_TTL_MS, 10) || 30000;
  if (_threadCache.data && Date.now() - _threadCache.at < ttl) return _threadCache.data;
  const supabase = getClient();
  const overview = await fetchThreadOverview(supabase);
  const data = overview.map((t) => ({ thread: t.thread, title: t.title, status: t.status, count: t.count, last: t.last }));
  _threadCache = { at: Date.now(), data };
  return data;
}

/**
 * Persist a staged write (called ONCE per turn from the orchestrator STORE phase).
 * Supersession-aware: a singleton kind (status/next_step) flips the prior current
 * row for that thread false. Non-fatal — never throws.
 */
async function persistNote(sessionId, write) {
  if (!write || !write.kind || isEphemeralSession(sessionId)) return { skipped: true };
  try {
    const supabase = getClient();
    const thread = write.thread || DEFAULT_THREAD;

    if (SINGLETON_KINDS.has(write.kind)) {
      const ex = await supabase
        .from(TABLE)
        .select("id")
        .eq("thread", thread)
        .eq("kind", write.kind)
        .eq("is_current", true);
      for (const row of ex.data || []) {
        await supabase
          .from(TABLE)
          .update({ is_current: false, superseded_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }

    const ins = await supabase.from(TABLE).insert([{
      thread,
      title:       write.title || thread.replace(/-/g, " "),
      kind:        write.kind,
      content:     String(write.content || "").slice(0, 2000),
      stance:      write.stance || null,
      status:      write.kind === "status" ? (write.status || "open") : null,
      session_id:  sessionId,
      importance:  Math.min(5, Math.max(1, parseInt(write.importance, 10) || 3)),
      is_current:  true,
      // Build-10: a non-status write's status field (e.g. lean_verified from
      // buildLeanNotes) used to be dropped here — keep it as provenance metadata
      // so the graph (and any future reader) can see it. Additive only.
      metadata:    (write.status && write.kind !== "status") ? { lean_or_src_status: write.status, lean: /^lean_/.test(write.status) ? write.status : undefined } : {},
    }]).select("id").single();
    _threadCache = { at: 0, data: null };   // a new entry invalidates the registry cache
    if (ins && ins.error) {
      // insert failed → no ledger row, so nothing to mirror into the graph
      console.error("[M8] notebook insert error (non-fatal):", ins.error.message);
      return { error: ins.error.message };
    }

    // Build-10: RESEARCH MEMORY GRAPH — deterministic write-time ingest (node +
    // code-owned edges + one budgeted embed). LAZY require so a graph-module bug
    // can never take down the notebook; fail-safe so a graph error never blocks
    // the write. Gemini extraction/enrichment runs in the nightly sweep, not here.
    if (process.env.GRAPH_DISABLED !== "1") {
      try {
        const { ingestNote } = require("./memory-graph");
        await ingestNote({
          id:         ins && ins.data ? ins.data.id : null,
          thread,
          kind:       write.kind,
          content:    String(write.content || "").slice(0, 2000),
          stance:     write.stance || null,
          status:     write.status || null,
          session_id: sessionId,
        }, { withExtraction: false });
      } catch (gErr) {
        console.error("[M8] graph ingest error (non-fatal):", gErr.message);
      }
    }
    return { ok: true, thread, kind: write.kind };
  } catch (err) {
    console.error("[M8] notebook persist error (non-fatal):", err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// PACKETS — the deterministic block the LLM narrates (never invents)
// ─────────────────────────────────────────────────────────────────
const GROUND = "GROUND TRUTH from Muhammad's persistent research notebook — narrate and reason over it, but do NOT invent entries, results, or proofs, and never upgrade a recorded conjecture into a settled fact.";

function threadTitle(notes, slug) {
  const withTitle = notes.find((n) => n.title);
  return (withTitle && withTitle.title) || (slug || "").replace(/-/g, " ");
}

// Build-4 2B — STRUCTURED thread summary: entries organised into labelled
// sections (the LLM narrates a briefing, never a raw row dump). Singletons
// (STATUS / NEXT STEP) show the one current row; accumulative kinds show
// newest-first, capped at 3 so the packet stays tight on a long thread.
function renderThreadPacket(slug, notes) {
  const by = (k) => notes.filter((n) => n.kind === k);
  const newest3 = (arr) => [...arr].reverse().slice(0, 3);
  const title = threadTitle(notes, slug);
  const statusNote = by("status").slice(-1)[0];
  const nextNote   = by("next_step").slice(-1)[0];
  const conj = by("conjecture");
  const latestConj = conj.slice(-1)[0];
  const ce = by("counterexample");
  const de = newest3(by("dead_end"));
  const notesG = newest3(by("note"));
  const evFor = newest3(by("evidence").filter((n) => n.stance !== "against"));
  const evAgainst = newest3(by("evidence").filter((n) => n.stance === "against"));

  const lines = [
    `RESEARCH NOTEBOOK — thread "${title}" (${notes.length} current ${notes.length === 1 ? "entry" : "entries"}). ${GROUND}`,
  ];
  if (latestConj)       lines.push(`CONJECTURE: ${latestConj.content}${conj.length > 1 ? ` (+${conj.length - 1} earlier on file)` : ""}`);
  if (evFor.length)     lines.push(`EVIDENCE FOR (newest first): ${evFor.map((n) => n.content).join(" | ")}`);
  if (evAgainst.length) lines.push(`EVIDENCE AGAINST (newest first): ${evAgainst.map((n) => n.content).join(" | ")}`);
  if (ce.length)        lines.push(`COUNTEREXAMPLE: ${ce.map((n) => n.content).join(" | ")}`);
  if (de.length)        lines.push(`DEAD ENDS (already tried — do NOT re-propose these as new ideas): ${de.map((n) => n.content).join(" | ")}`);
  if (notesG.length)    lines.push(`NOTES: ${notesG.map((n) => n.content).join(" | ")}`);
  lines.push(`STATUS: ${statusNote ? (statusNote.status || statusNote.content) : "open (no status set)"}`);
  lines.push(`NEXT STEP: ${nextNote ? nextNote.content : "none recorded — offer to set one."}`);
  lines.push(`Narrate this as a research briefing for Boss, keeping the labelled sections above (conjecture / evidence / status / next step). Do not invent anything beyond what is in the packet above.`);
  return lines.join("\n");
}

// Build-4 2A — the REGISTRY packet for a bare "where are we on our research?":
// the LLM gets a real list of threads to read from, so it can no longer
// fabricate one. Works for both the DB overview and an in-session staged
// registry (last = "this session").
function renderRegistryPacket(threads) {
  if (!threads || !threads.length) return renderEmptyPacket(null);
  const lines = [
    `RESEARCH NOTEBOOK REGISTRY — ${threads.length} active ${threads.length === 1 ? "thread" : "threads"}. ${GROUND}`,
  ];
  for (const t of threads.slice(0, 12)) {
    const lastRaw = String(t.last || "");
    const last = /^\d{4}-\d{2}-\d{2}/.test(lastRaw) ? `last updated ${lastRaw.slice(0, 10)}` : (lastRaw || "no date");
    lines.push(`• ${t.title || t.thread} — ${t.count} ${t.count === 1 ? "entry" : "entries"} (status ${t.status || "open"}, ${last})`);
  }
  lines.push(`These are the ONLY threads on record. List the threads and their entry counts for Boss. Do NOT invent entries, findings, or threads not in this list. He can ask "where are we on <thread>" for any one thread's full ledger.`);
  return lines.join("\n");
}
const renderOverviewPacket = renderRegistryPacket; // back-compat alias

function renderEmptyPacket(threadLabel) {
  const t = threadLabel ? threadLabel.replace(/-/g, " ") : null;
  const where = t ? `the '${t}' thread` : "the research notebook (no threads exist at all)";
  const open = t ? `Nothing recorded yet for ${t}.` : `Nothing recorded yet in the research notebook.`;
  const outside = t ? `what you know about ${t} from the outside world` : `the outside world`;
  return [
    `RESEARCH NOTEBOOK — CONFIRMED EMPTY.`,
    `The database returned ZERO entries for ${where}.`,
    `This means no verification bounds, no dead ends, no conjectures, no evidence, no next steps, and no results of any kind are on record. Any specific number, bound, milestone, or researcher result you name would be a fabrication pulled from training data.`,
    `You MUST open your reply with "${open}" Then you may offer to start the ledger (log a conjecture, evidence, a dead end, or a next step). Do NOT add any context from ${outside}.`,
  ].join("\n");
}

// Staged-write packet: the entry is being LOGGED this turn (persisted at STORE).
// `snapshot` is the thread's state BEFORE the new entry (may be empty / null).
function renderLoggedPacket(write, slug, snapshot) {
  const title = (slug || DEFAULT_THREAD).replace(/-/g, " ");
  const label = KIND_LABEL[write.kind] || "Note";
  const what = write.kind === "status"
    ? `status → ${write.status || "open"}`
    : `${label.toLowerCase()}${write.stance ? ` (${write.stance})` : ""}: "${write.content}"`;
  const lines = [
    `RESEARCH NOTEBOOK — RECORDING to thread "${title}" now: ${what}.`,
    `Acknowledge to Boss in one short line that it's logged to the notebook. Do NOT claim it's proven, verified, or true — it is a RECORDED ${label.toUpperCase()}, nothing more${write.kind === "conjecture" ? " (a conjecture is an open claim, not a result)" : ""}. Do NOT invent any additional findings.`,
  ];
  if (write.inferred) {
    lines.push(`The kind was INFERRED from Boss's phrasing — say explicitly that it was logged as a ${label.toLowerCase()}.`);
  }
  if (snapshot && snapshot.length) {
    const counts = {};
    for (const n of snapshot) counts[n.kind] = (counts[n.kind] || 0) + 1;
    const parts = Object.entries(counts).map(([k, v]) => `${v} ${KIND_LABEL[k] ? KIND_LABEL[k].toLowerCase() : k}${v > 1 ? "s" : ""}`);
    if (parts.length) lines.push(`For context, this thread already held: ${parts.join(", ")} (state before this entry).`);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// ORCHESTRATOR ENTRY POINT
// ─────────────────────────────────────────────────────────────────
/**
 * Cheap regex gate first; only touches Supabase when the message is actually a
 * notebook turn. Returns { text, mode, data }. The WRITE is STAGED on
 * data.write — the orchestrator persists it once at STORE (persistNote), so a
 * turn whose packet is built in two code paths can never double-write.
 *
 * Ephemeral (eval) sessions never touch the DB: a write renders the staged
 * packet (and persistNote no-ops), a read renders the honest-empty packet — so
 * the eval stays hermetic and the probes test behaviour, not stored data.
 */
async function buildNotebookContext(message, history, sessionId) {
  const det = detectNotebook(message);
  if (!det.mode) {
    // Build-5: regex detection missed — try known-thread inference ("any
    // progress on collatz?"). Null unless the topic matches a REAL thread.
    const inferred = await inferKnownThreadRead(message, history, sessionId);
    return inferred || { text: "", mode: null, data: null };
  }

  // Resolve the thread: explicit marker → continuity (recent transcript) → default.
  const explicit = det.thread || null;

  // A read against a GENERIC thread ("our research", "the notebook") is really
  // the overview/registry ask, not a single-thread read.
  const generic = !!(explicit && GENERIC_THREAD_RE.test(explicit));

  // ── WRITE ──────────────────────────────────────────────────────────────────
  if (det.mode === "write") {
    const thread = (explicit && !generic ? explicit : null) || recentThread(history) || DEFAULT_THREAD;
    const write = {
      kind: det.kind, content: det.content, stance: det.stance || null,
      status: det.status || null, thread, inferred: det.inferred || false,
      // title is derived from the slug in persistNote (thread.replace(/-/g," ")).
    };
    // Ephemeral / stateless: render the staged packet with an in-session
    // (history-replayed) snapshot — never reads or persists to the DB.
    if (isEphemeralSession(sessionId)) {
      const staged = stagedNotesFromHistory(history).filter((n) => n.thread === thread);
      return { text: renderLoggedPacket(write, thread, staged.length ? staged : null), mode: "write", data: { write } };
    }
    let snapshot = [];
    try {
      const supabase = getClient();
      snapshot = await fetchThreadNotes(supabase, thread);
    } catch (err) {
      console.error("[M8] notebook write-snapshot error (non-fatal):", err.message);
    }
    return { text: renderLoggedPacket(write, thread, snapshot), mode: "write", data: { write } };
  }

  // ── READ ───────────────────────────────────────────────────────────────────
  // Ephemeral / stateless: NO DB — the read replays this conversation's own
  // staged writes from history. A fresh session still gets the hardened
  // honest-empty packet; a probe that wrote earlier in the SAME session reads
  // its real in-session state back (hermetic invariant holds either way).
  if (isEphemeralSession(sessionId)) {
    const staged = stagedNotesFromHistory(history);
    if (!explicit || generic) {
      const registry = registryFromNotes(staged);
      if (!registry.length) return { text: renderEmptyPacket(null), mode: "read", data: null };
      return { text: renderRegistryPacket(registry), mode: "read", data: { overview: registry.length } };
    }
    const notes = staged.filter((n) => n.thread === explicit || n.thread.includes(explicit) || explicit.includes(n.thread));
    if (!notes.length) return { text: renderEmptyPacket(explicit), mode: "read", data: null };
    return { text: renderThreadPacket(explicit, notes), mode: "read", data: { thread: explicit } };
  }

  try {
    const supabase = getClient();
    if (explicit && !generic) {
      let notes = await fetchThreadNotes(supabase, explicit);
      if (!notes.length) {
        // Try a fuzzy match against existing thread slugs before declaring empty.
        const overview = await fetchThreadOverview(supabase);
        const hit = overview.find((t) => t.thread === explicit || t.thread.includes(explicit) || explicit.includes(t.thread));
        if (hit) notes = await fetchThreadNotes(supabase, hit.thread);
        if (!notes.length) return { text: renderEmptyPacket(explicit), mode: "read", data: null };
        return { text: renderThreadPacket(hit ? hit.thread : explicit, notes), mode: "read", data: { thread: hit ? hit.thread : explicit } };
      }
      return { text: renderThreadPacket(explicit, notes), mode: "read", data: { thread: explicit } };
    }
    // No explicit thread (or a generic one) → the registry of all active threads.
    const registry = await getActiveThreads();
    return { text: renderRegistryPacket(registry), mode: "read", data: { overview: registry.length } };
  } catch (err) {
    console.error("[M8] notebook read error (non-fatal):", err.message);
    // Return an honest empty packet so the LLM is told "nothing recorded yet"
    // rather than left to confabulate from training data (e.g. if the table
    // migration hasn't been run yet, every read would throw a DB error and the
    // context would be silently empty).
    return { text: renderEmptyPacket(generic ? null : explicit), mode: "read", data: null };
  }
}

module.exports = {
  buildNotebookContext,
  persistNote,
  detectNotebook,
  looksNotebook,
  // exported for tests / future reuse:
  slugify, canonKind, canonStatus, parseThread, parseWrite, isNotebookRead,
  recentThread, stripThreadClause, inferKind,
  stagedNotesFromHistory, registryFromNotes, getActiveThreads,
  matchKnownThread, inferKnownThreadRead, PROGRESS_STEM,
  renderThreadPacket, renderOverviewPacket, renderRegistryPacket, renderEmptyPacket, renderLoggedPacket,
  fetchThreadNotes, fetchThreadOverview,
  SINGLETON_KINDS, STATUS_VALUES, KIND_LABEL, DEFAULT_THREAD, GENERIC_THREAD_RE,
};
