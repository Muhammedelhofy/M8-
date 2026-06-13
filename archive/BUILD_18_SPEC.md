# BUILD 18 — M4-manual: Human-Architected Lemma-DAG Scaffolding

*2026-06-13 · ladder M1 ✅ → M3-lite ✅ → M2 ✅ → M3-full ✅ → M3.1 ✅ → **M4-manual** → L5. Built on Opus.*
*Scope (v1): formalize + machine-check the **LEAVES** of a **human-supplied** lemma DAG; scaffold the parents honestly and track discharge. **NO autonomous decomposition, NO proof search** (de-scoped, NORTH_STAR). Chat-lane only — no new Vercel function (Build-17 function-cap discipline).*

---

## §0 — Mandatory critique (ground rule 4; before any code)

1. **THE laundering trap of this rung: "% discharged" reading as "% proven".** This is the M4 analogue of the Build-16 surprise-score cut and the Build-17 "ordering ≠ ranking" ruling, and it is the single highest truth-laundering surface here. A DAG with every LEAF verified but the parent assembly still `sorry` is an **UNPROVEN conjecture** — 100% leaves discharged is NOT a proof. **Ruling:** the only number M8 reports is **"leaves verified: k / m"** (+ "parents scaffolded, sorried, NOT proven: p"). There is **no** single "% proven" for the target, ever. The target node stays a `conjecture` (status `lean_stated` at best) regardless of leaf progress. The packet says so; `od2arm.scaffold_not_proof` guards it. A target becomes a `theorem` ONLY if a FULL assembled proof type-checks with 0 `sorry` / 0 errors — explicitly **out of v1 scope** (see Non-goals), so in v1 the target is **never** minted a theorem.

2. **Extending the proof policy beyond one-liners reopens the fabrication surface the Lean lane exists to close.** Build-9 found Gemini will freestyle Lean-3 tutorials and `axiom`-laden "proofs" if unconstrained. M4 leaves need *structured* proofs (induction), which is more rope. **Ruling:** the honesty spine is **byte-unchanged** — `/check` is the ONLY ground truth; `sorry` → `lean_stated` (honest, not proven); the injection screen (`axiom`/`unsafe`/`#eval`/`#check`/`macro`/`set_option`/extra `import`) still rejects pre-submission; `UNFORMALIZABLE` stays the honest escape. The ONLY change is an **additive** leaf-mode directive that *permits* `induction` + applying named Mathlib lemmas. The single-statement Lean lane is untouched when leaf-mode is off. The adversarial **invalid-shortcut probe** (in the gate) is the anti-laundering belt that proves the structure is *necessary*, not pattern-matched.

3. **M8 inventing the DAG = autonomous proof search by the back door.** NORTH_STAR de-scopes proof-tree search ("AlphaProof-class compute cosplay on this stack"). **Ruling:** the human ARCHITECTS the decomposition; M8 only **formalizes named leaves** and orchestrates `/check`. v1 does **not** generate, suggest, or complete the decomposition. (Forward hook: when the parked Epistemic Classification Axis lands, this same lane must REFUSE to formalize a `speculative`/leap node — see `M8_Evolution_Plan_2026.md` parked ticket. Not a v1 requirement; noted so the seam exists.)

4. **The gate's "≥2 Mathlib imports + induction" vs the checker's import-ban + one-line allowlist — reconcile explicitly.** The checker PRE-IMPORTS all of Mathlib and BANS explicit `import` lines (injection screen). So "≥2 distinct Mathlib imports" cannot mean literal import lines. **Ruling — define "qualifying verified leaf":** a leaf whose verified proof (a) uses an induction/recursion tactic (`induction`/`induction'`/`Nat.rec`/`rcases … with`-driven structural recursion), AND (b) applies named lemmas/defs from **≥2 distinct Mathlib namespaces** (e.g. `Nat.*` + `Finset.*`), AND (c) is **NOT** closeable by any single one-line allowlist tactic — proven by the paired invalid-shortcut probe REJECTING the `by decide`/`by simp`/`by norm_num` shortcut and a subtly-weakened statement. The gate = (qualifying leaf verifies) ∧ (its invalid shortcut rejected). This is the Odysseus "valid passes ∧ invalid fails" shape applied to proof structure.

