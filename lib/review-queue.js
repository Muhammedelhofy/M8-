/**
 * M8 M3.1 — Survivor Review Queue  (Build-17)
 *
 * The triage layer over the M3 conjecture generator. `runConjectureGen` mines
 * ~120 candidates/run, ~20 survive falsification, but the notebook keeps only the
 * top 5 (spam guard) — the rest were thrown away. This module captures ALL
 * non-vacuous survivors into a dedicated store (m8_review_queue), clusters them by
 * structural family, and renders a human-triage worklist so a person can pick the
 * ≥1 conjecture worth deeper attention (the M4-manual entry condition).
 *
 * LOAD-BEARING HONESTY (BUILD_17_SPEC §0):
 *   - This is PRESENTATION + PERSISTENCE only. It NEVER touches the gate, survival
 *     counts, the matched baseline, or the notebook 5-cap — those are computed
 *     upstream in conjecture-gen.js and are byte-identical to Build-16.
 *   - The order is TRIAGE / COVERAGE, never a truth / novelty / quality ranking.
 *     Within a family, candidates with NO curated-pack match are listed first (the
 *     Build-16 coverage heuristic), then alphabetically. NO test-derived value
 *     (margin, observed, tested_to) ever enters a sort key — there is no quality
 *     score, by design. The packet says so; od2arm.queue_not_ranking guards it.
 *   - Survivors stay "machine-generated, survived falsification to N" — never
 *     established / literature / a discovery. Known-form labels are carried.
 *
 * Fails SAFE everywhere (mirrors memory-graph.js): any Supabase error logs and
 * returns a degraded result; nothing here throws into the orchestrator. Kill
 * switch: REVIEW_QUEUE_DISABLED=1.
 */
const { createClient } = require("@supabase/supabase-js");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
const TABLE = "m8_review_queue";
const QUEUE_VERSION = 1;
const STATES = new Set(["new", "kept", "dismissed", "reviewed"]);
const VIEW_CAP = 60;                       // max items rendered in one packet
const isEphemeralSession = (sid) => /^eval/i.test(String(sid || ""));

// ─────────────────────────────────────────────────────────────────
// PURE CORE — cluster + triage-order (the PS-mirror-tested logic)
// ─────────────────────────────────────────────────────────────────
/**
 * Group survivors by template family; emit families in template-name order. WITHIN
 * a family: unmatched (no known_match) first [Build-16 coverage precedent], then
 * statement ascending (stable). NO test/quality value (margin, observed,
 * tested_to) enters any sort key — the order is triage/coverage, never a
 * truth/novelty/quality ranking. Pure, deterministic, sync.
 */
