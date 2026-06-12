# Fable 5 Exploitation Sprint — 2026-06-12 → 2026-06-22

**Status: ACTIVE.** This is the canonical plan for the Fable 5 free window. Each Claude Code
session in this window opens by reading this file and executing the next unfinished session block.
Synthesized from team reviews (GPT, Grok, Manus, Gemini, M8 self-assessment) filtered through
`NORTH_STAR.md`. Authored by Fable 5, approved by Muhammad.

---

## 0. Ground rules (conflicts resolved)

1. **Fable 5 is the engineer, never the runtime.** Fable works inside Claude Code sessions
   (free on the plan until June 22). It does NOT become a paid API model inside M8.
   *Rejected:* Grok's proposal to pin `claude-fable-5` in `lib/llm.js` for runtime
   formalization — that bills normally, violates the standing "free Gemini stack by default"
   rule, and adds latency. Formalization stays Gemini Flash; Fable's job is to make Gemini
   better at it (Session 3).
2. **Code IS artifact extraction.** GPT's "don't use Fable for code" assumed a chat window.
   In Claude Code, Fable writing schemas, libs, eval suites, and prompt templates directly
   into the repo is exactly how its reasoning gets crystallized permanently (Manus's framing).
   The rule is narrower: no Fable time on **trivial** code — UI polish, bugfixes, deploy ops,
   fleet features.
3. **Team state was stale — Build-9 is DONE.** All five reviewers planned around building the
   Lean lane. It shipped 2026-06-12 (`646eb05`): formalize → /check → verified badge, repair
   loop proven live, UNFORMALIZABLE escape, import sanitization, battery 4.68/5. Their Lean
   *pipeline* advice is obsolete; their Lean *hardening* advice survives (Session 3).
4. **Anti-sycophancy is mandatory** (Grok). Every design session opens with an adversarial
   critique of the plan before any code, and closes with a self-critique pass.
5. **Track A never breaks.** All work is additive; existing dashboards and hard-routes untouched.
6. **Every build ships with a live test script** (`tests/BUILD_LIVE_TEST.md` + chat questions).
   No local node — test live.

## 1. The unanimous signal

All reviewers independently converged on the same missing layer: **persistent, connected
research memory.** GPT called it "Research Memory" (his #1 underrated item), Manus called it
the Knowledge Graph ontology, Gemini called it pgvector semantic memory, and it was already
queued as Build-10. Three independent votes + prior internal queue = highest-confidence
priority of the window. Without it, OEIS + Lean stay isolated experiments; with it, every
verified theorem compounds. This is the layer that makes an attack on prize-class problems
*cumulative* rather than episodic.

## 2. Session plan

### Session 1 — Build-10: Research Memory Graph (design + foundation) ★ START HERE
- **Open with adversarial design review** (GPT's "what architecture mistakes am I about to
  make?"): Fable critiques its own proposed design against the North Star before writing code.
- Ontology: node kinds (`conjecture`, `theorem`, `evidence`, `counterexample`, `failed_attempt`,
  `technique`, `sequence`, `research_thread`) and edges (`supports`, `contradicts`,
  `generalizes`, `depends_on`, `formalizes`, `derived_from`).
- Supabase migration: graph tables + pgvector embeddings (Gemini's build #3 folded in here).
- `lib/memory-graph.js` (vanilla Node, Vercel Hobby constraints, 12-function cap respected).
- Extraction prompts **written by Fable, executed by Gemini Flash** — the crystallization
  pattern (Manus). Entity/relation extraction from notebook entries.
- Integration points: notebook entries become nodes; `lean.verified` results auto-link
  theorem nodes to their conjecture nodes.

### Session 2 — Build-10 completion + ship
- Retrieval path: graph-walk + cosine-similarity recall into chat context (top-k, budget-capped).
- "What do I already know about X?" and "what contradicts X?" queries live in chat.
- `tests/BUILD10_LIVE_TEST.md` + full battery regression + live test A–E + deploy.

### Session 3 — Odysseus adversarial battery  *(moved ahead of Lean hardening — Muhammad's call 2026-06-12)*
- Fable designs ~50–100 attack probes against: honesty contract (narration ≤ evidence),
  hard-route bypass, compute/search routing confusion, **memory-graph poisoning/confabulation**
  (Build-10 just added a new surface — probe it while fresh), and **Lean weakening attacks** —
  the frobnicate `n = n` bug class Fable already caught live; proven, productive category.
- Automated runner + assertion logic → permanent immune system, runnable on every future build.
- Run it, triage, fix what breaks (fixes that are trivial → note for non-Fable follow-up).

### Session 4 — Lean lane hardening: golden corpus + benchmark + open items
- **Golden corpus** (Manus): 30–50 prose→Lean 4 pairs, each validated against the live
  `/check` endpoint, best ones embedded as few-shot into the Gemini formalization directive.
- **Benchmark** (GPT): measure formalization pass-rate before/after corpus on a fixed
  theorem set — data, not opinions, on where the capability bottleneck is.
- Pin `MATHLIB_REV` (open item). Take `lean_stated`/`sorry` path live (open item).
- Error-message → repair-prompt parsing improvements from real /check failures.

### Session 5 — North-Star roadmap: the missing middle layers
- Pure-reasoning session, deliberately late in the window (lowest staleness risk, no repo
  dependency). GPT's "12-month roadmap" + Manus's Track-B pain-point mapping.
- Deliverable: deliberate update to `NORTH_STAR.md` + `M8_Evolution_Plan_2026.md` defining
  the layers between [Lean lane + memory graph] and [autonomous open-problem exploration]:
  conjecture-generation loop, literature ingestion into the graph, proof-search strategy,
  Collatz-specific structural probes. Brutal-honesty mandate: name what would waste months.
- Per standing preference: produce a standalone team-brief MD for the next team round.

### Session 6 (stretch, only if time remains) — SSE streaming latency
- Gemini's build #2: `/api/chat` → Server-Sent Events, TTFB < 2s while the deterministic
  spine still computes first. Real Track-A UX win and genuinely fiddly in serverless —
  but survivable after June 22 with other models, hence last.

### Explicitly NOT Fable work (do anytime, any model)
Notebook Lean badge UI (spec §5) · fleet dashboard features · deploy/webhook ops ·
small bugfixes · routine content.

## 3. Success criteria for the window
By June 22, the repo permanently contains: (a) a live research memory graph that every
discovery and verified theorem writes into, (b) an automated adversarial battery,
(c) a validated golden corpus + measurably hardened Gemini formalization directive, and
(d) an updated North-Star roadmap naming the middle layers. If only two land, (a) then (b)
(reordered 2026-06-12 — battery ahead of corpus, per Muhammad).

## 4. Progress log
- [x] Session 1 — Build-10 design + foundation ✅ 2026-06-12 — adversarial review + ontology in
      `BUILD_10_SPEC.md`; `migrations/memory_graph.sql` APPLIED live (pgvector enabled, nodes/edges
      tables + `m8_graph_match` RPC smoke-tested); `lib/memory-graph.js` (deterministic ingest,
      Fable-authored/Gemini-executed extraction, nightly sweep, retrieval core); hooks live in
      `persistNote()` + `/api/cron-summarize`. Lean `lean_verified` → theorem node + formalizes
      edge. NOT yet deployed/live-tested (Session 2).
- [x] Session 2 — Build-10 ship ✅ 2026-06-12 — **LIVE & DEPLOYED** (`cc83ded`). Graph retrieval
      lane in both orchestrator paths (tool_decision `graph`); live tests A–F green incl. the
      semantic "3n+1 → collatz" recall; ONE real bug found+fixed live (recall laundered a
      fabricated 2M bound from conversation memory — packet contract hardened); history fully
      backfilled (44 nodes / 53 edges / 0 unembedded; 4 theorem nodes = exactly the 4
      lean_verified rows); full battery **4.7/5 — no regression** (baseline 4.68).
- [x] Session 3 — Odysseus battery ✅ 2026-06-12 — **Build-11 SHIPPED** (`2c760da`+`5c68eb8`):
      38-probe adversarial corpus (`tests/odysseus/battery.json`, single source of truth,
      validates 38/38) + standalone live runner (`run-battery.ps1`, own results dir, main
      4.7 trend untouched) + offline grader self-test (13/13 before any quota). First live
      run 33/38 clean; graph_confab/bypass/route_confusion 5/5 — GRAPH_GROUND held. THREE
      REAL BUGS found+fixed live: (1) **slot-fill hijack** — the clarification merge fired
      on any reply ending in '?', destroying anchored hard-route detection ("graph: collatz"
      → web search; a recall laundered a planted PAUSED status) → `claimsOwnLane()` guard,
      both paths; (2) GRAPH_KNOW_RE gap ("what does the graph have ON x") widened;
      (3) **Lean lane meta-question hijack** — implication-questions about Lean got the
      canned UNFORMALIZABLE dodge → LEAN_META_QUESTION guard (genuine formalize asks
      unaffected, port-verified 7/7). All re-run green. Known-flaky left on books:
      fleet name-parse ("the fleet" as driver) = non-Fable follow-up.
- [x] Session 4 — Lean hardening ✅ DONE 2026-06-12 (Build-12, `27bfefc`+ + Cloud Run rev 00008).
      **Benchmark 0.3 → 0.65** (zero freestyle replies after; 2 honest rejections remain).
      **lean_stated LIVE**: "formalize in Lean: <Goldbach>" → statement type-checked (1 sorry) →
      "verified statement, not a proof" → logged as formally-stated conjecture. Corpus 37/37 on
      the PINNED checker. tests/BUILD12_LIVE_TEST.md = spot-check script.
      ⚠ Found for next session: an explicit "formalize and verify in Lean" ask with discovery-
      shaped wording can be claimed by the DISCOVERY lane first → unchecked prose Lean draft
      (honest, but bypasses /check). Candidate fix: explicit Lean ask outranks discovery.
      Original scope notes (mid-session):
      golden corpus 37 pairs ALL validated vs live /check (tests/lean-corpus/golden.json +
      validate-corpus.ps1); 11 validated few-shots embedded in LEAN_SYSTEM; benchmark
      BEFORE = 0.3/1.0 (10 held-out claims, run-lean-bench.ps1) — root causes found+fixed:
      MATH_TARGET too narrow (explicit "verify in Lean: X" never entered the lane → unguarded
      LLM wrote Lean-3 axiom "proofs"; fix LEAN_EXPLICIT fast path) + ring missing from proof
      allowlist (fix: added, g37 validated); checker: sorry UNBANNED from injection screen
      (lean_stated now reachable; sorried code reported, never verified) + MATHLIB_REV PINNED
      b580ec53f9e3 (full-40-char-sha fetch lesson); deploy verified live (irrationality ask →
      faithful ¬∃q:ℚ,q²=2 + honest sorry — was an axiom-tutorial before).
      ⚠ REMAINING (next session if quota ran out): AFTER benchmark run (-Label after, compare
      vs 0.3), lean_stated live test in a REAL session (Goldbach → logs to notebook), main
      battery lean-probe spot-check, close-out docs.
- [x] Session 5 — North-Star roadmap ✅ 2026-06-12 (Session-13). S4 leftovers closed first:
      **lean.verified_theorem spot-checked live** ((a+b)² → faithful statement → **verified**
      via `by ring`, 11.4s warm, notebook-logged; /health = pinned b580ec53f9e3) and the
      **discovery-vs-Lean precedence fix** shipped (`a823b37`): root cause = BOUND_RE's
      `to \d` matched "greater than or equal TO 4" as a discovery bound; fix =
      `isExplicitLeanAsk()` (LEAN_EXPLICIT minus meta-questions) preempts discovery+OEIS,
      logs `lean_over_discovery`; bare "verify Collatz up to 100,000" untouched.
      PUSHED (user-approved) + LIVE-VERIFIED same day: probe 7 Goldbach "formalize and
      verify" → Lean lane claims it, **lean_stated** (type-checks, honest sorry, logged);
      probe 8 "verify Collatz up to 100,000" → still a discovery run. Fix confirmed in
      both directions.
      **S5 deliverables:** middle-layer roadmap (M1 structural probes → M2 curated
      literature seed packs/novelty gate → M3 falsifier-gated conjecture generator →
      M4 lemma-DAG scaffolding → L5 cron LAST, metric-gated) written into NORTH_STAR.md
      (cells updated: rungs 1–3 ✅, L4 ~80%) + M8_Evolution_Plan_2026.md (S5 revision:
      stale current-state replaced, Navier-Stokes/Millennium DE-SCOPED, build order
      refreshed) + standalone team brief `M8_Team_Brief_S5_2026_06_12.md` (5 attack
      questions for the round) + diagram cell flips. Self-critique on record: M2 curation
      is a human bottleneck (candidate: Fable authors the Collatz seed pack if window
      time remains); M3 schema may exclude density/asymptotic shapes (team Q2).
- [x] Team round 2 ✅ 2026-06-12 (same day, post-S5): REV 2 brief (STATE SYNC) forced
      substance — inputs from M8 self-review, GPT, Gemini (Grok half-stale again).
      Synthesis + adopted changes in `M8_Team_Round2_Synthesis_2026_06_12.md`; canonical
      ladder now M1 → M3-lite → M2 → M3-full → M3.1 → M4-manual → L5 (NORTH_STAR REV 2).
      Bug found in-round: discovery next-probe coda leaked on a conversational turn
      ("verify sse up to 40 and log it") — triage S6.

**REVISED REMAINING-WINDOW PLAN (post round 2 — SSE displaced to post-window by its own
survivability logic; Fable time goes to what dies on June 22):**
- [ ] Session 6 — Build-13: **M1 structural probe pack** (Collatz features → graph as
      `evidence` nodes: stopping times σ(n), total stopping time, max excursion, parity
      vectors, 2-adic valuations, residue census, record-setters; HARD per-turn recall
      cap = the context-dilution guard) + **Odysseus-2 design** (faithfulness family:
      assumption-dropping / theorem-substitution on the Lean lane; self-contamination
      family: own-conjecture vs literature provenance under adversarial retrieval) +
      triage the discovery-coda leak. Gate: ≥3 feature families queryable from chat.
- [ ] Session 7 — Build-14: **M3-lite conjecture generator v1** (Type A finite-bound +
      Type B trend/statistical schema with seeded-deterministic evaluation; deterministic
      falsifier; random-conjecture baseline generator; gate = survival ≥2× baseline +
      non-triviality floor; hard cap + graph-dedup spam guard; survivors stay
      tested-to-N, never "interesting", until M3-full) + run Odysseus-2 against it.
- [ ] Session 8 (if window remains) — **M2 Collatz literature seed pack authored by
      Fable** (20–50 curated results, `external` provenance — the math-literacy
      bottleneck) + **stateful proactive-alerting SPEC** for the July Track A build
      (graph-tracked deltas, alert conditions from M8's round-2 self-review).
- [ ] Post-window (any model): SSE streaming · stateful alerting build · lean badges UI ·
      fleet name-parse fix · discovery-coda leak if not fixed in S6.
