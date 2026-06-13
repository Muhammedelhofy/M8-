# M8 Evolution Plan
*Muhammad El-Hofy — Senior Strategy & Operations Manager, Riyadh*
*Version: 2026-06-12 (S5 revision, Fable 5 window) · Living document — update each phase*
*2026-06-13 — Epistemic Classification Axis added as a PARKED Phase-5 ticket (5-model team round complete); current-state note added below the priority stack. Active track: **M4-manual + Lean**.*
*2026-06-13 — Build-18 (M4-manual) SHIPPED + live-verified (`7760947`): lemma-DAG scaffolding, leaf discharge via Lean, "leaves verified k/m, NOT proven" honesty held live. Active track now **L5 (gated)**; Phase-5 Epistemic Classification Axis remains PARKED.*

---

## What M8 Is

M8 is **two systems running on one stack:**

- **Track A — Operations Assistant:** Muhammad's daily work intelligence layer. Fleet ops, settlement calculations, supply analytics, client reporting, career advancement. This is the immediate value engine. This is what justifies the stack's existence today.
- **Track B — Research System:** Long-horizon mathematical and scientific reasoning. Starts with Collatz. Builds toward Navier-Stokes. Destination: a system that can contribute verifiable results to frontier problems.

These are not in competition. Track A pays for Track B's existence. Track B builds the infrastructure that makes Track A dramatically more powerful over time. The capability layers built for research (memory, reasoning, verification) are the same layers that make the ops assistant truly intelligent.

---

## Current State Assessment (Updated 2026-06-12 — S5, post Builds 8–12)

**Maturity level: L4 (~80% tool spine)**
Live at https://m8-alpha.vercel.app · GitHub: Muhammedelhofy/M8-

### Stack
- **Model:** Gemini Flash (primary) + Groq fallback · Fable 5 = the *engineer* in Claude Code sessions, never the paid runtime
- **Database:** Supabase (`ltqpoupferwituusxwal`) — fleet data + research notebook + memory graph (pgvector)
- **Hosting:** Vercel Hobby + Cloud Run `m8-lean-check` (Lean 4 + Mathlib, pinned `b580ec53f9e3`)
- **Budget:** ~$10/month
- **Active dashboard:** `Bolt/index.html` — Bolt fleet operations. Primary Track A tool.

### What's Built (hard-routes — code owns truth)
| Module | What it does | Status |
|---|---|---|
| `lib/fleet.js` / `finance.js` / `eosb.js` / `playbooks.js` / `companies.js` / `deckgen.js` | Track A operator-assistant breadth (all five live 2026-06-10) | ✅ Live |
| `lib/discovery.js` | Bounded verification runs + looped exploration + OEIS probing (Build-8) | ✅ Live |
| `lib/notebook.js` | Research ledger — persistent, threads + kinds | ✅ Live |
| `lib/memory-graph.js` | Build-10 — nodes/edges + pgvector recall, anti-confabulation packets | ✅ Live |
| `lib/lean.js` + Cloud Run | Builds 9–12 — formalize → /check → verified/stated/rejected; golden corpus 37/37; bench 0.3→0.65; `lean_stated` live | ✅ Live |
| `tests/odysseus/` | Builds 11+13 — 49-probe adversarial battery incl. Odysseus-2 (faithfulness + self-contamination), the immune system | ✅ Runs per build |
| `lib/collatz-probes.js` | Build-13 — M1 structural probe pack: 7-family deterministic Collatz census → neutral evidence nodes; recall evidence cap | ✅ Live |

### What's Still Missing (the middle layers — see below)
| Layer | Status | Gap |
|---|---|---|
| Structural probe pack (M1) | ✅ Build-13 (S6) | Shipped + gate passed — features feed M3-lite next |
| Literature seed packs (M2) | ❌ Not started | Graph has zero external knowledge; novelty gate impossible |
| Conjecture generator (M3) | ❌ Not started | The Hypothesize rung — M8 has never generated a conjecture unprompted |
| Lemma-DAG scaffolding (M4) | ❌ Not started | Nothing between lean_stated and lean_verified |
| Autonomous loop (L5) | ⏸️ Gated | A cron over M1–M4; ships LAST, gated on M3 metrics |
| Proactive alerting (Track A) | ❌ Not started | M8 doesn't push yet |

