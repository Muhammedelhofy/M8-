# CLAUDE_CONTEXT.md
*M8 System — Master Context File*
*Last updated: 2026-06-12 (Build-13 / S6 — M1 structural probes + Odysseus-2 + coda-leak fix) · Read this at the start of every session*

---

## Who Muhammad Is

**Muhammad El-Hofy** — Senior Strategy & Operations Manager, Alkhair Alwafeer, Riyadh, Saudi Arabia. Egyptian. 10+ years fleet and courier supply across GCC and Egypt. Full P&L ownership for multi-client supply portfolio: Hunger Station, Noon, Keeta, Uber, Bolt. ~8 years at Careem, progressed to Supply Manager Egypt. Actively seeking senior Director/VP role in Riyadh.

**Non-engineer.** Cannot apply code patches manually. All deliverables must be complete, ready-to-use files or exact step-by-step instructions.

**Hard constraint — riba-free.** All financial instruments must be shariah-compliant (murabaha, sukuk, wakala only). Never suggest interest-bearing products.

---

## What M8 Is

**One compound intelligence. Permanent. Portable.**

M8 is Muhammad's personal intelligence that travels with him across every job, every project, and every research ambition. It compounds over time — operational context, domain knowledge, mathematical observations, failed conjectures, and research chains all accumulate. The destination is a system so integrated with how Muhammad thinks and works that running operations, building businesses, or probing unsolved problems without it becomes unthinkable. Every session makes it smarter than the last.

**Two tracks on one stack.**

### Track A — Operations Assistant (primary, immediate value)
Muhammad's daily work intelligence layer. Fleet ops, settlement calculations, supply analytics, client reporting, career advancement. This is what justifies the stack today. Builds for any job he goes to — not just Bolt/Alkhair Alwafeer.

**Active dashboard:**
- `Bolt/index.html` — Bolt fleet operations. 629KB, live, GitHub-deployed. M8 connected and answering live queries (fleet earnings, P&L, fleet metrics). This is the primary Track A tool.

**Archived (not in active use — logic is reusable):**
- `bikes_dashboard_v2.html` — bikes fleet cost/maintenance logic. Reuse in Phase 1 data automation when bikes data moves to Supabase.
- `dashboard.jsx` — Keeta/HS settlement logic (~7,370 lines React). Reuse in Phase 2 Settlement Validation Engine. Don't rebuild from scratch.