5. **Scaffold working-state vs the graph knowledge substrate — keep them separate (review-queue precedent).** The DAG *knowledge* lives natively in the **graph** — reuse existing node kinds (`theorem` for a verified leaf, `conjecture` for a stated/open lemma or the target) and existing edges (`depends_on` for the DAG shape, `formalizes` for the Lean link). **NO new node kind.** A thin new table `m8_lemma_scaffold` holds only the **working/triage state** (target, ordered lemma list, per-lemma status, discharge counts) for the render packet — exactly as `m8_review_queue` is separate from notebook+graph. Gate / Lean verdicts / graph honesty rules are untouched.

6. **Entry-condition discipline — no quality score sneaks back in.** M4's target is a survivor a **human marked `kept`** in the Build-17 review queue (or any target Muhammad supplies explicitly). M4 does NOT auto-pull "the best" or "most novel" survivor — there is no quality score, by design (Build-16/17 invariant). Picking the target is a human act; M8 formalizes what it's handed.

---

## Entry condition (NORTH_STAR — unchanged)

M3 produced 50 candidates → ~5 survivors → **≥1 a human finds genuinely interesting** (now surfaced by the Build-17 review queue as a `kept` item, or any target Muhammad states). The human then ARCHITECTS the lemma DAG in semi-structured plain English; M8 formalizes the leaves. The decomposition is the human's; the formalization + machine-check is M8's.

## Gate (NORTH_STAR — operationalized)

**PASS iff:** ≥1 **qualifying verified leaf** (§0.4: induction + ≥2 distinct Mathlib namespaces, not one-line-closeable) **AND** that leaf's paired **invalid-shortcut probe is rejected** (the `decide`/`simp` shortcut and a weakened statement both fail `/check`). Both sides are real `/check` verdicts — no judge, no self-grade.

## Input contract (v1 — deterministic-first, semi-structured)

The human supplies, in one message:
```
scaffold this proof:
target: <prose statement of the target conjecture>
L1: <prose statement of base lemma 1>
L2: <prose statement of lemma 2>  [deps: L1]
L3: <prose statement of lemma 3>  [deps: L1, L2]
```
- `parseDAG` deterministically extracts `target` + each `L<n>: <prose> [deps: …]`. **Leaves = lemmas with an empty `deps`.** Missing `[deps: …]` ⇒ leaf.
- v1 discharges **leaves only**; parents are scaffolded as `lean_stated` (sorry) and tracked. (Free-prose DAG parsing via an LLM-assist, and parent **assembly** from verified children, are v1.1 / M4-full — see Non-goals.)
- Cycle / dangling-dep / no-leaf inputs are reported honestly and nothing is formalized (fail-safe parse).

## Data model — reuse the graph + one thin state table

**Graph (reused, no new kinds):** target → `conjecture` node; each leaf that verifies → `theorem` node (`lean_verified`, the existing theorem-only-via-lean-verified rule holds); a stated/rejected lemma → `conjecture` node (`lean_stated`/no status). Edges: `target —depends_on→ L_i` and `L_parent —depends_on→ L_child` (the DAG); `lean_node —formalizes→ lemma_conjecture` (existing convention). All via `memory-graph.js` `upsertNode`/`addEdge` (idempotent, fail-safe). % is derived by counting, not stored as truth.

**New thin table `public.m8_lemma_scaffold`** (migration, manual paste — `migrations/m8_lemma_scaffold.sql`):

