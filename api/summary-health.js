/**
 * M8 Summary Health — GET /api/summary-health
 * Makes the summarizer observable: recent run outcomes + status counts + total
 * summary rows. So memory failures are VISIBLE, not silent.
 */
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const runs = await sb
      .from("summary_runs")
      .select("session_id, status, new_rows, facts_count, error, created_at")
      .order("created_at", { ascending: false })
      .limit(25);

    const counts = {};
    for (const r of runs.data || []) counts[r.status] = (counts[r.status] || 0) + 1;

    const summaryRows = await sb
      .from("m8_conversations")
      .select("id", { count: "exact", head: true })
      .eq("role", "summary");

    res.status(200).json({
      ok: true,
      totalSummaryRows: summaryRows.count ?? null,
      recentStatusCounts: counts,
      recentRuns: runs.data || [],
      runsError: runs.error?.message || null,  // e.g. "relation summary_runs does not exist" → run the migration
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
