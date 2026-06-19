/**
 * GET /api/memory-health
 *
 * Shows everything M8 currently knows about Muhammad:
 *   - All canonical facts (profile + operational, is_current=true)
 *   - Recent session summaries (last 10)
 *   - Counts + oldest/newest fact dates
 *
 * Build-80 — visibility tool so Muhammad can see what persists across sessions.
 * Read-only. No auth needed beyond Supabase key being server-side only.
 */
const { createClient } = require("@supabase/supabase-js");

const RECALL_MIN_TRUST = 3;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: "Supabase not configured" });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // All current canonical facts
    const factsRes = await supabase
      .from("m8_conversations")
      .select("id, session_id, role, content, memory_type, memory_key, importance, created_at, metadata")
      .eq("is_current", true)
      .gte("trust_level", RECALL_MIN_TRUST)
      .in("memory_type", ["profile", "operational"])
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    const facts = factsRes.data || [];

    // Recent session summaries
    const summariesRes = await supabase
      .from("m8_conversations")
      .select("id, session_id, content, topic, importance, created_at, metadata")
      .eq("is_current", true)
      .gte("trust_level", RECALL_MIN_TRUST)
      .eq("memory_type", "session")
      .eq("role", "summary")
      .order("created_at", { ascending: false })
      .limit(10);

    const summaries = summariesRes.data || [];

    // Total raw turn count (all time, user sessions only)
    const countRes = await supabase
      .from("m8_conversations")
      .select("id", { count: "exact", head: true })
      .gte("trust_level", RECALL_MIN_TRUST)
      .in("role", ["user", "assistant"]);

    const totalTurns = countRes.count ?? null;

    const oldest = facts.length
      ? facts.reduce((a, b) => (a.created_at < b.created_at ? a : b)).created_at
      : null;
    const newest = facts.length
      ? facts.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
      : null;

    return res.status(200).json({
      summary: {
        canonical_facts:    facts.length,
        session_summaries:  summaries.length,
        total_turns_stored: totalTurns,
        oldest_fact:        oldest,
        newest_fact:        newest,
      },
      facts:     facts.map(f => ({ key: f.memory_key, type: f.memory_type, importance: f.importance, statement: f.content, stored_at: f.created_at })),
      summaries: summaries.map(s => ({ session: s.session_id, topic: s.topic, importance: s.importance, summary: s.content, at: s.created_at, entities: s.metadata?.entities || [] })),
    });
  } catch (err) {
    console.error("[memory-health] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