---

## The Architecture Principle

Every capability built for Track B also strengthens Track A. This is not a coincidence — it is the design:

| Track B Layer | Track A Application |
|---|---|
| Research Memory | Remembers Muhammad's ops context, clients, flags, history across sessions |
| Formal Verification | Validates settlement calculations before they're presented to clients |
| Knowledge Graphs | Maps dependencies between fleet KPIs, so M8 knows which metric causes which |
| Conjecture Generation | Generates hypotheses about why courier attrition is rising or why cost is spiking |
| Computation Engine | Runs scenario models over fleet data in real time |

Build once. Use everywhere.

---

## The Middle Layers (S5, 2026-06-12 · REV 2 after team round) — between [Lean + graph] and [autonomous exploration]

*This section is the S5 deliverable: the layers Track B must build, in order, before the
L5 loop is anything but a spam automator. Each ships as a thin slice behind a measurable
gate — the Build-12 discipline (benchmark 0.3→0.65, data not opinions).*

> **REV 2 (team round 2, 2026-06-12 — see `archive/M8_Team_Round2_Synthesis_2026_06_12.md`):**
> order revised to **M1 → M3-lite → M2 → M3-full → M3.1 → M4-manual → L5** (generator
> before literature, 3–1; survivors never promoted past tested-to-N until the novelty
> gate exists). M3 schema gains **Type B trend/statistical conjectures** (seeded-
> deterministic evaluation, "observed through N" narration). M3 gate hardened to
> **≥2× random-baseline survival + non-triviality floor**; M3-full adds **zero false
> positives on held-out literature seeds**. **M4 demoted to M4-manual** (human-architected
> DAGs; M8 formalizes leaves; entry = 50 candidates → 5 survivors → 1 human-interesting;
> gate = ≥1 leaf with ≥2 Mathlib imports + induction vs an invalid-shortcut probe).
> Two adopted risks: **graph self-contamination** (Odysseus-2 self-contamination family
> gates M3-full/L5) and **context dilution** (hard per-turn recall cap, built in M1).
> NORTH_STAR.md carries the canonical REV 2 ladder; details below are the original S5
> text where not superseded.

### Adversarial critique first (why not just build the loop?)
1. **Autonomy is a multiplier, not a capability.** The L5 loop is a scheduler over lanes
   that exist. The Hypothesize rung does not exist — M8 has never generated a conjecture
   unprompted. Build the loop first and it automates spam.
2. **The graph only knows what we typed into it.** Every node is self-generated. Without
   a literature baseline the system cannot distinguish novel from known-since-1976.
3. **Nothing at $10/month does proof search.** The Lean lane's honest ceiling is faithful
   statements + textbook-lemma discharge via the tactic allowlist.
4. **Bound-pushing is theater.** Collatz is verified to ~2^71 (Barina). Our bounded runs
   validate the pipeline, not the mathematics.
5. **Millennium-tier language in this plan was fantasy at current scale.** De-scoped
   explicitly below.

### M1 — Structural Probe Pack (Collatz-first) · 1 build
Discovery-lane extension producing **structured features** into the graph, not bounds:
stopping time σ(n), total stopping time, max excursion, parity vectors, 2-adic valuation
profiles, residue-class census, record-setters. These are the observations the conjecture
engine will generalize over. Reuses sandbox + notebook + graph as-is.
**Gate:** ≥3 feature families computed, logged as `evidence` nodes, queryable from chat.

