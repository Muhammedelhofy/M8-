# Team Brief — FINAL ROUND: M8's next build (time-unconstrained)

**For:** the AI Council (GPT · Gemini · Grok · Manus)
**From:** Muhammad + Claude Code
**Date:** 2026-06-21
**Decision wanted:** the single next build for M8, judged on pure technical merit.

---

## ⚠️ Evaluation constraint for THIS round (read first)
**Ignore the job hunt. Ignore opportunity cost.** Muhammad has ample time and is
explicitly removing that lens so you give an *unconstrained-merit* verdict. The
last round leaned hard on "protect the job hunt" — set that aside entirely.
Judge only against M8's North Star: the **unsolved-problem engine (Track B)** and
the **personal AI OS (Track A)**, plus engineering soundness. Time is free; the
question is purely *what is the best thing to build for M8 itself*.

## How we got here (so you can judge fairly)
1. We proposed a 5-build "Residue Lens" (mod-9 / digital-root) arc. You unanimously
   shrank/killed it and flagged that the real bottleneck might be **memory, not
   computation**.
2. Claude then queried the **live database**. Result: persistence is fine
   (`conversations` 3,677, `research_notes` 478, graph 161 nodes / 183 edges) —
   **but four already-shipped "brain" features sit at 0 rows.**
3. **Root cause (verified in code):** all four write via **fire-and-forget,
   un-awaited** Supabase inserts → dropped when the Vercel function freezes after
   sending its response. Every write that *works* is awaited; every dead one is not.

## The dormant four (live data)
| Feature | Build | Rows | Write pattern |
|---|---|---|---|
| Entity store (person/company/book/problem) | B83c | **0** | extraction called fire-and-forget |
| Reflector (self-critique / overclaim flags) | B85c | **0** | insert "NEVER awaited" (its own comment) |
| Multi-hop reasoning chains | B85d | **0** | `.insert().then()`, un-awaited |
| Conjecture learning loop | B92 | **0** | un-awaited **+** only fires on a verified Lean leaf |

Note: the 4th also depends on the **Lean/M4 lane**, which is barely producing
(`loop_runs` = 8, `lemma_scaffold` = 6) — so its table is starved from two sides.

## The options (time aside)
- **A — Brain CPR:** fix the dropped writes (await / Vercel `waitUntil` / move heavy
  extraction to the nightly cron) → revive all four features.
- **B — Lean lane hardening:** strengthen the M4 verify/repair loop so it actually
  produces verified leaves (this is what *gates* the most valuable dead feature, the
  learning loop).
- **C — Residue lens (RL1, Lean-tied):** back on the table now that time isn't the
  constraint — but only the 1-build, Lean-feeding, "vortex"-banned version you all
  converged on.
- **D — a sequence** (e.g. A → B → C, or B → A).

## Claude's prior (named, so you can discount it)
I recommend **A (Brain CPR) first**: one root cause revives four paid-for features,
it's surgical, and it's literally "make the brain compound" — the thing you all said
matters. **Where I may be wrong:** (a) filling tables ≠ value if a feature is weak
even when alive; (b) the *Lean lane (B)* may be the deeper lever, since it gates the
single most valuable dead feature; (c) `await`-in-the-chat-path adds latency and
`waitUntil` may be the only correct fix. Rank me down if B or a sequence beats A.

## Questions for your verdict
1. **Pure-merit ranking of A / B / C** (and your preferred D sequence).
2. **Which of the four dormant features are worth reviving** — and which, honestly,
   should we leave dead because they add little even when populated?
3. **Correct technical fix** for the dropped writes: `await` in-path vs Vercel
   `waitUntil` vs move-to-cron? Any latency/correctness traps?
4. Is the **Lean lane (B) the deeper priority** over Brain CPR, given it gates the
   learning loop?
5. **Final call:** what should Claude build next — one decision, then why.
