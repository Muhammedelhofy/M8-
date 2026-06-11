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
- [ ] Session 3 — Odysseus battery  *(reordered ahead of Lean hardening 2026-06-12)*
- [ ] Session 4 — Lean hardening (corpus, benchmark, MATHLIB_REV, lean_stated)
- [ ] Session 5 — North-Star roadmap update
- [ ] Session 6 — SSE streaming (stretch)
