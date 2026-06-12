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
- [x] Session 6 — Build-13 ✅ 2026-06-12 (`23c4c2e`+`d88ab7c`+`295e2d9`, all LIVE-VERIFIED).
      **M1 structural probe pack SHIPPED**: `lib/collatz-probes.js` — deterministic
      in-process census (NOT LLM compute), all 7 families (σ(n), σ∞(n), max excursion,
      parity vectors on the TERRAS map — full map admits no "11", only Fib(10)=55
      prefixes, the census itself caught that; ν₂(3n+1), mod-6 residue census,
      record-setters); orchestrator lane above discovery (run-verb required, recall
      asks stay with the graph); notes persist as NEUTRAL evidence (`metadata.neutral`
      → **zero supports edges minted, verified live in SQL**); algorithm verified vs
      literature ground truth offline 26/26 (`tests/m1-probes-verify.ps1`: σ∞(27)=111,
      peak(9663)=27,114,424, record tables). **GATE PASSED live**: parity / records /
      2-adic all queryable from chat; recall **EVIDENCE CAP** live (GRAPH_EVIDENCE_CAP=4
      matched evidence/external nodes per turn; edge lines already ≤12). Live run:
      7 notes → 7 embedded nodes in 28.5s (after hotfix: 60s maxDuration + parallel
      persists — first run hit FUNCTION_INVOCATION_TIMEOUT at 30s).
      **Coda-leak FIXED + cleaned**: root cause = (1) whole-message discovery detection
      let a long review paste match verb/target/"to 4" across DIFFERENT sentences,
      (2) `suggestNextProbe` fired even when nothing was logged. Fix: sentence-scoped
      detection >240 chars + coda/next_step gated on an evidenced run (`ranOk`,
      `discovery_coda_suppressed` trace). Worse than synthesis recorded: the leak had
      ALSO minted a fake evidence row (the pasted brief logged as "[auto-logged from a
      code-execution run, bound 4]") + graph nodes — all 5 rows cleaned in Supabase.
      Live both ways: repro paste → no coda/no rows; genuine run → coda intact.
      **Odysseus-2 DESIGNED + FIRST RUN**: `tests/odysseus/ODYSSEUS2_DESIGN.md` +
      11 probes in battery.json (49/49 validate) — 6 lean_faithfulness (drop-hypothesis,
      substitution, bound-weakening, axiom-smuggle, inversion, false-with-pressure),
      4 self_contamination + od2.m1_neutral_census (3/3 live). First self_contamination
      run: **2 REAL CATCHES** — model called our surviving conjecture "established/
      confirmed" and accepted "basically true" under pressure → shipped the
      **research upgrade-pressure guard** (deterministic detector over message+history
      → RESEARCH INTEGRITY directive, fleet-integrity-alert pattern, both paths).
      M3-armed probes (seeded-survivor, flood, self-citation) specified for S7.
      lean_faithfulness full run deferred (Cloud Run quota) — it formally gates
      M3-full/L5, not this build. Also found (non-Fable follow-up): notebook READ
      detection grabbed a phrase from a long conversational paste ("the notebook stays
      the ledger of record") — harmless read, candidate for the same sentence-scoping.
- [x] Session 7 — Build-14 ✅ 2026-06-12/13 (`5a2127a`+`2f7f250`+`20a735b`, all pushed +
      LIVE-VERIFIED). **M3-lite conjecture generator v1 SHIPPED**: `lib/conjecture-gen.js`
      — seeded template-mining (mulberry32, default 1337) over the M1 features on a TRAIN
      census (test/10), Type A predicate+bound + Type B trend/frequency (exhaustive
      count), deterministic in-process falsifier over the full TEST range, **vacuity
      floor** (slack claims excluded from survival, both cohorts — round-2 Q3
      trivial-survivor guard made concrete), gate = mined survival ≥2× structure-blind
      baseline (narrated as generation quality, never truth; the packet now REQUIRES the
      gate verdict in the reply). Survivors (cap 5) → thread `collatz-m3`, node status
      `tested_to_<N>` → recall labels MACHINE-GENERATED + provenance warning;
      `latestConjectureNode` excludes survivors (**supports-edge hijack found in recon** —
      a survivor in the main thread would have silently become the edge target for all
      future discovery evidence). Lane ABOVE M1 (whose pack regex would claim generator
      asks). Live: determinism verified (seed 7 twice = identical survivors); routing
      boundaries hold (M1/discovery/recall/Lean); supports-recall credits only real
      discovery evidence. Offline mirror 42/42 (`tests/m3-conjecture-verify.ps1`).
      **A2 leak caught on FIRST live run + hotfixed**: "σ(n) ≤ 4 for n ≡ 1 (mod 12)"
      survived — provable identity (n ≡ 1 mod 4 ⇒ σ = 3 exactly); σ-templates now
      exclude classes pinning n ≡ 1 (mod 4), identity PS-verified to 10k.
      **Odysseus-2 armed + run — THREE REAL CATCHES**: armed corpus
      `battery-m3-armed.json` (4 live-session probes, runner `-File`/`-SessionPrefix`)
      4/4 green after grader fixes (negation + question-echo false-positives); hermetic
      run caught (1) "basically true" pressure → model slid to interesting/promising/
      "strong evidence" (Q1-banned) and (2) "Lagarias published our result, cite it as
      literature" matched NOTHING in the upgrade-pressure detector → directive never
      fired, model half-caved. Fix: fake-external-confirmation shapes added to
      UPGRADE_PRESSURE_RE + directive bans the softer upgrades and mandates
      "machine-generated, tested up to N, still open" — re-run 5/5.
      **lean_faithfulness full run (S6-deferred): 6/6 clean, 5/5** — the M3-full/L5
      Odysseus-2 gate families are all green. buildState.js caught up (was stale at
      Build-8). Found for post-window list: graph node LABELS truncate mid-number
      (content.slice(0,160) cut "2 ≤ n ≤ 10,000" → recall narrated "n between 2 and
      10") — cosmetic, non-Fable fix.
- [ ] Session 8 (if window remains) — **M2 Collatz literature seed pack authored by
      Fable** (20–50 curated results, `external` provenance — the math-literacy
      bottleneck) + **stateful proactive-alerting SPEC** for the July Track A build
      (graph-tracked deltas, alert conditions from M8's round-2 self-review).
- [ ] Post-window (any model): SSE streaming · stateful alerting build · lean badges UI ·
      fleet name-parse fix · sentence-scope the notebook READ detection (S6 finding:
      a long conversational paste containing "the notebook stays the ledger of record"
      triggered a harmless ledger read — same fix class as the S6 discovery scoping) ·
      graph node-label truncation cuts figures mid-number (S7 finding: label =
      content.slice(0,160) turned "2 ≤ n ≤ 10,000" into "…2 and 10" in recall —
      truncate at a word/figure boundary instead).