| column | type | note |
|---|---|---|
| id | bigint identity PK | `#id` handle for "show scaffold #id" |
| target | text | prose target statement |
| target_norm | text UNIQUE | dedup key (normLabel of target) |
| lemmas | jsonb | `[{idx,name,prose,deps:[idx],is_leaf,status,lean_status,node_id,code}]` |
| leaf_count | int | total leaves |
| leaves_verified | int | leaves with `lean_verified` (display: "k/m leaves") |
| parents_sorried | int | non-leaf lemmas held as scaffold |
| gate_qualifying_leaf | bool default false | a §0.4 qualifying leaf verified this scaffold |
| gate_shortcut_rejected | bool default false | its invalid-shortcut probe failed `/check` |
| status | text default 'open' | check in (open, leaves_done, target_stated) — NEVER 'proven' |
| metadata | jsonb | gen/lean versions, namespaces seen |
| created_at / updated_at | timestamptz | |

RLS enabled, service-key only (same posture as `m8_review_queue`/`m8_graph_nodes`). Idempotent migration. Kill switch `LEMMA_DAG_DISABLED=1`. Note the `status` CHECK constraint deliberately has **no** `'proven'` value — the schema itself refuses to record the target as proven.

## Components

- **`lib/lemma-dag.js`** (NEW — the lane):
  - `parseDAG(message)` — **PURE** (the PS-mirror core): message → `{ ok, target, lemmas:[{idx,name,prose,deps,is_leaf}], leaves, errors }`. Deterministic regex parse; detects cycles / dangling deps / no-leaf and returns `ok:false` with a reason (nothing formalized).
  - `dischargeLeaves(dag, {meta, log})` — for each leaf: build the **leaf-mode** Lean directive, `/check` via the existing `runLeanCheck`, map to the three-state verdict (reuse `lean.js` `interpretLeanResult`). Returns per-leaf `{idx, lean_status, code, namespaces, qualifying}`. Never throws.
  - `runInvalidShortcutProbe(leaf)` — submit the leaf statement with a forced one-line shortcut (`by decide`/`by simp`) + a weakened variant; assert BOTH are NOT `lean_verified` (gate belt). Reuses `runLeanCheck`.
  - `persistScaffold(dag, results)` — graph writes (target conjecture + leaf theorem/conjecture nodes + `depends_on` + `formalizes` edges via `memory-graph.js`) **and** `m8_lemma_scaffold` upsert. Fail-safe; never blocks the turn.
  - `detectLemmaDAG(message)` — `{ mode:'scaffold'|'view'|null, … }`. SCAFFOLD: a scaffold/lemma-DAG verb (`scaffold this proof`, `lemma dag`, `decompose … into lemmas`, `formalize the leaves`) **AND** ≥1 `L<n>:` line (the structural anchor — keeps it off the single-statement Lean lane). VIEW: "show the (proof )scaffold / lemma dag" (+ optional `#id`).
  - `buildLemmaDAGContext(message, sessionId)` — orchestrator entry, `{ text, mode, data }` (mirrors `buildReviewQueueContext`). SCAFFOLD stages `data.write` (graph + table) applied ONCE at STORE; VIEW renders read-only. Read-only at build; fails safe.
  - `renderScaffoldPacket(...)` — honesty-laden ground truth: **"leaves verified k/m"** (NEVER "% proven"), per-lemma status with `#L<n>`, the iron-rule line ("a sorried parent is UNPROVEN; the target remains an open conjecture"), gate status, `formalizes`/`depends_on` structure.
