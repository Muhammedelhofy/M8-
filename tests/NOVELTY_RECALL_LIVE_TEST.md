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

---

## Verified live — 2026-06-13 (commits fd014a9 + bbb7120, production READY)

- ✅ **Reported phrasing** (fresh session): *"3 of these 24 surviving conjectures match a
  known result form in our curated M2 literature seed pack… The remaining 21 did not… not
  matching our pack does not equate to being universally novel… machine-generated, tested to
  100,000."* — capability stated LIVE, no over/under-claim.
- ✅ **Direct capability** ("check our generated conjectures against known mathematical results,
  or is that still under development?"): *"I can check… This capability is live and uses the
  curated M2 literature seed pack + the novelty gate"* + match/non-match caveats + offer to re-run.
- ✅ **Canonical repro** (generator run → unrelated fleet turn → clear novelty question, packet
  aged out of context): same honest framing as the reported phrasing. The bug is gone.
- ⚠️ **Bare pronoun** ("are those survivors novel?"): honest CLARIFY ("what do you mean by
  novel…?") — NOT the bug (no "under development"), but route-dependent; clarify counts as honest.

NOTE: the FIRST live call fired against the old build mid-deploy (push→serve lag) and still
showed the bug — always confirm the Vercel deployment is `state:"READY"` with `githubCommitSha`
== your commit before trusting a live result. The widening commit (bbb7120) was driven by a
natural phrasing that the offline mirror's hand-picked phrasings didn't cover.

### Option (b) — grounded recall (commit 7687a68, production READY)

Grounding check (read-only SQL on the live `collatz-m3` thread): the model's "3 match a known
form" was REAL (`metadata.m3_known_form` on every recent run summary), but "24 surviving
conjectures" conflated *mined survival* (24) with *persisted survivors* (capped at 5; known-form
matches are down-ranked out). `buildM3NoveltyRecall` now injects the latest run-summary note as a
GROUND-TRUTH RECALL packet.

- ✅ **Reported phrasing, fresh session** → *"based on the latest M3 generator run (seed 7)… 23
  survived… 3 match a known result form… 20 did not… persisted 5, prioritizing non-matches."*
  Real figures, correct survived-vs-persisted labeling, no fabricated counts.
- ⚠️ **Bare pronoun** ("are those survivors novel?") → still an honest clarify (detector fires +
  packet injected, but the model clarifies the terse question). Not the bug; route-dependent;
  left as-is. Optional further polish: nudge the directive to answer-not-clarify when a recall
  packet is present.
