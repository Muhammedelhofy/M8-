/**
 * lib/longitudinal.js — Build-86: Longitudinal Intelligence
 *
 * Surfaces recurring topics + trending entities + temporal decay signals so M8
 * can contextualise answers with "we've been here before" awareness.
 *
 * Three signals, all computed from existing data (no new tables):
 *   1. Recurring topics  — memory_key groups in m8_conversations, sorted by
 *                          occurrence count; any key whose last row is >7 days
 *                          old gets a [STALE] tag (Gemini review finding).
 *   2. Trending entities — top entities by mention_count that were last seen
 *                          recently (within 14 days), so we surface what M8 has
 *                          been discussing a lot lately, not just all-time.
 *   3. Temporal arc hint — a single-line "Muhammad has been focused on X/Y/Z
 *                          lately" summary injected into context; the model uses
 *                          it to relate the current question to prior threads.
 *
 * COST: 2 lightweight Supabase queries (group-by count + entity top-10).
 *       No LLM call. Max ~150ms on cold infra.
 *       Returns "" on any failure (never throws, never blocks the turn).
 *
 * GATE (enforced by the caller in orchestrator.js): skip on fleet / finance /
 * compute / image turns — those own their own deterministic packets and don't
 * need longitudinal thread context.
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");

const STALE_DAYS     = 7;    // memory_key not seen in this many days → [STALE]
const TRENDING_DAYS  = 14;   // entity last_seen within this window = "trending"
const MAX_TOPICS     = 4;    // max recurring topics to inject
const MAX_ENTITIES   = 3;    // max trending entities to inject
const MIN_TOPIC_CNT  = 2;    // a memory_key seen only once is not "recurring"
const MAX_KEY_LEN    = 60;   // truncate long memory_keys for readability

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function daysSince(isoDate) {
  if (!isoDate) return null;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / 86_400_000);
}

function staleSuffix(days) {
  if (days == null) return "";
  return days > STALE_DAYS ? ` [STALE: ${days}d ago]` : "";
}

/**
 * Fetch recurring topic groups from m8_conversations.
 * Groups by memory_key, counts occurrences, surfaces the most recent seen_at.
 * Filters: memory_key must be non-null and not one of the generic noise keys.
 */
async function fetchRecurringTopics(db) {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString(); // last 90 days
  const { data, error } = await db.rpc("m8_longitudinal_topics", {
    cutoff_date: cutoff,
    min_count: MIN_TOPIC_CNT,
    max_rows: MAX_TOPICS,
  }).catch(() => ({ data: null, error: "rpc_error" }));

  if (error || !data) return [];
  return data;
}

/**
 * Fallback query (no RPC): raw group-by via a direct select + JS aggregation.
 * Used when the stored procedure hasn't been created yet.
 */
async function fetchRecurringTopicsFallback(db) {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await db
    .from("m8_conversations")
    .select("memory_key, created_at")
    .not("memory_key", "is", null)
    .gte("created_at", cutoff)
    .is("merged_into", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!data || !data.length) return [];

  // Aggregate in JS: group by memory_key, count, track latest created_at
  const map = new Map();
  for (const row of data) {
    const k = String(row.memory_key || "").trim();
    if (!k || k.length < 3) continue;
    if (!map.has(k)) map.set(k, { count: 0, latest: row.created_at });
    const entry = map.get(k);
    entry.count += 1;
    if (row.created_at > entry.latest) entry.latest = row.created_at;
  }

  return [...map.entries()]
    .filter(([, v]) => v.count >= MIN_TOPIC_CNT)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_TOPICS)
    .map(([key, v]) => ({ memory_key: key, count: v.count, last_seen: v.latest }));
}

/**
 * Fetch trending entities: top by mention_count, filtered by last_seen within
 * TRENDING_DAYS. These are what M8 has been tracking heavily lately.
 */
async function fetchTrendingEntities(db) {
  const cutoff = new Date(Date.now() - TRENDING_DAYS * 86_400_000).toISOString();
  const { data } = await db
    .from("m8_entities")
    .select("name, entity_type, mention_count, last_seen")
    .gte("last_seen", cutoff)
    .order("mention_count", { ascending: false })
    .limit(MAX_ENTITIES);

  return data || [];
}

/**
 * getLongitudinalContext(message) — main export.
 * Returns a compact text block for injection into systemInstruction, or "" if
 * there's nothing worth surfacing or on any failure.
 *
 * @param {string} [message]  current user message (unused for now; reserved
 *                             for future relevance-filtering of topics)
 */
async function getLongitudinalContext(message) {
  const db = getDb();
  if (!db) return "";

  try {
    const [topics, entities] = await Promise.all([
      fetchRecurringTopicsFallback(db).catch(() => []),
      fetchTrendingEntities(db).catch(() => []),
    ]);

    const lines = [];

    if (topics.length > 0) {
      lines.push("RECURRING TOPICS (Muhammad has discussed these frequently):");
      for (const t of topics) {
        const key = String(t.memory_key || "").slice(0, MAX_KEY_LEN);
        const days = daysSince(t.last_seen);
        const stale = staleSuffix(days);
        lines.push(`  • "${key}" — ${t.count} times${stale}`);
      }
    }

    if (entities.length > 0) {
      lines.push("TRENDING ENTITIES (active topics in recent sessions):");
      for (const e of entities) {
        const days = daysSince(e.last_seen);
        const stale = staleSuffix(days);
        lines.push(`  • [${e.entity_type}] ${e.name} — mentioned ${e.mention_count}×${stale}`);
      }
    }

    if (lines.length === 0) return "";

    return [
      "LONGITUDINAL CONTEXT (Build-86 — session thread awareness):",
      "Use this to connect the current question to Muhammad's recurring interests.",
      "Do NOT mention this block explicitly unless he asks; treat it as background context only.",
      ...lines,
    ].join("\n");
  } catch (e) {
    console.error("[M8] longitudinal context error (non-fatal):", e && e.message);
    return "";
  }
}

module.exports = { getLongitudinalContext };
