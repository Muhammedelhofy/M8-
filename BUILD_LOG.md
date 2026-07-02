# M8 Build Log

One row per build. Updated immediately when a build lands or is live-verified.
**Status keys:** ✅ LIVE-VERIFIED | 🟡 DONE (offline tests pass, live-verify pending) | 🔵 IN PROGRESS | ❌ BLOCKED

---

## Active builds

None.

---

## Shipped — Session 61 (2026-07-02, Fable 5 · strategy + E2 start)

| Build | What | Status | Tests | Commit | Date | Notes |
|-------|------|--------|-------|--------|------|-------|
| 168 | Context-packet telemetry (E2 step 1 MEASURE): per-turn section sizes → Vercel logs + m8_router_misses lane `ctx:packet`; sizes/labels only, no content | 🟡 DONE | 21/21 | a94bfce | 2026-07-02 | Shadow-only, kill switch `M8_CTX_TELEMETRY=off`; insert awaited ≤1.5s; feeds B-169 (the context diet / drift fix) |
| — | STRATEGY H2-2026 locked: goal + Track B bar (engine→census artifact→Mathlib, obstruction-driven) + STOP list + E1–E8 roadmap + model assignment | ✅ LIVE | — | f80b59d/9105b94 | 2026-07-02 | `STRATEGY_2026H2.md`; Career OS + ecommerce OUT of M8; NORTH_STAR + diagram updated |

---

## Shipped — Session 58 (2026-06-20)

| Build | What | Status | Tests | Commit | Date | Notes |
|-------|------|--------|-------|--------|------|-------|
| 104 | Auto Bolt fleet cron: daily server-side sync → Supabase fleet_data (no manual CSV) | 🟡 DONE | — | e061395 | 2026-06-20 | vercel.json: cron 21:00 UTC (midnight Riyadh). Needs SUPABASE_URL + SUPABASE_SERVICE_KEY in dashboard Vercel. No tests (no Bolt API in CI). |
| 102 | "re-extract knowledge" chat command + /api/ingest-extract-existing wiring | 🟡 DONE | 54/54 | 17197e7 | 2026-06-20 | Books never at Step 1 — command is plumbing for future repairs. Source 6 (team brief junk) NOT extracted intentionally. |

---

## Shipped — Session 57 (2026-06-20)

| Build | What | Status | Tests | Commit | Date | Notes |
|-------|------|--------|-------|--------|------|-------|
| 103 | Provider health: GET /api/health — 8 providers + Supabase + quota graceful degradation | ✅ LIVE-VERIFIED | — | c140547 | 2026-06-20 | /api/health confirmed 6 providers configured |
| 101 | Atomic ingest pipeline: /api/ingest-full (store+extract) + /api/ingest-extract-existing | 🟡 DONE | 45/45 | 68317db | 2026-06-20 | Audit: 0 books ever persisted; 5 sources are Collatz snippets; source_doc_id (NOT source_id) |
| 100 | Driver profile manager: "set Ahmad rental 1800 SAR" → writes DB; list/delete via chat | ✅ LIVE-VERIFIED | 78/78 | 2f822d3 | 2026-06-20 | Ahmad profile confirmed created 03:05 PM; placeholder row auto-cleared |
| 99 | Outcome-biased proposer: AVOID + VERIFIED blocks injected into M4 conjecture gen | 🟡 DONE | — | 36611a3 | 2026-06-20 | runConjectureGenWithFeedback() wired; m8_conjecture_outcomes still 0 rows |
| 97 | Uber CSV passive: platform-schemas + platform-merge cross-platform dedup via entity slug | 🟡 DONE | 18/18 | c9044df | 2026-06-20 | Uber field aliases unconfirmed vs real export — gate on preview rowCount |
| 96 | Driver nudge logging: every Arabic nudge → m8_nudge_log (tone + driver + date) | 🟡 DONE | — | ee733a5 | 2026-06-20 | m8_nudge_log still 0 rows — no live nudges fired yet |
| 95 | Fleet intelligence report: per-driver company P&L + recommended actions | 🟡 DONE | 51/51 | 76d896a | 2026-06-20 | Blocked on real driver cost data — B100 now live so this can be live-tested |
| 93 | Multi-platform CSV: Bolt CSV parse + platform-sync pipeline | 🟡 DONE | — | 1cfa039 | 2026-06-20 | platform-schemas.js + platform-ingest.js + platform-sync.js |
| 92 | Conjecture learning loop: verified Lean leaves → proposer feedback | 🟡 DONE | 4/4 | 63ca9db | 2026-06-20 | ⚠️ migration B92_conjecture_outcomes.sql NOT APPLIED — table dormant |
| 91 | P&L engine: canonical pnl-engine.js — rental + 50% Bolt bonus = company revenue | 🟡 DONE | 6/6 | da56dba | 2026-06-20 | ⚠️ orchestrator.js lines ~1030-1039 still inline old gross-minus-costs — needs rewiring |
| 90 | Entity slug: Arabic/Latin dedup — Mohammed == Muhammad == Arabic form | 🟡 DONE | 39/39 | 4ffb576 | 2026-06-20 | Migration B90_entity_slug.sql applied ✓ |

---

## Shipped — Session 55-56 (2026-06-19/20)

| Build | What | Status | Tests | Commit | Date | Notes |
|-------|------|--------|-------|--------|------|-------|
| 88 | Proactive follow-up chips: M8-CHIPS after knowledge/general turns | 🟡 DONE | — | 6d5403f | 2026-06-20 | Chips appear after reflector pass |
| 87 | Driver cost profiles: driver_cost_profiles table schema + getCostProfile/computeRealPnl | 🟡 DONE | — | 6d5403f | 2026-06-20 | Table exists; data entry now via B100 chat commands |
| 86 | Longitudinal intelligence: recurring topics + trending entities in context | 🟡 DONE | — | 6d5403f | 2026-06-20 | m8_longitudinal_topics RPC applied ✓ |
| 85e | Memory consolidation: soft-merge Jaccard≥0.6 dups + contradiction flags | 🟡 DONE | 43/43 | 1301b08 | 2026-06-20 | Migration B85e applied ✓ |
| 85d | Multi-hop reasoning chain: complex Qs decompose → step-by-step chain | 🟡 DONE | 53/53 | 28dedc0 | 2026-06-20 | Migration B85d applied ✓ |
| 85c | Self-reflection loop: Gemini second-pass scores relevance/overclaim/missed-source | 🟡 DONE | 72/72 | — | 2026-06-19 | General + knowledge lanes only; fleet/finance gated out |

---

## Pending actions (not builds — data or config)

| Item | Owner | Blocker |
|------|-------|---------|
| Add SUPABASE_URL + SUPABASE_SERVICE_KEY to **dashboard** Vercel env | Muhammad | Go to vercel.com → mhmbolt project → Settings → Environment Variables |
| Enter real driver profiles (rental/salary/fuel per driver) | Muhammad | B100 live — type in M8 chat when ready |
| Book ingestion: bn01.txt → M8 chat | Muhammad | Quota reset — try tomorrow morning |
| Live-test B95 fleet report with real driver data | Muhammad | After driver profiles entered |

---

## How to update this file

**When a build report lands:** add a row under the correct session header immediately.
**When live-verified:** change 🟡 to ✅ and add the verification detail in Notes.
**When a pending action is done:** delete the row from the Pending actions table.