**What's missing in Track A (build order — updated June 2026 team synthesis):**
1. Fix intentClassifier deckgen misrouting bug (FIRST — next Claude Code session)
2. Run research_notes.sql migration (60 seconds — SECOND)
3. Live web search (Month 1 — highest daily ROI, Riyadh market moves fast)
4. Calendar integration (Month 1 — meeting context, briefings)
5. Email integration (Month 1-2)
6. Code execution (Month 2 — upgrades finance, BI, research simultaneously, highest leverage)
7. Ops Memory Layer — M8 knows Muhammad's context without being told (Month 2-3)
8. Data Automation — fleet Excel flows automatically, no manual uploads (Month 3)
9. Settlement Engine — auto-calculates valid DAs, generates client-ready report (Month 3-4)
10. Supply Gap Forecasting — projects next-week courier gaps by zone (Month 4-5)
11. Multi-Client Ops Dashboard — all 5 clients in one view (Month 6-9)
12. SaaS Product (Idea #1) — Settlement Dashboard as multi-tenant product, 150 SAR/month Pro tier (Month 12+)

### Track B — Research System (long-horizon)
Mathematical and scientific reasoning. Starts with Collatz. Builds toward Navier-Stokes. Destination: formally verified contribution to a frontier problem.

**The key insight:** Every Track B capability layer also strengthens Track A. Memory → ops context. Formal verification → settlement validation. Knowledge graphs → fleet KPI dependency mapping.

**Track B capability layers — Knowledge Acquisition Architecture (7 stages, validated by June 2026 team):**
1. Raw Ingestion — document/paper → clean text (not built)
2. Concept Extraction — LLM extracts S-P-O triples → Supabase (not built)
3. Knowledge Graph — linked concepts with relationships (not built)
4. Mastery State — "known / unknown / contradictory" tracking; M8 knows what it doesn't know (not built)
5. Clarification Gate — M8 asks Muhammad when it hits a knowledge gap (not built)
6. Active Retrieval — graph-augmented reasoning, not just document lookup (not built)
7. Formal Verification (Lean 4) — proof of formal results; deliberately deferred until stages 1–5 exist; needs Cloud Run, not Vercel-compatible

**Note on Lean 4 timing (resolved June 2026):** GPT, Grok, and Manus all say premature without stages 1–5. Gemini says build now. Decision: defer. Lean enters only after the knowledge graph holds conjectures worth formalizing.

**Track B research engine:** Collatz Build-1 ✅ (trajectory computation) → Build-2 next (multi-step exploration loops + Invariant Discovery Engine + Symbolic Trajectory Classifier) → Navier-Stokes (Milestone 2) → Riemann/BSD (long horizon).

**The meta-problem:** "The bottleneck isn't computing more examples. It's remembering what those examples imply." — GPT, June 2026 team session. Research memory is the prerequisite for everything else in Track B.

---

## Current State (L4 — June 2026)

**Stack:** Gemini Flash (primary) + Groq fallback + Supabase (`ltqpoupferwituusxwal`) + Vercel Hobby (7/12 functions used). Budget: ~$10/month.
**Live URL:** https://m8-alpha.vercel.app · **GitHub:** Muhammedelhofy/M8- (branch `main`, auto-deploys) · **HEAD:** 5543f67 (Build-4)

### Maturity Ladder
| Level | Status | What it means |
|---|---|---|
| L1 · Chatbot | ✅ Done | Basic conversation |
| L2 · Grounded | ✅ Done | Deterministic facts, no hallucination |
| L3 · Ops | ✅ 85% (frozen) | Fleet, finance, legal, EOSB live |
| L4 · Tool spine | ⚠️ ~75% | Hard-routes + LLM tool-decision layer |
| L5 · Exploration | ⚠️ ~40% | Notebook intelligence layer live (registry/summaries/inference); persistence blocked on migration |

### Architecture (what's live)
**Deterministic hard-routes (code owns the truth):**
- `lib/fleet.js` — Fleet spine. Bolt fleet data, per-driver P&L, model breakdown
- `lib/finance.js` — Finance P&L engine. Reads cost config from fleet_data, zero dashboard changes
- `lib/eosb.js` — End-of-service calculator. ½mo/yr ≤5yrs + 1/yr beyond; resignation reductions
- `lib/playbooks.js` — KSA legal orientation. Labour/MHRSD/Qiwa, Nitaqat, GOSI, CR/MISA, ZATCA
- `lib/companies.js` — Multi-company registry. Bolt profiled; Thrivve.sa/Noon registered-unprofiled
- `lib/discovery.js` — **Track B Phase 4 Build-2.** Discovery loop fusing compute + research notebook; multi-step exploration loops ("keep going for N steps") + follow-up loop from the ▶ coda. tool_decision='discovery'
- `lib/notebook.js` — Research ledger (facts + threads) **+ Build-4 Intelligence Layer (2026-06-12):** thread registry (`getActiveThreads` → registry packet for bare "where are we on our research?"), structured thread summaries (labelled CONJECTURE/EVIDENCE/STATUS/NEXT STEP sections), write-kind inference (`inferKind`: "I think…" → conjecture, "tried…dead end" → dead_end), hardened CONFIRMED-EMPTY packet (kills WHERE_ON confabulation), hermetic history-replay for eval reads. odysseus_redteam 10/10 + research_notebook 8/8 live. ⚠️ Acknowledges writes but NOT persisting — migration blocked
- State engine, orchestrator, intentClassifier, router — routing and tool-decision traces live

**Tool-decision routing order:** fleet → finance → eosb → state → discovery → notebook → company → compute → search

**✅ RESOLVED (verified live 2026-06-12):** `m8_research_notes` exists with real rows — notebook persistence is LIVE. (The old "migration blocked" note here was stale.)

- `lib/collatz-probes.js` — **Build-13 (2026-06-12, Fable-5 sprint S6): M1 Structural Probe Pack — LIVE, gate passed.** "run the structural probe pack on collatz up to N" → deterministic in-process census of 7 feature families (stopping times σ(n), total stopping time σ∞(n), max excursion, parity vectors on the Terras shortcut map, ν₂(3n+1), mod-6 residue census, record-setters) → LLM narrates the ground-truth packet → 7 NEUTRAL evidence notes persist (metadata.neutral → no supports edge; thread anchor only). Recall evidence cap GRAPH_EVIDENCE_CAP=4/turn (context-dilution guard). Detection requires a run-verb — recall asks stay with the graph lane; sentence-scoped for long messages. Algorithm verified vs literature 26/26 (`tests/m1-probes-verify.ps1`). Also Build-13: discovery-coda leak fixed (sentence-scoped detection + coda gated on evidenced run), research upgrade-pressure guard (Odysseus-2 finding), Odysseus-2 probe families designed (`tests/odysseus/ODYSSEUS2_DESIGN.md`, battery 38→49 probes).
- `lib/conjecture-gen.js` — **Build-14 (2026-06-12, Fable-5 sprint S7): M3-lite Conjecture Generator v1.** "run the conjecture generator on collatz up to N [seed k]" → seeded template-mining over the M1 features on a TRAIN census (test/10) → Type A (predicate+bound) + Type B (trend/frequency, exhaustive count) candidates → deterministic in-process falsifier over the full TEST range → vacuity floor (slack claims don't count, both cohorts) → gate: mined survival ≥2× a structure-blind random baseline (generation-quality metric, never truth). Survivors (cap 5/run) persist to thread `collatz-m3` as machine-generated tested-to-N conjectures → graph status `tested_to_<N>` → recall labels MACHINE-GENERATED + provenance warning; `latestConjectureNode` excludes them (supports-edge hijack guard). Lane sits ABOVE M1 (whose pack regex would claim generator asks); non-streamable. Offline mirror `tests/m3-conjecture-verify.ps1` (37/37); Odysseus-2 M3-armed corpus `tests/odysseus/battery-m3-armed.json` (runner: `-File`/`-SessionPrefix`). Design + adversarial review: `archive/BUILD_14_SPEC.md`; live script: `tests/BUILD14_LIVE_TEST.md`.
- `lib/memory-graph.js` — **Build-10 (2026-06-12, Fable-5 sprint S1+S2): Research Memory Graph — LIVE.** Typed nodes (conjecture/theorem/evidence/counterexample/failed_attempt/technique/sequence/research_thread) + typed edges (supports/contradicts/generalizes/depends_on/formalizes/derived_from) + pgvector embeddings (gemini-embedding-001 @768). Deterministic code-owned ingest at `persistNote()`; Fable-authored, Gemini-executed extraction in the nightly cron sweep; CHAT RETRIEVAL live: "what do I/we know about X?" / "what contradicts X?" → cosine top-k + 1-hop walk → provenance-labelled packet (tool_decision `graph`; CONFIRMED-EMPTY packet on no match). History fully backfilled (44 nodes/53 edges); battery 4.7/5 no regression. `GRAPH_DISABLED=1` kill switch. Design + adversarial review: `archive/BUILD_10_SPEC.md`; live script: `tests/BUILD10_LIVE_TEST.md`.

### What's missing
- Research persistence (blocked on migration above)
- Odysseus probe-generation automation OR OEIS probing (Session-7 candidates — see SESSION_HANDOFF_2026-06-12.md)
- Known-thread inference without a research keyword ("any progress on collatz?")
- Compound search→compute (sequential tool ownership — top pending L4 item)
- Lean 4 integration (Phase 3 — deliberately deferred, needs Cloud Run)
- Supabase config for company registry (add companies without deploy)
- Full eval baseline (~38 probes across 14 categories — slices only so far)

---

## Phase Plan (Summary)

| Phase | Timeline | Track A | Track B |
|---|---|---|---|
| 0 | Now–Month 1 | Document dashboards, define Supabase schema, ID top-3 friction points | Read Tao's Collatz paper, set up orbit computation, define verification standard |
| 1 | Month 1–3 | **Ops Memory Layer**, data automation, weekly ops summary, career context store | **Research Memory Store** in Supabase, first Collatz structural search |
| 2 | Month 3–6 | Settlement Validation Engine, cost anomaly alerts, supply gap forecast | FunSearch-style Collatz loop, first Lean 4 stub, Navier-Stokes blowup search start |
| 3 | Month 6–12 | Multi-client ops dashboard, LinkedIn/career automation, SaaS Idea #1 scope | Lean 4 pipeline end-to-end, first formally verified result, theorem dependency graph |
| 4 | Month 12+ | SaaS first customer, YouTube monetized, Director role secured | Novel observation on Navier-Stokes or Collatz, conjecture generation at 1/week |

---

## Research Context (Track B)

### AI Difficulty Ranking (1=easy for AI, 10=impossible)
- Collatz: 4 — **Track B first target**
- Navier-Stokes: 5 — **Milestone 2**
- Riemann / BSD: 7 — long horizon
- Yang-Mills: 8 — very long horizon
- Hodge / P vs NP: 9 — structural barriers

### Key Papers / Architecture to Know
- **AlphaProof Nexus (DeepMind, May 2026):** Proved 9 Erdős problems + 44 OEIS conjectures. Architecture: LLM + evolutionary search + Lean formal verification. This is the Track B template.
- **FunSearch (DeepMind, 2023):** LLM generation + evolutionary selection → novel mathematical results. Track B's computation engine model.
- **AlphaFold 2 (DeepMind, 2020):** Solved protein folding. Key lesson: AI-solvable when problem has data corpus + learnable regularity + verification oracle.
- **Tao 2019 Collatz partial result:** Most orbits eventually reach a value arbitrarily close to 1. This is the starting point for B0.1.

### The Meta-Problem
"How can a system accumulate understanding over years without forgetting, while generating and verifying new ideas?" — Research memory is the prerequisite for everything else in Track B.

### Resolved Problems (case studies for Track B design)
- Poincaré (2003): Perelman's Ricci flow + entropy functional → 7+ years
- Fermat (1995): Wiles' cross-domain bridge (modular forms ↔ elliptic curves) → 7 years
- Four Color (1976): First computer-assisted proof — verified 1,936 configurations
- Kepler (1998/2014): Hales' 250pp proof + Flyspeck Project for Lean verification
- CFSG (~2004): ~500 papers, ~10,000 pages, 50+ years — collective memory problem
- Protein Folding (2020): AlphaFold 2 — end-to-end deep learning, CASP14 solved

---

## Active Projects

1. **Bikes Fleet Dashboard** (bikes_dashboard_v2.html) — in use, stable
2. **Keeta/HS Dashboard** (dashboard.jsx) — in use, stable
3. **M8 Evolution** — this plan
4. **Existence Project** — Islamic YouTube series (long-form, pre-creation through Judgment Day). Ibn Kathir–inspired. No music, no ghayb visualization. Not commercial — sadaqah jariyah. *Apple = forbidden content (secret word). Mirror = uncertain content (secret word).*
5. **Arabic AI Tutorials YouTube** — commercial channel, 90-day monetization goal. Arabic-speaking professionals. Separate from Existence Project.
6. **Idea #1 — Settlement Dashboard SaaS** — Track A spin-off. MVP target: 4-6 weeks when Track A engine is ready.
7. **Job Search** — Senior Director/VP operations role, Riyadh. CV tailored. Actively applying.

---

## Non-Negotiables

1. Track A ships before Track B gets more investment
2. Research memory before any Track B research activity
3. Lean 4 verification before any result is called a "finding"
4. All financial instruments are riba-free
5. Existing dashboards are never disrupted

---

## Key Files in This Folder

| File | What It Is |
|---|---|
| `CLAUDE_CONTEXT.md` | **This file** — read at session start |
| `M8_Evolution_Plan_2026.md` | Full phase-by-phase roadmap with action items |
| `Unsolved_Problems_Brief.md` | Complete research brief — all 7 Millennium problems + resolved landmark problems + Track B architecture |
| `archive/` | Closed team-round briefs, synthesized team rounds, and finished BUILD_*_SPEC docs (06-10 through Build-18) |
| `../index.html` (Bolt/index.html) | **Primary Bolt fleet dashboard** — live, GitHub-connected, M8 answering live queries |
| `bikes_dashboard_v2.html` | Archived — bikes fleet logic, reuse in Phase 1 |
| `dashboard.jsx` | Archived — Keeta/HS settlement logic, reuse in Phase 2 |

---

## How to Use This File

**If you're a new Claude session (any account):** Read this file. You now know the plan, the current state, what's been built, and what comes next. Muhammad doesn't need to re-explain anything.

**If something seems inconsistent with what Muhammad tells you:** Trust Muhammad's current message. This file describes the state as of 2026-06-10. Update this file when phases are completed.

**Next immediate actions (updated 2026-06-12):**

1. Muhammad: run `migrations/research_notes.sql` in Supabase (ltqpoupferwituusxwal) — 60 seconds; unblocks real notebook persistence (everything else about the notebook is now live)
2. Next Claude Code session: pick from SESSION_HANDOFF_2026-06-12.md options — recommended Odysseus probe-generation automation or OEIS probing
3. Done in prior sessions: multi-step exploration loops (Build-2), red-team battery (Build-3), notebook intelligence layer (Build-4 — registry / structured summaries / kind inference / hardened empty packet)

Cowork/Chat — background:
- Verify whether Tavily and voice.js actually exist in the codebase (Grok referenced both as live)
- Profile Thrivve.sa and Noon in companies.js

---

## Save Ritual — End of Session Checklist

Run this at the end of EVERY substantive M8 session:

**Step 1 — Architecture diagram** (Cowork)
Rebuild or annotate the M8 architecture diagram if new layers/modules changed status.

**Step 2 — CLAUDE_CONTEXT.md** (Cowork · this file)
Update: current state, what changed this session, next immediate actions. Change the "Last updated" date.

**Step 3 — M8_Evolution_Plan_2026.md** (Cowork)
Tick off completed items. Update "Next build" for the phase you're in.

**Step 4 — memory/project_m8_plan.md** (auto-memory)
Sync the North Star, capability build order, current state (maturity ladder position, what's live). This is what any new Claude session reads first.

**What counts as "substantive":** Any session where you built something, resolved a decision, completed a phase item, or updated the plan. Skip the ritual only for pure conversation sessions with no changes.

---

*M8 is not a chatbot. It is a compound intelligence — getting more useful every month because it remembers, learns, and builds on everything that came before.*
