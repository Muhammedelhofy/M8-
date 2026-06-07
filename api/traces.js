/**
 * M8 Request Traces — GET /api/traces
 * Observability: recent per-request traces (intent, provider, search, memory,
 * latency, ok/error) so "M8 gave a weird answer" is inspectable, not guesswork.
 * Optional ?session=<id> filter.
 */
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const session = req.query?.session;

    let q = sb
      .from("request_traces")
      .select("session_id, intent, provider, recovered, search_fired, search_results, memory_rows, playbooks, latency_ms, ok, error, created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    if (session) q = q.eq("session_id", session);

    const { data, error } = await q;

    // Quick rollups for at-a-glance health.
    const rows = data || [];
    const providerCounts = {};
    let errorCount = 0, latencySum = 0;
    for (const r of rows) {
      if (r.provider) providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1;
      if (!r.ok) errorCount++;
      if (r.latency_ms) latencySum += r.latency_ms;
    }

    res.status(200).json({
      ok: true,
      count: rows.length,
      errorCount,
      avgLatencyMs: rows.length ? Math.round(latencySum / rows.length) : null,
      providerCounts,
      recent: rows,
      tableError: error?.message || null,  // e.g. "relation request_traces does not exist" → run the migration
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