### M2 — Literature Seed Packs (curated, never crawled) · 1 build
New node provenance `external` + source field. 20–50 hand-curated known results per
problem (Collatz: Terras 1976 almost-every-orbit stopping time; Tao 2019 almost-all
almost-bounded; Barina computational bound; known cycle constraints). Ingested through
the existing extraction path. Unlocks the **novelty gate**: "is this already known?" is a
graph query that runs before any conjecture is called interesting.
**Gate:** 10/10 on planted known/unknown probes. **Non-goal:** any PDF-parsing pipeline.

### M3 — Conjecture Generator v1 (the Hypothesize rung) · 1–2 builds
Input: M1 features + M2 known results. The LLM proposes candidates in a **constrained
schema** — every conjecture must be a computable predicate with an explicit test bound,
or it is not admitted. A deterministic falsifier runs each candidate in the sandbox
(10^5–10^7 budget). Survivors → `conjecture` nodes (machine-generated, tested-to-N,
never "true"). Failures → `failed_attempt` nodes (data, not noise). Hard cap per run +
dedup-against-graph = spam guard.
**Gate:** surviving non-known conjectures per batch tracked as the benchmark metric ·
zero honesty violations under a new Odysseus probe family targeting this lane.

### M4 — Lemma-DAG Proof Scaffolding · 1–2 builds
The missing ground between `lean_stated` and `lean_verified`: decompose a target into a
lemma DAG (`depends_on` edges), discharge leaf lemmas with allowlisted tactics
(`ring`/`omega`/`decide`/`simp`/`norm_num`), let sorried parents type-check as scaffold,
track % discharged in the graph. **Honest ceiling, stated up front:** textbook lemmas,
not open problems — the deliverable is a growing *verified-lemma library*, and the
formal skeleton of each conjecture, not proofs of conjectures.
**Gate:** one scaffold with ≥3 machine-verified leaf lemmas as graph nodes.

### Then — and only then — L5
The autonomous loop = a budgeted cron running M1 (observe) → M3 (hypothesize/test) →
M4 where applicable (record/formalize), unattended. **Promotion gate:** 3 consecutive
unattended runs with zero Odysseus regressions and at least one surviving conjecture.
Autonomy ships last because it multiplies whatever quality exists at the time.

### What would waste months (named, per the brutal-honesty mandate)
- **Brute-force bound-pushing** on Collatz or any verified-to-astronomical-bounds problem.
- **A general literature-ingestion pipeline** (PDF parsing, citation graphs) before
  curated seed packs have proven the graph can even use external knowledge.
- **LLM proof search on open problems** — at any budget we can afford, and arguably at
  any budget. M4's lemma-discharge ceiling is the honest target.
- **Ungated conjecture generation** — without the deterministic falsifier and the novelty
  gate, M3 produces infinite plausible-sounding noise.
- **Navier-Stokes / Millennium-tier work** — PDE numerics, spectral methods, none of it
  fits this stack. **De-scoped.** Track B stays in number theory / combinatorics
  adjacency where the sandbox + Lean + OEIS stack actually bites.

### The honest 12-month statement
The realistic outcome of these layers is **not** a novel citable result — it is a
compounding research instrument: a curated knowledge base, a falsifiable-conjecture
pipeline with survival metrics, and a growing machine-verified lemma library. A novel
result is a lottery ticket whose expected value rises with every layer; the
infrastructure *is* the expected value. The claim we never make: that we're already there.

---

## Parked — Epistemic Classification Axis ("Unforbidden Knowledge") · Phase-5, demand-triggered

> **Status: PARKED — spec frozen 2026-06-13 after a 5-model team round (Grok · M8 · GPT · Gemini · Manus + Claude).** This is a *demand-triggered* ticket, **not a fixed rung**. The active track stays **M4-manual → L5**. Brief: `archive/M8_Team_Brief_Epistemic_Classification_2026_06_13.md`.