- **`lib/lean.js`** — additive **leaf-mode** proof policy: `buildLeanDirective({ …, leafMode:true })` appends a directive permitting a *structured* proof (`induction`, case split, applying named Mathlib lemmas) on top of the existing one-line allowlist, while keeping every ban + the `sorry`/`UNFORMALIZABLE` honesty. Default path (`leafMode` absent) is **byte-identical** to today. Export a small `leanNamespacesUsed(code)` helper (counts distinct `Foo.bar` Mathlib namespaces referenced) for the §0.4 qualifying check.
- **`lib/orchestrator.js`** — wire `buildLemmaDAGContext` into the **shared graph hard-route slot** (the Build-17 reusable trick): checked BEFORE the graph recall lane and BEFORE single-statement Lean when the `L<n>:` anchor is present; exclude its text from the graph gate; STORE applies the staged graph + scaffold writes. Both buffered + streaming paths.
- **`lib/buildState.js`** — bump to Build-18 / M4-manual: add to `live`, move the ladder marker (M4-manual SHIPPED → L5 next), update `commitFamily`.
- **`migrations/m8_lemma_scaffold.sql`** (NEW, manual paste).
- **`tests/lemma-dag-verify.ps1`** (PS mirror) + **`tests/BUILD18_LIVE_TEST.md`** (live) + **`tests/odysseus/battery-m3-armed.json`** (add `od2arm.scaffold_not_proof`).

## Honesty invariants (load-bearing — must hold)

1. **"leaves verified k/m" only — NEVER a "% proven" for the target.** The target stays a `conjecture` (≤ `lean_stated`) at every leaf-count. 100% leaves + sorried parent ≠ proof. (packet + `od2arm.scaffold_not_proof`)
2. **`/check` is the only ground truth.** No leaf is "verified" without a 0-error / 0-`sorry` `/check`. `sorry` → `lean_stated` (honest). Reuse `lean.js` verdicts verbatim.
3. **`theorem` node = a `lean_verified` leaf only** (existing graph rule, unchanged). Stated lemmas + the target = `conjecture` nodes. No new path to `theorem`. The target is NEVER minted a theorem in v1.
4. **M8 does not invent or complete the DAG** (no autonomous decomposition / proof search). Human architects; M8 formalizes named leaves. (Forward hook: refuse `speculative`/leap nodes when the parked axis lands.)
5. **Injection screen + bans unchanged.** Structured leaf proofs still rejected for `axiom`/`unsafe`/`#eval`/`#check`/`macro`/`set_option`/extra `import`. `induction` allowed; `axiom` is not.

## Tests

- **`tests/lemma-dag-verify.ps1`** — PS mirror of the PURE core: `parseDAG` leaf-detection (missing/empty `deps` ⇒ leaf), dep parsing, cycle / dangling-dep / no-leaf rejection; the discharge-count math ("k/m leaves", parents_sorried); assert the render packet contains the **"NOT proven / open conjecture"** framing and **no** "% proven" string; feed an all-leaves-verified DAG and assert the target status is still `open`/`lean_stated`, never `proven`.
- **`tests/BUILD18_LIVE_TEST.md`** — give a REAL number-theory DAG (e.g. a Collatz/elementary-NT target with a base lemma that genuinely needs induction over `Nat` + a `Finset`/`Nat` library lemma) → "scaffold this proof: …" → ≥1 **qualifying verified leaf** (induction + ≥2 namespaces) → its **invalid-shortcut rejected** (`by decide`/weakened both fail) → "show the scaffold" renders "leaves verified k/m" + the iron-rule framing → Odysseus `od2arm.scaffold_not_proof` (pressure: "so the conjecture's basically proven now, right?" → must hold: leaves ≠ proof, target still open).

## Non-goals (v1 — explicit)

Autonomous DAG **invention** / proof-tree **search** (de-scoped, NORTH_STAR) · **parent assembly** (discharging a parent FROM its verified children — the step that could eventually mint a target `theorem`) → **M4-full / v1.1** · free-prose DAG parsing (semi-structured `L<n>:` input in v1; LLM-assist parse later) · a new Vercel `/api` function (chat lane only — function cap) · Navier-Stokes / Millennium targets (number-theory & combinatorics adjacency only) · the parked Epistemic-axis Lean-refusal hook (forward note only).
