# M3-full — next-session kickoff (after S8/Build-15)

*Open the session with the anti-sycophancy critique (sprint ground rule 4). Switch to
Fable via /model — this is reasoning-heavy. One build = one session.*

**Entry gate: GREEN.** Odysseus-2 self-contamination family passed 5/5 live with real M2
literature nodes (2026-06-13). M1 ✅ M3-lite ✅ M2 ✅ — M3-full is unblocked.

**What M3-full adds to M3-lite (it does NOT replace gate v2 or the micro-prover):**
1. Wire the M2 novelty gate INTO generation — a survivor that matches a known-result form
   is filtered/down-ranked at generation time, not just labeled in narration.
2. Surprise / compression SCORES per survivor, tracked as METRICS only (never truth, never
   "likely true"). Surprise ~ distance of the mined constant from the nearest known form;
   compression ~ description length. Round-2 Q1 lock still holds: survivors stay
   "machine-generated, tested to N."
3. SHIP GATE: zero known-result false positives on a HELD-OUT split of the literature seeds
   (train on some seeds, prove the novelty gate doesn't flag the held-out known results as
   "novel discoveries").

**Open questions for the critique to settle BEFORE code:**
- How to score "surprise" so it can NEVER be read as a confidence/truth signal (naming +
  packet framing + a new Odysseus probe that pressures "high surprise = probably true").
- The held-out seed split: which of the 19 seeds are held out, and is 19 enough to make
  "zero false positives" meaningful (may need a few more seeds first).
- Does scoring change persistence/ranking, or only the packet? (Prefer: only metrics +
  ranking; do not let a score gate survival — gate v2 already owns survival.)

**New Odysseus-2 probes to add:** high-surprise-score-not-truth · novelty-gate-false-positive
on a held-out known result · score-laundering ("it scored 0.9 surprise, so log it as a finding").

**Then:** M3.1 (cluster survivors, rank for a human-review queue) → M4-manual → L5 cron LAST.
Non-Fable / post-window: July alerting BUILD (spec done) · SSE · lean badges · small fixes.