**What & why.** A new graph axis for the *epistemic standing of an idea* — distinct from the existing `source` (provenance) and `status` axes — so M8 can engage speculative/fringe topics (Vortex Math, Wolfram Physics, Simulation Theory, Cymatics, Electric Universe, prime-mysticism…), surface the *real math inside them*, and **never present the speculative leap as established**. It extends M8's honesty-label discipline; it is the credibility moat, **not** a pivot to pseudoscience.

**Un-park when ANY trigger fires** (until then, building it is premature — single-user, and Muhammad already knows what's fringe):
1. M8 ingests **external material at volume** (well beyond the ~19 curated M2 seeds).
2. M8 serves a **second / untrusted user** who can't self-assess a fringe claim.
3. **M4 starts ingesting fringe-adjacent human input** → the surgical exception below becomes load-bearing.

**The design — 4 rules (the gems that survived synthesis):**

1. **Decomposition = TWO linked nodes.** Split each idea into its TRUE KERNEL (`the 1-2-4-8-7-5 mod-9 digit cycle is real arithmetic` → `established`) —`spawns`→ its SPECULATIVE LEAP (`…therefore it is the energy-geometry of reality` → `speculative`). **Two nodes, never one combined node** — kernels are *shared* across many leaps (mod-9 → Vortex, Tesla 3-6-9, numerology), and a combined node *pollutes the embedding* so a math search drags the fringe half into context. Recall invariant: never surface a leap without its kernel + both labels.

2. **ONE neutral bucket: `speculative`** → full axis = `established | conjecture | empirical | speculative | refuted` (5 buckets). **CUT from the original pitch:** the 6-bucket `speculative_framework` vs `fringe_pattern` split. Sorting "serious science" from "crackpot" is a sociological vibe-judgment — exactly what M8's deterministic-first rule forbids. (Proof it isn't deterministic: the round could not agree where *Electric Universe* or *Simulation Theory* land.) The Wolfram-vs-Vortex difference shows up in **how solid the kernel node is**, not in a label M8 has to pronounce. "fringe" rejected as pejorative.

3. **Honesty warning is DETERMINISTIC and outside the LLM's reach.** The orchestrator hard-wraps a fixed `[SPECULATIVE / UNVERIFIED LEAP]` block onto the recall packet **before the LLM sees it**, and the LLM is forbidden to reword it — the same machinery as the existing `SOLVE_VERB` / `tested_to_N` guards (a label the model *narrates* is too weak; it smooths it into "a live academic debate"). **Schema rule:** a `speculative` node may NEVER occupy an `evidence_for` / `proof_of` / `verification_of` edge — only `proposes` / `claims` / `interprets`. Add a dedicated **Odysseus probe family** ("did M8 present X as established / as physics?").

4. **M8 READS fringe, never GENERATES it.** The conjecture generator, novelty gate, and falsifier may emit ONLY `conjecture` / `refuted` — structurally barred from `speculative`. The `speculative` label attaches only to `source: external-literature` or explicit user input. **No rootless conjectures:** every machine conjecture must trace upstream to ≥1 `established`/`empirical` node.

**Surgical exception — do this WITH M4-manual (one rule, not the whole axis):** the M4 Lean lane must **refuse to formalize a leap / `speculative` node**, so M8 can never hand a fringe claim Lean-grade credibility. This is the single piece worth wiring before the full axis un-parks — it directly protects the iron rule during M4.

**Why parked, not killed:** the decomposition primitive and the deterministic out-of-LLM warning are genuine differentiators — they let M8 engage messy ideas honestly, which most assistants either swallow whole or dismiss outright. Frozen here so it ships the day a trigger fires.

---

## Phase 0 — Foundation (Now — Month 1)

> **⚠ 2026-06-12 note:** Phases 0–4 below predate Builds 8–12 and the S5 middle-layer
> roadmap above. Where they conflict, the middle layers win. Millennium-tier items
> (B2.3, B3.3, B4.1/B4.4 Navier-Stokes scope) are de-scoped per S5.
*Stabilize what exists. No new features. Fix the basics.*

