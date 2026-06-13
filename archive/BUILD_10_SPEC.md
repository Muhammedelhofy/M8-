# Build-10 — Research Memory Graph

*Authored by Fable 5, Session 1 of the Fable-5 sprint (2026-06-12). Status: foundation shipped
(this session) → retrieval into chat ships Session 2.*

**The unanimous team signal:** persistent, connected research memory. GPT's "Research Memory",
Manus's Knowledge Graph ontology, Gemini's pgvector semantic memory — all the same missing layer.
Without it, OEIS + Lean stay isolated experiments; with it, every verified theorem compounds.

---

## 0. Adversarial design review (mandated — ground rule 4)

Critiques raised against this design **before** code, and what they changed:

| # | Attack | Verdict | Mitigation baked in |
|---|--------|---------|---------------------|
| 1 | **Write-only graph.** Session 1 builds ingestion, session 2 retrieval. If session 2 slips past June 22, we shipped dead weight. | Real | The `m8_graph_match` RPC + `graphMatch()` / `fetchNeighbors()` retrieval core ship in Session 1. Session 2 is *wiring*, not building. |
| 2 | **Entity-resolution trap.** LLM extraction fragments the graph: "Collatz conjecture" / "the 3n+1 problem" / "collatz" become 3 nodes; the graph becomes soup. | Real — the classic KG failure | Deterministic code-owned spine FIRST (notebook entry → node is 1:1, zero LLM). Extraction may only ADD capped `technique`/`sequence` entities + classify generic notes. Exact dedup via unique `(kind, norm_label)` upsert. Cosine-similarity node *merging* is a documented fast-follow — deliberately NOT built (over-engineering before data exists). |
| 3 | **Hot-path latency + quota.** Embedding + extraction on every notebook write = seconds added + scarce Gemini free quota burned on background work. | Real | Write-time = deterministic node + ONE embed call, budget-capped (2.5s) and fail-safe (node lands without embedding). LLM extraction runs ONLY in the nightly cron sweep (existing function — no new Vercel function, 7/12 cap respected). Embedding backfill also in the sweep. |
| 4 | **Hallucination surface.** An LLM-written graph violates the M8 honesty contract (code owns truth; the LLM narrates). | Real — the one that matters most | Provenance is first-class: every node and edge carries `source: 'code'\|'extraction'` + `note_id`. Extracted edges get `confidence 0.7`, code edges `1.0`. Extraction output is schema-validated against the ontology whitelist, hard-capped (≤5 entities, ≤8 edges), and silently dropped on any violation. Session-2 retrieval packets MUST label extracted facts as machine-extracted. |
| 5 | **Cold start.** 31 notes exist; ~⅓ are junk `lean_rejected` rows. Retrieval demos will look thin; temptation is to over-build ranking. | Real | Sweep auto-backfills history (lean_rejected rows are marked processed and skipped). Ranking stays simple (cosine + 1-hop walk) until the graph earns sophistication. |
| 6 | **Thread mismatch breaks lean auto-linking.** Live data: verified theorems land on throwaway slug threads (`prove-that-2-2-4-using-lean`), NOT on `collatz`. Same-thread conjecture linking will usually find nothing. | Confirmed from live rows | Deterministic link fires only when a conjecture node genuinely exists in the theorem's thread; otherwise the theorem node stays unlinked-but-embedded (semantic recall still finds it) — an honest miss beats a forced wrong edge. Cross-thread linking is extraction's job later. |
| 7 | **Scope creep into literature ingestion.** "Knowledge graph" invites paper-ingestion ambitions. | Pre-empted | Build-10 ingests ONLY the research notebook. Literature ingestion is a named Session-5 middle layer. |
| 8 | **Embedding model lock-in.** `vector(768)` hard-codes a dimension. | Accepted | `embedding_model` recorded per node; a model change means re-embed via sweep. 768 (gemini-embedding-001, normalized) balances quality/storage. |

## 1. Ontology (canonical — per sprint plan)

**Node kinds (8):**
`conjecture` · `theorem` · `evidence` · `counterexample` · `failed_attempt` · `technique` · `sequence` · `research_thread`

**Edge relations (6), with pinned directions:**

| Edge | Direction convention |
|------|---------------------|
| `supports` | evidence → conjecture |
| `contradicts` | counterexample / evidence(against) → conjecture |
| `formalizes` | theorem → the conjecture it machine-verifies |
| `derived_from` | any node → its `research_thread` anchor (provenance) |
| `generalizes` | conjecture → the conjecture it subsumes |
| `depends_on` | any node → a `technique` / prerequisite node |

