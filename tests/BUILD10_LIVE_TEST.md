# Build-10 Research Memory Graph — Live Test Script

Type these in the live chat after deploy. There are no offline tests for this build
(no local Node) — this script IS the verification: write-time ingest, semantic recall
routing, honest-empty packets, provenance labels, the nightly sweep, and the routing
guards that keep the graph from hijacking other lanes.

## Prerequisites
**None new.** The graph reuses the existing Vercel env (`SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`). Migration `migrations/memory_graph.sql`
is already applied (2026-06-12). Kill switch if anything misbehaves: set
`GRAPH_DISABLED=1` in Vercel env and redeploy — notebook/chat keep working, graph off.

## A. Write-time ingest (notebook write → graph node)
**Type:** `notebook: log a conjecture on collatz — every Collatz orbit eventually reaches a power of 2`
**Expect:** normal notebook acknowledgment ("logged as a conjecture…"), unchanged UX.
**Verify in Supabase** (SQL editor):
`select kind, label, thread, source, note_id, embedding is not null as embedded from m8_graph_nodes order by id desc limit 5;`
→ a `conjecture` node on thread `collatz`, `source='code'`, with `note_id` set and (usually) `embedded=true`.
- ✗ FAIL if: the notebook ack errors or stalls >10s (graph must never block a write) · no node row appears.

## B. Semantic recall — "what do we know about X?"
**Type:** `what do we know about collatz?`
**Expect:**
- Answer narrates REAL graph contents: the conjecture from A (plus older collatz evidence once the sweep has backfilled), framed as recorded research.
- A conjecture is described as an OPEN claim, not a fact.
- ✗ FAIL if: invented findings/bounds not in the ledger · routed to web search · generic LLM essay about Collatz with no "recorded" framing.

**Type (semantic, not keyword):** `what do we know about the 3n+1 problem?`
**Expect:** same collatz nodes surface via cosine similarity (no literal "3n+1" anywhere in the ledger). This is the pgvector payoff — keyword recall can't do this.

## C. Contradiction query — honest none
**Type:** `what contradicts the collatz conjecture?`
**Expect:** "nothing recorded contradicts it" (plainly stated), optionally followed by clearly-framed own-analysis. May offer to log a counterexample/evidence.
- ✗ FAIL if: invents a recorded counterexample · presents general skepticism as ledger content.

## D. Honest empty — unknown topic
**Type:** `what do we know about the Riemann hypothesis?`
**Expect:** "nothing recorded yet about that in the research memory" + offer to start a thread. NO outside knowledge presented as recorded research (the CONFIRMED-EMPTY packet).
- ✗ FAIL if: an essay on Riemann zeta zeros appears as if it were stored research.

## E. Routing guards (must NOT route to graph)
- `what's my fleet profit today` → fleet packet (tool_decision `fleet`)
- `where are we on collatz?` → notebook thread briefing (tool_decision `notebook`, not graph)
- `where are we on our research?` → notebook registry (not graph)
- `what do you know about quantum computing?` → normal answer/search ("you" ≠ "we" — general knowledge, not memory recall)
- `prove that 2+2=4 using Lean` → lean lane (not graph)

## F. Nightly sweep + history backfill
**Trigger:** `GET https://m8-alpha.vercel.app/api/cron-summarize` (add `Authorization: Bearer <CRON_SECRET>` if set). Run it a few times — each run processes ≤6 notes + ≤20 embedding backfills.
**Expect JSON:** `{ ok: true, ..., graph: { embedded: n, ingested: n, skipped: n, ... } }`
**Verify in Supabase after 2–3 runs:**
- `select count(*) filter (where graph_processed_at is not null) as done, count(*) as total from m8_research_notes;` → `done` climbing toward `total`.
- `select kind, count(*) from m8_graph_nodes group by 1;` → theorem nodes (from the 4 lean_verified rows), conjecture/evidence/failed_attempt from history, maybe technique/sequence from extraction.
- `select rel, source, count(*) from m8_graph_edges group by 1, 2;` → derived_from (code) edges at minimum.
- ✗ FAIL if: `graph.error` in the response · `lean_rejected`/`status`/`next_step` rows got nodes · extraction minted a `theorem` node or a `formalizes` edge (forbidden — lean-verification-only).

## G. Eval hermeticity
Any `eval*` session asking B/C/D gets the CONFIRMED-EMPTY packet (zero DB reads) — probes must never read Muhammad's real research.

## What to check in traces (`request_traces`)
- `tool_decision = "graph"` on B/C/D; `notebook`/`fleet`/`lean` on E as listed.
- Vercel logs: `graph_context` events with `graphMode` (`recall`/`contradicts`) + `graphNodes`.

## Then
Full battery regression (`tests/eval`, run-eval-live) — expect no regression vs 4.68/5
baseline; the graph lane only claims turns no other lane wanted.