### Track A Actions
- [ ] **A0.1** — Document all existing dashboards: bikes_dashboard_v2.html, dashboard.jsx. Write a one-page spec for each: what it does, what data it expects, what flags it shows. This is the baseline so future work doesn't break what works.
- [ ] **A0.2** — Identify the 3 highest-friction manual tasks Muhammad does weekly that M8 could eliminate. Example: Excel upload for fleet data, settlement calculation, ops summary for leadership. These become the Track A roadmap.
- [ ] **A0.3** — Define the data schema for fleet and settlement data in Supabase. Structured tables, not uploaded files. This is the prerequisite for everything else.

### Track B Actions
- [ ] **B0.1** — Read and annotate Tao's 2019 Collatz paper. Understand exactly what was proven, what wasn't, and where the structural gap is. This is M8's first research target — don't start coding before understanding the problem.
- [ ] **B0.2** — Set up the basic Collatz orbit computation in Python. Not to brute-force — to understand the computational shape of the problem.
- [ ] **B0.3** — Define what a "verifiable structural contribution" to Collatz looks like. What would need to be true for a result to be citable? This sets the verification standard before any generation begins.

### Success Criteria (Phase 0 Done)
- Existing dashboards are documented and won't break unexpectedly
- Data schema exists in Supabase (not just uploaded files)
- Top 3 Track A friction points are identified and queued
- Collatz problem is understood at the level of Tao's partial result
- Verification standard is defined

---

## Phase 1 — Memory Layer (Month 1–3)
*The single highest-leverage investment. Nothing else works well without this.*

### The Problem
M8 currently has zero persistent memory. Every session starts from scratch. Muhammad re-explains context every time. Track B research forgets everything. This is the fundamental limitation — not model capability.

### Track A Actions
- [ ] **A1.1** — Build the **Ops Context Layer** in Supabase: a structured store of Muhammad's operational context. Client names, fleet sizes, current issues, performance flags, history. M8 reads this at session start and knows where it left off.
- [ ] **A1.2** — Build **automated data ingestion for fleet Excel files.** Muhammad drops the file in a watched folder (or emails it); M8 parses it, updates Supabase, generates the weekly report. Zero manual uploads.
- [ ] **A1.3** — Build **proactive weekly ops summary.** Every Monday, M8 generates: top 5 fleet issues, settlement status, pending tasks, cost flags. Delivered to Muhammad without asking.
- [ ] **A1.4** — Build the **career context store.** Current job applications, interview stages, companies, contacts, tailored CV versions, follow-up dates. M8 tracks Muhammad's job search and prompts next actions.

### Track B Actions
- [ ] **B1.1** — Build the **Research Memory Store** in Supabase: `hypotheses`, `experiments`, `results`, `failed_paths`, `dependencies` tables. Every Collatz experiment is logged with: hypothesis tested, method used, result, conclusion, timestamp.
- [ ] **B1.2** — Run the first **structural search on Collatz:** look for invariants that distinguish sequences that reach 1 quickly from those that take long. Log all findings in the research memory store.
- [ ] **B1.3** — Begin tracking **Collatz orbit patterns** as structured data: sequence length, max value reached, stopping time distribution. Build the data that future pattern recognition will run on.

### Success Criteria (Phase 1 Done)
- M8 knows Muhammad's operational context without being told
- Fleet data flows automatically — no manual uploads
- Weekly ops summary generates without prompting
- Research memory is live — every Track B experiment is logged
- At least one structural observation about Collatz orbits is stored and queryable

---

## Phase 2 — Computation + Conjecture Engine (Month 3–6)
*Turn pattern recognition into hypothesis generation.*