**Deterministic notebook→graph mapping (code-owned, write-time):**

| Notebook entry | Graph node | Code-owned edges |
|---|---|---|
| `conjecture` | `conjecture` | derived_from → thread |
| `evidence` (status `lean_verified`) | **`theorem`** | formalizes → latest conjecture in thread (if any); derived_from → thread |
| `evidence` (stance for/null) | `evidence` | supports → latest conjecture in thread; derived_from → thread |
| `evidence` (stance against) | `evidence` | contradicts → latest conjecture; derived_from → thread |
| `counterexample` | `counterexample` | contradicts → latest conjecture; derived_from → thread |
| `dead_end` | `failed_attempt` | derived_from → thread |
| `note` (status `lean_stated`) | `conjecture` (status lean_stated — formally stated, NOT proven) | derived_from → thread |
| `note` (generic) | none deterministically — sweep extraction may classify it | — |
| `note` (`lean_rejected`) / `status` / `next_step` | never (thread state / noise, not knowledge) | — |

## 2. Storage (migration `migrations/memory_graph.sql` — applied 2026-06-12)

- `extensions.vector` (pgvector 0.8) enabled.
- `m8_graph_nodes` — kind-checked, `unique (kind, norm_label)` for idempotent upsert,
  `embedding vector(768)` + HNSW cosine index, `source`/`note_id`/`confidence` provenance,
  `enriched_at` marks extraction done. RLS enabled, no policies (service-role only, like the notebook).
- `m8_graph_edges` — rel-checked, `unique (src_id, dst_id, rel)`, cascade on node delete.
- `m8_research_notes.graph_processed_at` (additive column) — sweep cursor.
- RPC `m8_graph_match(query_embedding, match_count, min_similarity)` — cosine top-k
  (supabase-js can't express vector ops; the standard RPC pattern).

**Embeddings:** `gemini-embedding-001` @ 768 dims (`outputDimensionality`), L2-normalized
client-side (required below 3072), `taskType` RETRIEVAL_DOCUMENT for nodes / RETRIEVAL_QUERY
for queries. Free tier; separate quota bucket from chat generation.

## 3. `lib/memory-graph.js` (vanilla Node, CommonJS, fail-safe everywhere)

- `ingestNote(note, opts)` — the deterministic spine: ensure thread node → map kind → upsert
  primary node (budgeted embed) → code-owned edges. Called from `persistNote()` (one choke
  point covers all 6 orchestrator call sites + the streaming path). `GRAPH_DISABLED=1` kill
  switch. Lazy-required so a graph bug can never take down the notebook.
- `extractFromNote(note, primaryNode)` — **the crystallization pattern (Manus): prompts written
  by Fable 5, executed by Gemini Flash.** Strict-JSON extraction of `technique`/`sequence`
  entities, a classification for unclassified generic notes, and ontology-valid edges.
  Validated hard; anything off-schema is dropped, never inserted.
- `runGraphSweep()` — nightly (wired into existing `/api/cron-summarize`): (1) embedding
  backfill for nodes that missed their write-time embed, (2) full ingest + extraction for
  unprocessed notes (history backfill happens automatically, oldest first, budget-capped per
  run so it never starves the summary sweep or the quota).
- `graphMatch(queryText)` + `fetchNeighbors(nodeIds)` — retrieval core (cosine top-k + 1-hop
  graph walk). **Session 2** wires these into chat ("what do I already know about X?",
  "what contradicts X?") with a budget-capped packet.

## 4. Honesty contract (unchanged, extended)

The graph is a LEDGER VIEW, not a thinking surface. Code owns every deterministic node/edge;
extraction output is provenance-tagged, confidence-discounted, schema-validated. Retrieval
(Session 2) renders a deterministic packet the LLM narrates — it never invents nodes, and a
`conjecture` node is never narrated as a result. `lean_verified` is the ONLY path to a
`theorem` node.

## 5. Open items → Session 2

1. Retrieval path into chat: detection ("what do we know about X？" / "what contradicts X?"),
   graph-walk + cosine recall, budget-capped packet, provenance labels.
2. `tests/BUILD10_LIVE_TEST.md` + full battery regression + live A–E + deploy.
3. First live sweep run (history backfill of the 31 existing notes) + verify node/edge counts.
4. Fast-follows logged, NOT built: similarity-based node merging; cross-thread theorem→conjecture
   linking via extraction; `notebook entries UI` graph badges.