function clusterAndRank(items) {
  const groups = new Map();
  for (const it of items || []) {
    const key = it.template || "(unknown)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const clusters = [];
  for (const key of [...groups.keys()].sort()) {
    const arr = groups.get(key).slice().sort((a, b) => {
      const ak = a.known_match ? 1 : 0, bk = b.known_match ? 1 : 0;
      if (ak !== bk) return ak - bk;                                   // unmatched (0) first — coverage, NOT novelty
      return String(a.statement).localeCompare(String(b.statement));  // stable, content-neutral
    });
    clusters.push({ template: key, items: arr });
  }
  return clusters;
}

// ─────────────────────────────────────────────────────────────────
// DETECTION — view vs triage (triage requires a #id anchor)
// ─────────────────────────────────────────────────────────────────
const QUEUE_VIEW_RE = /\b(?:m3\s+)?(?:conjecture\s+|survivor\s+)?(?:review|triage)\s+queue\b|\bqueued?\s+for\s+review\b/i;

/** { mode: 'view'|'triage'|null, ids?, action? }. Triage needs an action verb + #id. */
function detectReviewQueue(message) {
  const s = String(message || "").trim();
  if (s.length < 4) return { mode: null };
  // TRIAGE first (more specific — anchored on #id, so "keep going" can't trip it)
  const ids = (s.match(/#(\d+)/g) || []).map((x) => x.replace("#", ""));
  if (ids.length) {
    let action = null;
    if (/\b(?:dismiss|reject|drop|discard|remove)\b/i.test(s))      action = "dismissed";
    else if (/\bkeep\b/i.test(s))                                   action = "kept";
    else if (/\b(?:reviewed|mark(?:ed)?)\b/i.test(s))              action = "reviewed";
    if (action) return { mode: "triage", ids, action };
  }
  if (QUEUE_VIEW_RE.test(s)) return { mode: "view" };
  return { mode: null };
}

// ─────────────────────────────────────────────────────────────────
// PERSISTENCE — upsert survivors (fail-safe; preserves human review_state)
// ─────────────────────────────────────────────────────────────────
/**
 * Upsert every survivor by `statement`. New → insert (review_state defaults
 * 'new'). Existing → bump seen_count, refresh last_seen_at / max(tested_to) /
 * known_match / observed — but NEVER reset the human review_state or first_seen_at
 * (a re-seen 'dismissed' stays dismissed). Never throws.
 */
async function upsertQueueItems(items) {
  const out = { upserted: 0, inserted: 0, errors: 0 };
  if (process.env.REVIEW_QUEUE_DISABLED === "1") return { ...out, disabled: true };
  const list = (items || []).filter((it) => it && it.statement && it.template);
  if (!list.length) return out;
  try {
    const sb = getClient();
    for (const it of list) {
      try {
        const ex = await sb.from(TABLE)
          .select("id, seen_count, tested_to").eq("statement", it.statement).maybeSingle();
        const obs = (typeof it.observed === "number" && isFinite(it.observed)) ? it.observed : null;
        if (ex.data && ex.data.id) {
          const u = await sb.from(TABLE).update({
            seen_count: (ex.data.seen_count || 1) + 1,
            tested_to:  Math.max(ex.data.tested_to || 0, it.tested_to || 0) || null,
            known_match: it.known_match || null,
            observed:    obs,
            last_seen_at: new Date().toISOString(),
          }).eq("id", ex.data.id);
          if (u.error) { out.errors++; continue; }
        } else {
          const ins = await sb.from(TABLE).insert([{
            statement:   it.statement,
            template:    it.template,
            ctype:       it.ctype || (String(it.template)[0] === "A" ? "A" : "B"),
            features:    Array.isArray(it.features) ? it.features : [],
            tested_to:   it.tested_to ?? null,
            train_bound: it.train_bound ?? null,
            seed:        it.seed ?? null,
            known_match: it.known_match || null,
            observed:    obs,
            metadata:    { ...(it.metadata || {}), m3_queue_version: QUEUE_VERSION },
          }]);
          if (ins.error) {
            // unique race: another writer inserted the same statement — treat as seen
            const again = await sb.from(TABLE).select("id").eq("statement", it.statement).maybeSingle();
            if (!(again.data && again.data.id)) { out.errors++; continue; }
          } else { out.inserted++; }
        }
        out.upserted++;
      } catch (e) { out.errors++; }
    }
    return out;
  } catch (err) {
    console.error("[M8] review-queue upsert error (non-fatal):", err.message);
    return { ...out, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// READ / TRIAGE
// ─────────────────────────────────────────────────────────────────
// Returns { rows, error }: error is non-null when the store is UNREACHABLE (e.g.
// the table doesn't exist yet) — distinct from an empty-but-healthy table (rows
// [], error null) — so the view can tell the operator to run the migration
// instead of silently claiming the queue is empty (the seed-pack precedent).
async function fetchQueue({ states, template, limit } = {}) {
  try {
    let q = getClient().from(TABLE)
      .select("id, statement, template, ctype, features, tested_to, seed, known_match, observed, review_state, seen_count, first_seen_at, last_seen_at")
      .order("template", { ascending: true })
      .order("statement", { ascending: true })
      .limit(limit || 500);
    if (states && states.length) q = q.in("review_state", states);
    if (template) q = q.eq("template", template);
    const { data, error } = await q;
    if (error) { console.error("[M8] review-queue fetch error (non-fatal):", error.message); return { rows: [], error: error.message }; }
    return { rows: data || [], error: null };
  } catch (err) {
    console.error("[M8] review-queue fetch error (non-fatal):", err.message);
    return { rows: [], error: err.message };
  }
}

async function fetchQueueByIds(ids) {
  try {
    const idList = (ids || []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
    if (!idList.length) return [];
    const { data } = await getClient().from(TABLE)
      .select("id, statement, template, review_state").in("id", idList);
    return data || [];
  } catch (_) { return []; }
}

/** Set the human triage verdict on one or more queue ids. Never throws. */
async function setReviewState(ids, state) {
  const out = { updated: 0 };
  if (!STATES.has(state)) return { ...out, error: `bad state ${state}` };
  const idList = (ids || []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
  if (!idList.length) return { ...out, error: "no ids" };
  if (process.env.REVIEW_QUEUE_DISABLED === "1") return { ...out, disabled: true };
  try {
    const { data, error } = await getClient().from(TABLE)
      .update({ review_state: state, reviewed_at: new Date().toISOString() })
      .in("id", idList).select("id");
    if (error) return { ...out, error: error.message };
    out.updated = (data || []).length;
    return out;
  } catch (err) {
    console.error("[M8] review-queue setReviewState error (non-fatal):", err.message);
    return { ...out, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// PACKETS (the deterministic ground truth the LLM narrates)
// ─────────────────────────────────────────────────────────────────
const QUEUE_GROUND = "This packet is the CURRENT, AUTHORITATIVE state of the review queue: narrate EXACTLY the families, items, and count shown above and nothing else. If earlier conversation or cross-session memory suggested the queue was empty or had different contents, IGNORE that — this packet supersedes it; NEVER call the queue empty when items are listed here. HONESTY CONTRACT: every item is a MACHINE-GENERATED conjecture from M8's own generator that merely SURVIVED deterministic falsification up to its stated bound — NOT established, NOT literature, NOT verified, NOT a discovery. Narrate each only as \"machine-generated, tested to N\". This is a TRIAGE worklist to help a human decide which (if any) to look at — it is NOT a list of findings or results. The grouping and ordering are ORGANIZATIONAL ONLY: never present the top of the queue, or any position, as the best, most-novel, or most-likely-true conjecture (there is no quality score — by design). A \"MATCHES KNOWN FORM\" tag means the general form is known mathematics (attribute that side to its author); a survivor WITHOUT the tag is NOT thereby novel — the check is a curated seed pack, not all of mathematics. Do not extrapolate beyond the stated bound.";

function renderQueueEmptyPacket() {
  return [
    `M3 SURVIVOR REVIEW QUEUE — EMPTY.`,
    `No machine-generated survivors are queued for review yet. Running the conjecture generator (e.g. "run the conjecture generator on collatz up to 100000") captures its survivors here for triage.`,
    `Say plainly that the queue is empty; do NOT invent queued conjectures.`,
  ].join("\n");
}

// Store unreachable (vs empty-but-healthy) — the seed-pack migration_required
// precedent: give the operator a precise instruction, never a silent empty queue.
function renderQueueUnavailablePacket(errMsg) {
  const missing = /does not exist|could not find the table|schema cache|relation .* does not/i.test(String(errMsg || ""));
  return [
    `M3 SURVIVOR REVIEW QUEUE — STORE NOT REACHABLE.`,
    missing
      ? `The m8_review_queue table does not exist yet. Tell Muhammad to run migrations/m8_review_queue.sql in the Supabase SQL editor (one-time), then try again — that is the only setup step.`
      : `The review-queue store could not be read (${String(errMsg || "unknown").slice(0, 160)}). Report this plainly.`,
    `Do NOT invent or list any queued conjectures.`,
  ].join("\n");
}

function renderQueuePacket(clusters, total, shown) {
  if (!total) return renderQueueEmptyPacket();
  const lines = [
    `M3 SURVIVOR REVIEW QUEUE — ${total} machine-generated conjecture(s) awaiting human triage (states new + kept; dismissed are hidden), grouped by structural template family. Computed in code by M8.`,
    `ORDERING IS TRIAGE / COVERAGE ONLY: within each family, survivors with NO match in our curated literature pack are listed first (a coverage heuristic carried from Build-16 so un-anchored candidates are visible — NOT a novelty verdict), then alphabetically. Position says NOTHING about which conjecture is more likely true, more novel, or higher quality. There is no quality score.`,
    ``,
  ];
  let rendered = 0;
  for (const cl of clusters) {
    if (rendered >= VIEW_CAP) break;
    lines.push(`[FAMILY ${cl.template}] (${cl.items.length})`);
    for (const it of cl.items) {
      if (rendered >= VIEW_CAP) { lines.push(`  ... (more in this family not shown)`); break; }
      const tags = [`tested to ${Number(it.tested_to || 0).toLocaleString("en-US")}`, `state ${it.review_state}`];
      if (it.known_match) tags.push(`MATCHES KNOWN FORM (${it.known_match}) — known general form; our finite-bound figure`);
      lines.push(`  #${it.id} [type ${it.ctype}] ${it.statement} (${tags.join("; ")})`);
      rendered++;
    }
  }
  lines.push(``);
  lines.push(QUEUE_GROUND);
  lines.push(`TRIAGE COMMANDS the user can give: "keep #<id>", "dismiss #<id>" (one or several ids, e.g. "dismiss #3 #4"), "mark #<id> reviewed". Dismissed items leave the default queue view.`);
  return lines.join("\n");
}

function renderTriagePacket(det, rows) {
  const verb = det.action;
  const present = (rows || []).map((r) => `#${r.id} (${r.template}: ${String(r.statement).slice(0, 90)})`);
  const missing = det.ids.filter((id) => !(rows || []).some((r) => String(r.id) === String(id)));
  return [
    `M3 REVIEW QUEUE — TRIAGE ACTION: marking ${det.ids.map((i) => "#" + i).join(", ")} as "${verb}".`,
    present.length ? `Items being updated:\n${present.map((p) => "- " + p).join("\n")}` : `(No matching queue items were found for the given id(s).)`,
    missing.length ? `WARNING: no queue item exists for id(s) ${missing.map((i) => "#" + i).join(", ")} — tell the user these were not found, do not pretend they were updated.` : ``,
    `Confirm to the user that the listed item(s) are now "${verb}". This is a triage / organization action ONLY — it makes NO claim about the conjecture's truth or novelty.${verb === "dismissed" ? " Dismissed items are hidden from the default queue view." : ""}`,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────────
// ORCHESTRATOR ENTRY (mirrors buildGraphContext's { text, mode, data } shape)
// ─────────────────────────────────────────────────────────────────
/**
 * VIEW → render the clustered triage packet (read-only). TRIAGE → STAGE the write
 * on data.write and render a confirm packet; the orchestrator applies it ONCE at
 * STORE (the notebook mutation-at-STORE pattern). Read-only at build; fails safe.
 */
async function buildReviewQueueContext(message, sessionId) {
  const det = detectReviewQueue(message);
  if (!det.mode) return { text: "", mode: null, data: null };
  if (process.env.REVIEW_QUEUE_DISABLED === "1") return { text: "", mode: null, data: null };
  if (isEphemeralSession(sessionId)) {
    return { text: renderQueueEmptyPacket(), mode: det.mode, data: { ephemeral: true } };
  }
  try {
    if (det.mode === "triage") {
      const rows = await fetchQueueByIds(det.ids);
      return { text: renderTriagePacket(det, rows), mode: "triage", data: { write: { ids: det.ids, state: det.action }, found: rows.length } };
    }
    const { rows, error } = await fetchQueue({ states: ["new", "kept"] });   // actionable worklist; dismissed hidden
    if (error) return { text: renderQueueUnavailablePacket(error), mode: "view", data: { error } };
    const clusters = clusterAndRank(rows);
    return { text: renderQueuePacket(clusters, rows.length), mode: "view", data: { items: rows.length, clusters: clusters.length } };
  } catch (err) {
    console.error("[M8] review-queue context error (non-fatal):", err.message);
    return { text: renderQueueEmptyPacket(), mode: det.mode, data: { error: err.message } };
  }
}

module.exports = {
  buildReviewQueueContext, upsertQueueItems, setReviewState, fetchQueue, detectReviewQueue,
  // exported for tests / reuse:
  clusterAndRank, renderQueuePacket, renderQueueEmptyPacket, renderQueueUnavailablePacket, renderTriagePacket, fetchQueueByIds,
  TABLE, QUEUE_VERSION, STATES,
};