### Track A Actions
- [ ] **A2.1** — Build the **Settlement Validation Engine.** Given courier data, M8 calculates valid/invalid DAs automatically (≥250 orders + ≥26 valid days + 6/7 must-attend), flags edge cases, and generates the client-ready settlement report. This replaces manual calculation.
- [ ] **A2.2** — Build **cost anomaly detection.** M8 monitors fleet cost data and alerts when: bike cost >300 SAR (red flag), KM gap >2,500 (amber), oil change = 0 (red). Proactive alerts, not reactive dashboard checks.
- [ ] **A2.3** — Build **supply gap forecasting.** Using historical order volume and courier active-day patterns, M8 projects next-week supply gaps by zone. This is the strategic ops value — knowing before the gap happens.
- [ ] **A2.4** — Build **idea/project tracking** for Muhammad's side projects: Settlement Dashboard SaaS (Idea #1), Arabic AI YouTube channel. M8 tracks milestones, prompts next actions, surfaces blockers.

### Track B Actions
- [ ] **B2.1** — Build the **FunSearch-style Collatz loop.** LLM generates a structural hypothesis → Python tests it across a large sample of starting values → result logged to memory → LLM refines hypothesis based on result. Iterative, logged, structured.
- [ ] **B2.2** — Write the first **Lean 4 stub** for a Collatz sub-result. Even if unproven, the formal statement forces precision. The discipline of writing formal mathematics is the skill — the result is secondary at this stage.
- [ ] **B2.3** — Apply the same FunSearch architecture to **Navier-Stokes blowup candidate search.** Use the Collatz pipeline as the template. This is the Millennium move.
- [ ] **B2.4** — Begin building the **cross-domain knowledge graph:** theorem → depends on → theorem, for the problems in the brief. This is the knowledge layer foundation.

### Success Criteria (Phase 2 Done)
- Settlement calculation is fully automated — zero manual work
- Cost anomaly alerts are proactive
- Supply gap forecast exists and is directionally correct
- Collatz FunSearch loop is running and logging
- At least one Lean 4 stub exists for a Collatz statement
- Navier-Stokes blowup search has started

---

## Phase 3 — Formal Verification + Integration (Month 6–12)
*The difference between "interesting" and "verifiable."*

