# INGEST_MANIFEST — Ask-My-Docs

**Session:** Parallel Stream 2 — feat/askmydocs-ingest · Stream CV — feat/cv-ingest  
**Date:** 2026-06-28 (vault notes) · 2026-06-29 (CV PDF)  
**Status:** ✅ COMPLETE — 4 sources, 33 nodes, retrieval verified

---

## What was ingested

| # | Source title | Table row | vault_file | Words | Nodes |
|---|---|---|---|---|---|
| 1 | Muhammad Hofy — Career Background & Positioning | m8_knowledge_sources id=34 | `Projects/CV + LinkedIn.md` | 108 | 5 |
| 2 | Muhammad Hofy — Job Hunt Strategy 2026 | m8_knowledge_sources id=35 | `Projects/Job Hunt.md` | 380 | 5 |
| 3 | Muhammad Hofy — Operating Playbook & Fleet Expertise | m8_knowledge_sources id=36 | `Operating Playbook.md` | 350 | 5 |
| 4 | Mohamed El-Hofy — Full CV (Updated 2025) | m8_knowledge_sources id=37 | `Mohamed_ElHofy_CV_Updated.pdf` | 490 | 18 |

**Total: 4 sources · 33 concept nodes (IDs 247–279)**

---

## Concept nodes inserted

All in `m8_graph_nodes`, `source='external'`, `source_class='established'`, `mastery_state='ingested'`, `verification_state='unverified'`.

### Vault notes (IDs 247–261 · confidence=0.8 · source_doc_id 34/35/36)

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

### CV PDF (IDs 262–279 · confidence=0.9 · source_doc_id 37)

| Node ID | kind | label |
|---|---|---|
| 262 | claim | cv-ten-plus-years-ops-supply-fleet |
| 263 | entity | alkhair-alwafeer-current-role-oct2025 |
| 264 | claim | five-platform-portfolio-100-plus-fleet |
| 265 | entity | careem-egypt-supply-manager-2022-2025 |
| 266 | claim | acquisition-channel-zero-to-15pct-market |
| 267 | claim | indirect-to-direct-100pct-acquisition-shift |
| 268 | claim | cpad-best-in-class-digital-acquisition-channel |
| 269 | claim | rumi-migration-egypt-fleet-to-uber |
| 270 | claim | careem-multi-product-launch-bid-ask-wasally |
| 271 | entity | careem-senior-supply-lead-alexandria-2019-2021 |
| 272 | entity | careem-supply-lead-alexandria-2018-2019 |
| 273 | entity | vodafone-egypt-call-center-manager-2017 |
| 274 | claim | vodafone-top-achiever-q4-2016 |
| 275 | claim | clothes-factory-50pct-revenue-uplift |
| 276 | claim | nine-core-competencies-ops-supply |
| 277 | claim | education-bcom-english-alexandria-university |
| 278 | claim | languages-arabic-native-english-professional |
| 279 | claim | full-career-timeline-2012-present |

---

## Embedding decision

**DEFERRED — no embeddings inserted.** The `embedText()` call in `memory-graph.js` uses `gemini-embedding-001` (768 dims), which is a Gemini API call. No free non-Gemini embedding path exists in the current engine. All nodes were inserted with `embedding=NULL`.

**Impact:** The semantic search path (`match_kg_nodes` RPC) returns no hits for these nodes. The keyword ILIKE fallback in `searchKnowledgeGraph()` WORKS and was verified — 10 relevant nodes retrieved for fleet/supply/courier queries.

**Future path:** Once Gemini quota is available or a free embedding provider is added to the engine, run a backfill sweep on nodes with `source_doc_id IN (34,35,36,37)` to populate embeddings.

---

## Privacy wall — what was SKIPPED

| File / Field | Reason skipped |
|---|---|
| `Money & Runway.md` | Financial data: cash runway, Uber stock balance, bank figures — privacy wall |
| `Status.md` | References personal current salary figure ("6k") and net worth estimates — skipped |
| Specific current salary figures | Excluded from `Job Hunt.md` ingest (market-rate benchmarks from Cooper Fitch/Hays retained) |
| CV phone number | PII — excluded from raw_text and all node content |
| CV email address | PII — excluded from raw_text and all node content |

No salary or compensation figures appeared in the CV itself. All achievement metrics (15% market share, 50 agents, 70→100% direct, 100+ fleet, 50% revenue uplift) were retained as they are recruiter-facing, not private financial data.

---

## CV file — ✅ RESOLVED (2026-06-29)

The real CV PDF (`Mohamed_ElHofy_CV_Updated.pdf`) was ingested as source id=37 with 18 concept nodes (IDs 262–279). The placeholder note (`Projects/CV + LinkedIn.md`, source id=34) remains for context but the CV PDF is now the authoritative source for quantified achievements, role history, and competencies.

---

## Retrieval smoke test results

### Vault notes (2026-06-28)
Query: keywords `fleet`, `supply`, `courier` → **10 nodes returned** (all from ids 247–261). ✅  
Query: keywords `careem` → **5 nodes returned** including careem-supply-manager-egypt-8-years. ✅  
Query: keywords `pitch`, `outreach`, `transfer` → **2 nodes returned** (application pitch + warm intro). ✅

### CV PDF (2026-06-29)
Query: keyword `careem` → **9 nodes** from source_doc_id=37. ✅  
Query: keyword `supply` → **9 nodes** from source_doc_id=37. ✅  
Query: keyword `operations` → **4 nodes** from source_doc_id=37. ✅  
Total CV nodes in DB: **18/18**. ✅

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
