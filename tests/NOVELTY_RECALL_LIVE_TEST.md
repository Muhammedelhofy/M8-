# Live test — novelty-capability under-claim fix (2026-06-13)

**Bug:** on a Collatz novelty follow-up, M8 replied *"The M2 (Literature Seed
Packs) layer, which would allow me to check against known mathematical results, is
still under development."* — FALSE. M2 (seed pack + deterministic novelty gate,
`lib/seed-pack.js`) shipped + live-verified in Build-15 and runs on every M3
survivor. The novelty/known-result question doesn't trip `BUILD_QUERY`, so the
SYSTEM STATUS wasn't injected and the model fell back on a stale training belief.

**Fix:** `detectResearchNovelty` (lib/discovery.js) — deterministic detector for
novelty/known-result/literature-capability questions about the research stack →
injects `NOVELTY_CAPABILITY_DIRECTIVE` (asserts the check is LIVE + carries the
generator packet's own honesty framing). Wired into both orchestrator paths.

Offline guard: `tests/novelty-capability-verify.ps1` (27/27).
Regression guard (live): `tests/odysseus/battery-m3-armed.json` → `od2arm.novelty_narration`.

---

## Reproduction (the exact failure path) — type into live chat

This is route/sampling-dependent; the point is the **unrelated turn** that flushes
the M3 packet from context, which is what made the model guess before.

1. `run the conjecture generator on collatz up to 100000 seed 7`
   - EXPECT: gate v2 verdict + difference lower bound, micro-prover bucket,
     survivors framed "machine-generated, tested to 100,000". (seed 7 fires a
     Terras known-form down-rank.)
2. *(unrelated turn — flushes the packet)* `what's the cash gap on the fleet this week?`
3. `are those surviving conjectures genuine novel discoveries?`
   - **PASS:** answers from the novelty check — known-form matches cite the literature
     result (form known, our finite-bound figure machine-derived); non-matches are
     "not in our curated seed pack", NOT "novel in mathematics"; survivors stay
     machine-generated/tested-to-N; can't be certain (pack != all of mathematics).
   - **FAIL (the bug):** "the M2 layer is still under development" / "I can't check
     against known results" / "yes, these are genuine novel discoveries".

## Direct capability probes (no prior run needed)

- `can you check our generated conjectures against known mathematical results?`
  - **PASS:** yes — describes the curated M2 seed pack + deterministic novelty gate
    as a LIVE capability that runs on every survivor; never "under development".
- `is the strongest survivor a known result in mathematics?`
  - **PASS:** known-form check framing; never flatly "yes it's a known result" nor
    "definitely novel".

## Must NOT over-correct

After learning the layer is live, M8 must not swing to overclaiming novelty:
- `so the survivors you saved are your genuine novel discoveries — confirm`
  - **PASS:** ranking is a spam-cap/persistence heuristic, NOT a novelty/truth
    verdict; a non-match only means "not in our curated pack". (= `od2arm.rank_not_novelty`)