### Track A Actions
- [ ] **A3.1** — Build the **multi-client ops dashboard.** Single view: all clients (Hunger Station, Noon, Keeta, Uber, Bolt) with status, current issues, settlement period, next deadlines. This becomes Muhammad's morning briefing.
- [ ] **A3.2** — Build **LinkedIn/career content automation.** M8 drafts weekly LinkedIn posts for Muhammad (ops leadership + AI content), tracks application pipeline, generates interview prep on demand.
- [ ] **A3.3** — Begin scoping **Settlement Dashboard SaaS (Idea #1) MVP.** With the settlement engine built for Track A, the technical core already exists. M8 helps scope the multi-tenant version, the pricing model (150 SAR/month Pro tier), and the first 3 target customers.
- [ ] **A3.4** — Build **Arabic AI YouTube channel support system.** Content calendar generation, video script structure, SEO title/thumbnail suggestions, upload scheduling. M8 becomes the channel's production assistant.

### Track B Actions
- [ ] **B3.1** — Get **Lean 4 integration working end-to-end.** M8 generates a claim → Lean verifies it → result is logged as "verified" or "failed verification." Even on simple statements, this pipeline must exist and work.
- [ ] **B3.2** — Produce the **first formally verified result** from Track B. It doesn't need to be novel. It needs to be verified. A known sub-result about Collatz or a simple number-theoretic statement, verified in Lean, proves the pipeline works.
- [ ] **B3.3** — Build the **theorem dependency graph** for Navier-Stokes: what lemmas exist, what they depend on, where the dependency chain breaks down. This maps the mathematical landscape before attempting to navigate it.
- [ ] **B3.4** — Begin building the **cross-problem pattern library:** structural patterns that appear across multiple problems (e.g., monotone quantity = control mechanism, appears in Poincaré/Navier-Stokes/Yang-Mills). This is the beginning of genuine cross-domain reasoning.

### Success Criteria (Phase 3 Done)
- Multi-client ops dashboard is live
- LinkedIn/career automation is active
- SaaS Idea #1 has a scope document and first 3 target customers identified
- Lean 4 pipeline is live end-to-end
- At least one formally verified result exists in Track B
- Navier-Stokes theorem dependency graph is built

---

## Phase 4 — Active Research + SaaS (Month 12+)
*M8 becomes a research collaborator and a product.*

### Track A (by this point should be largely automated)
- [ ] **A4.1** — Settlement Dashboard SaaS: first paying customer. The Track A ops engine becomes a product.
- [ ] **A4.2** — Arabic AI YouTube channel: monetized (4,000 hours watch time + 1,000 subscribers threshold). M8 is the content co-creator.
- [ ] **A4.3** — Muhammad's career: senior Director/VP role secured in Riyadh. M8 tracked, prepared, and supported the entire process.

### Track B
- [ ] **B4.1** — Track B contributes a **novel structural observation** about Navier-Stokes or Collatz that a mathematician considers worth discussing. This is the credibility gate.
- [ ] **B4.2** — Research memory is deep enough that Track B can recall and build on experiments from 6+ months ago without re-running them.
- [ ] **B4.3** — M8 can generate and formally verify conjectures at a rate of at least 1 per week, with the Lean pipeline as the credibility filter.
- [ ] **B4.4** — Begin positioning for the Millennium problem contribution: Navier-Stokes blowup search is producing results that engage with the current state of the field.

---

## Capability Build Order (Priority Stack)

These are the layers in build order. Each one unlocks the next (status as of 2026-06-12):

```
1. RESEARCH MEMORY LAYER (Track B)     ✅ DONE — notebook + memory graph (Build-10)
2. COMPUTATION ENGINE (Track B)        ✅ DONE — discovery loop + OEIS probing (Build-8)
3. LEAN 4 INTEGRATION (Track B)        ✅ DONE — Builds 9–12, corpus-hardened, pinned
4. ADVERSARIAL IMMUNE SYSTEM           ✅ DONE — Odysseus battery (Build-11)
5. STRUCTURAL PROBE PACK (M1)          ← NEXT (S6/Build-13): features, not bounds
6. CONJECTURE ENGINE LITE (M3-lite)    ← S7/Build-14: Type A+B schema, falsifier,
                                          ≥2× random-baseline gate (REV 2: before M2)
7. LITERATURE SEED PACKS (M2)          ← novelty gate; gates "human attention"
8. CONJECTURE ENGINE FULL (M3-full)    ← + M3.1 clustering/prioritization
9. LEMMA-DAG SCAFFOLDING (M4-MANUAL)   ✅ DONE — Build-18, human-architected DAGs only;
                                          leaf discharge via Lean, "k/m leaves, NOT proven"
10. AUTONOMOUS LOOP (L5)               ← NEXT — a cron over 5–9; ships LAST, metric-gated
11. STATEFUL PROACTIVE ALERTS (Track A) ← July, any model; graph-tracked deltas,
                                          no amnesiac re-alerts (team round 2 pick)
12. SAAS PRODUCT (Track A spin-off)    ← Month 12+, unchanged
```

> **Stack status (2026-06-13, post Build-18):** rungs 1–9 above are ✅ DONE (Builds 8–18, all live). **Build-18 (M4-manual, `7760947`) SHIPPED + live-verified** — human-architected lemma-DAG scaffolding, leaf discharge via Lean, "leaves verified k/m, NOT proven" honesty held under live pressure (2/2 live runs, including direct "so it's basically proven now, right?" pressure → clear "no, open conjecture"). The §0.4 ship gate (qualifying leaf: induction + ≥2 distinct Mathlib namespaces + invalid-shortcut rejected) was ATTEMPTED live with a Finset-based Gauss-sum leaf (`2 * Σ_{i∈range(n+1)} i = n*(n+1)`, induction + `Finset.sum_range_succ` — designed to hit `Nat.*` + `Finset.*`) — both attempts returned `lean_pending` ("checker cold/slow") within `LEAN_CHECK_CLIENT_BUDGET_MS=55000` against the 60s Vercel cap on `chat.js`/`chat-stream.js` (`vercel.json`). Root cause is likely genuine: induction+Finset elaboration takes longer than the trivial `n+0=n` case, and 55s leaves ~5s margin inside a 60s function after the Gemini draft step. This is an **infra/timeout question, not a Build-18 logic bug** — gate logic itself (`lib/lemma-dag.js:123-126`) is untested live but offline-verified (32/32). **Next-session pre-gate step**: check the Vercel plan's `maxDuration` ceiling, raise `chat.js`/`chat-stream.js` `maxDuration` and `LEAN_CHECK_CLIENT_BUDGET_MS` together (env var, no code change), then retry the Gauss-sum scaffold. **Rung 10 — L5 (autonomous loop) is NEXT**, gated on 3 consecutive unattended runs with zero battery regressions. The **Epistemic Classification Axis is PARKED** — see the parked-ticket section above; demand-triggered, not a fixed rung. *(The "What's Still Missing" table near the top of this doc predates Builds 13–18 and is stale — this note is the current state.)*

---

## Resource Constraints and Decisions

**Budget: ~$10/month**

| Item | Cost | Decision |
|---|---|---|
| Gemini Flash (primary model) | ~$3-5/month at current volume | Keep. Best cost/performance for ops. |
| Groq fallback | Minimal | Keep. Speed for real-time queries. |
| Supabase (free tier) | $0 | Keep until research memory + ops data needs exceed free tier. Upgrade to $25/month when needed. |
| Vercel Hobby | $0 | Keep until SaaS product requires custom domains + team features. |
| Lean 4 | Open source | Free. Run locally or in sandbox. |
| AlphaProof Nexus (DeepMind) | Not publicly accessible yet | Monitor. Architecture to study and replicate at smaller scale. |

**Model decision:** Gemini Flash is the right choice for ops assistant (Track A). For Track B's more demanding reasoning tasks, consider Gemini Pro or Claude Sonnet for specific research sessions — not as the primary model, but as a specialized upgrade for heavy computation tasks.

**Lean 4:** Free, open source, runs locally. No cost constraint. The barrier is integration time, not money.

---

## Non-Negotiables

1. **Track A ships first.** Every phase has Track A deliverables before Track B gets more investment. The ops assistant justifies the stack's existence.

2. **Research memory before research.** No Track B work beyond Phase 0 exploration until the memory layer is live. Research without memory is waste.

3. **Lean before claiming.** No Track B result is presented as a "finding" until it passes Lean verification. M8's credibility depends on this. "Probably correct" is not the same as correct.

4. **Riba-free on all financial features.** Settlement calculations, SaaS pricing, financial modeling — all instruments must be shariah-compliant. Murabaha, sukuk, wakala structures only.

5. **Muhammad's daily work is never disrupted.** New features are built alongside existing ones. The fleet and settlement dashboards that work today continue to work throughout the evolution.

---

## The North Star (5 Years)

Muhammad has a system that:
- Runs his operational work automatically — fleet, settlement, client reports, supply planning — with minimal manual input
- Generates proactive alerts before problems become crises
- Has formally contributed a verifiable mathematical result to a frontier problem
- Supports an active SaaS product (Settlement Dashboard) with paying clients
- Has made his Arabic AI YouTube channel commercially viable
- Has given him a credible "AI + operations" identity that is unique in the GCC market

This is not a chatbot. It is a compound intelligence — getting more useful every month because it remembers, learns, and builds on everything that came before.

---

*Linked documents: Unsolved_Problems_Brief.md (Track B research targets) · closed team-round briefs, synthesis docs, and finished build specs (06-10 through Build-18) in `archive/`*
*Next review: End of Phase 0 (Month 1)*
