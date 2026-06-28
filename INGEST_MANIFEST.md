# INGEST_MANIFEST — Ask-My-Docs

**Session:** Parallel Stream 2 — feat/askmydocs-ingest  
**Date:** 2026-06-28  
**Status:** ✅ COMPLETE — 3 sources, 15 nodes, retrieval verified

---

## What was ingested

| # | Source title | Table row | vault_file | Words | Nodes |
|---|---|---|---|---|---|
| 1 | Muhammad Hofy — Career Background & Positioning | m8_knowledge_sources id=34 | `Projects/CV + LinkedIn.md` | 108 | 5 |
| 2 | Muhammad Hofy — Job Hunt Strategy 2026 | m8_knowledge_sources id=35 | `Projects/Job Hunt.md` | 380 | 5 |
| 3 | Muhammad Hofy — Operating Playbook & Fleet Expertise | m8_knowledge_sources id=36 | `Operating Playbook.md` | 350 | 5 |

**Total: 3 sources · 15 concept nodes (IDs 247–261)**

---

## Concept nodes inserted

All in `m8_graph_nodes`, `source='external'`, `source_class='established'`, `mastery_state='ingested'`, `confidence=0.8`, `verification_state='unverified'`.

| Node ID | kind | label | source |
|---|---|---|---|
| 247 | claim | career-positioning-statement | 34 |
| 248 | claim | careem-supply-manager-egypt-8-years | 34 |
| 249 | claim | current-role-alkhair-alwaffer-riyadh | 34 |
| 250 | claim | bolt-api-fleet-dashboard-built | 34 |
| 251 | claim | full-pnl-across-5-major-platforms | 34 |
| 252 | claim | target-role-senior-ops-supply-ksa | 35 |
| 253 | claim | warm-intro-strategy-beats-cold-applications | 35 |
| 254 | entity | top-target-companies-ksa-2026 | 35 |
| 255 | claim | supply-side-counterparty-key-advantage | 35 |
| 256 | claim | application-pitch-template-ops-supply | 35 |
| 257 | claim | bolt-fleet-profit-model-rental-bonus-tiers | 36 |
| 258 | claim | daily-morning-driver-triage-routine | 36 |
| 259 | claim | driver-management-whatsapp-phone-approach | 36 |
| 260 | claim | 4-point-app-idea-test-framework | 36 |
| 261 | claim | settlement-dashboard-saas-business-idea | 36 |

---

## Embedding decision

**DEFERRED — no embeddings inserted.** The `embedText()` call in `memory-graph.js` uses `gemini-embedding-001` (768 dims), which is a Gemini API call. No free non-Gemini embedding path exists in the current engine. All nodes were inserted with `embedding=NULL`.

**Impact:** The semantic search path (`match_kg_nodes` RPC) returns no hits for these nodes. The keyword ILIKE fallback in `searchKnowledgeGraph()` WORKS and was verified — 10 relevant nodes retrieved for fleet/supply/courier queries.

**Future path:** Once Gemini quota is available or a free embedding provider is added to the engine, run a backfill sweep on nodes with `source_doc_id IN (34,35,36)` to populate embeddings.

---

## Privacy wall — what was SKIPPED

| File | Reason skipped |
|---|---|
| `Money & Runway.md` | Financial data: cash runway, Uber stock balance, bank figures — privacy wall |
| `Status.md` | References personal current salary figure ("6k") and net worth estimates — skipped |
| Specific current salary figures | Excluded from `Job Hunt.md` ingest (market-rate benchmarks from Cooper Fitch/Hays retained) |

---

## CV file — ACTION NEEDED

The `Projects/CV + LinkedIn.md` note in the vault is a **placeholder** — the "CV draft" section says "(to fill)" and has not been populated from the Session 2 interview yet. The background facts section (5 bullets) was fully ingested.

**🔴 Muhammad: provide the file path to your actual CV (PDF or DOCX) if one exists.** Once provided, that content can be chunked and ingested as additional source rows with richer quantified achievements.

---

## Retrieval smoke test results

Query: keywords `fleet`, `supply`, `courier` → **10 nodes returned** (all from ids 247–261). ✅  
Query: keywords `careem` → **5 nodes returned** including careem-supply-manager-egypt-8-years. ✅  
Query: keywords `pitch`, `outreach`, `transfer` → **2 nodes returned** (application pitch + warm intro). ✅

---

## What Stream 1 (B-158) still needs to do

Stream 1 wires the `docs` lane in the orchestrator so M8 knows to call `searchKnowledgeGraph()` when the user asks "what does my CV say about X" or "tell me about my job history". The content is in the DB and retrieval works — Stream 1 provides the routing door.

---

## Security advisory (from Supabase)

**`m8_router_misses` table has RLS disabled** — currently fully exposed to the anon key. Anyone with the anon key can read or modify every row.

**Do NOT auto-enable RLS without policies** (that would block all writes, including the miss-logging path). Suggested remediation SQL (run only after deciding on a policy):
```sql
ALTER TABLE public.m8_router_misses ENABLE ROW LEVEL SECURITY;
-- Then add a policy, e.g. allow inserts from service role only:
-- CREATE POLICY "service only" ON public.m8_router_misses USING (false) WITH CHECK (true);
```
This is low risk in practice (router misses contain only redacted message text and lane labels — no PII), but worth fixing when convenient.
