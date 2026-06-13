/**
 * M8 M2 Seed Pack endpoint — /api/seed-pack  (Build-15, S8)
 *
 * Plants the curated Collatz literature seeds (data/seed-packs/collatz-v1.json)
 * into the live research memory graph with source='external'. Exists because
 * this stack holds no local DB credentials by design — Vercel has the service
 * key, so seeding runs where the key lives.
 *
 *   GET  → read-only status: pack size, how many seeds already have live nodes,
 *          whether the m2_external_source migration is applied.
 *   POST → idempotent apply: upsert every seed (kind, norm_label dedup) +
 *          derived_from edge to the collatz-literature thread anchor.
 *
 * SECURITY POSTURE (spec critique A6): same CRON_SECRET rule as
 * /api/cron-summarize; seeds come ONLY from the bundled, git-reviewed JSON —
 * the request body is ignored entirely, so this endpoint cannot be used to
 * inject arbitrary nodes. MIGRATION SEQUENCING (A7): a CHECK-constraint
 * violation is detected and reported as migration_required instead of
 * half-seeding silently.
 */
const { createClient } = require("@supabase/supabase-js");
const { PACK, seeds, seedToNode, validatePack } = require("../lib/seed-pack");
const { upsertNode, ensureThreadNode, addEdge } = require("../lib/memory-graph");

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (req.method !== "POST") {
      // status: how many seeds are live, and is the migration in?
      const { count } = await supabase
        .from("m8_graph_nodes")
        .select("id", { count: "exact", head: true })
        .eq("source", "external");
      return res.status(200).json({
        ok: true, mode: "status", pack: PACK.pack,
        seeds_in_pack: seeds.length,
        external_nodes_live: count || 0,
        schema_errors: validatePack(),
        hint: "POST to apply (idempotent). Requires migrations/m2_external_source.sql first.",
      });
    }

    const schemaErrors = validatePack();
    if (schemaErrors.length) {
      return res.status(400).json({ ok: false, error: "seed pack fails schema validation", schemaErrors });
    }

    const thread = await ensureThreadNode(PACK.thread, "seed-pack");
    const results = [];
    let migrationRequired = false;

    for (const s of seeds) {
      const node = seedToNode(s);
      const up = await upsertNode({ ...node, sessionId: "seed-pack" });
      if (!up) {
        // upsertNode never throws — probe whether the CHECK constraint is the
        // blocker so the operator gets a precise instruction, not a shrug.
        const probe = await supabase.from("m8_graph_nodes").insert([{
          kind: "evidence", label: "__m2_migration_probe__", norm_label: `m2-probe-${Date.now()}`,
          source: "external", metadata: {},
        }]).select("id").single();
        if (probe.error && /check constraint|m8_graph_nodes_source_check/i.test(probe.error.message)) {
          migrationRequired = true;
          results.push({ id: s.id, ok: false, reason: "source CHECK constraint" });
          break;   // every subsequent seed fails the same way — stop, report
        }
        if (probe.data && probe.data.id) await supabase.from("m8_graph_nodes").delete().eq("id", probe.data.id);
        results.push({ id: s.id, ok: false, reason: "insert failed (see function logs)" });
        continue;
      }
      if (thread && thread.id && up.id) {
        await addEdge({ srcId: up.id, dstId: thread.id, rel: "derived_from", source: "external", noteId: null });
      }
      results.push({ id: s.id, ok: true, nodeId: up.id, existing: !!up.existing });
    }

    const okCount = results.filter((r) => r.ok).length;
    return res.status(migrationRequired ? 409 : 200).json({
      ok: !migrationRequired && okCount === seeds.length,
      mode: "apply", pack: PACK.pack,
      seeded: okCount, of: seeds.length,
      migration_required: migrationRequired,
      ...(migrationRequired ? { fix: "Run migrations/m2_external_source.sql in the Supabase SQL editor, then POST again." } : {}),
      results,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
