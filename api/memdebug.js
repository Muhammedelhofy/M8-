/**
 * M8 Memory Debug — GET /api/memdebug   (TEMPORARY — for verifying 2b memory)
 * Returns recent summary rows + canonical fact rows so we can confirm the
 * summarizer and fact-supersession actually work. Remove after verification.
 */
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const sums = await sb
      .from("m8_conversations")
      .select("id, session_id, role, memory_type, memory_key, content, is_current, importance, metadata, created_at")
      .eq("role", "summary")
      .order("id", { ascending: false })
      .limit(25);

    const facts = await sb
      .from("m8_conversations")
      .select("id, session_id, memory_key, content, is_current, memory_type, superseded_at")
      .not("memory_key", "is", null)
      .order("id", { ascending: false })
      .limit(40);

    res.status(200).json({
      ok: true,
      summaryCount: sums.data?.length ?? 0,
      summaries: sums.data ?? [],
      factCount: facts.data?.length ?? 0,
      facts: facts.data ?? [],
      error: sums.error?.message || facts.error?.message || null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
