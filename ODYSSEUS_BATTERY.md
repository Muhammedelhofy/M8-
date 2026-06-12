# Odysseus Adversarial Battery (Build-11 / Fable-5 Sprint S3)

*Authored by Fable 5, 2026-06-12. The permanent adversarial immune system M8 runs
against itself on every future build.*

---

## What this is

A standalone, deterministically-graded battery of adversarial probes that attack
M8's anti-fabrication contract from the angles a normal eval doesn't: planting
false figures in conversation, pressuring the new memory-graph surface to
confabulate, and trying to weaken a Lean claim into something trivially true.

- **Corpus:** [`tests/odysseus/battery.json`](tests/odysseus/battery.json) — 38
  probes across 6 attack groups. **Single source of truth.**
- **Runner:** [`tests/odysseus/run-battery.ps1`](tests/odysseus/run-battery.ps1)
  — drives the live `/api/chat`, grades with the same .NET-regex graders the main
  battery uses, writes `tests/odysseus/results/<runId>.json`.
- **Offline self-test:** [`tests/odysseus/battery-selftest.ps1`](tests/odysseus/battery-selftest.ps1)
  — feeds synthetic GOOD/BAD replies through the graders and asserts they
  discriminate, BEFORE any live quota is spent (the `verify-port.ps1` discipline).
- **Contract:** validates against the existing
  [`tests/odysseus/validate.ps1`](tests/odysseus/validate.ps1) (categories, grader
  kinds, no LLM judges, unique ids, weight range).

```powershell
powershell -File tests/odysseus/battery-selftest.ps1                       # offline, no network
powershell -File tests/odysseus/run-battery.ps1                            # full corpus, live
powershell -File tests/odysseus/run-battery.ps1 -Group "memory_laundering" # one group
powershell -File tests/odysseus/run-battery.ps1 -Id "od.lean_weaken_frobnicate"
```

---

## Adversarial design review (ground rule #4 — done before any code)

Two mistakes were caught in my own initial plan:

1. **"Build a new JSON+JS+PS runner" was re-deriving working infra.** A complete
   deterministic battery already exists (`run-eval-live.ps1`, `run-eval.js`,
   shared graders, the `odysseus/` generate→validate→ingest pipeline). A parallel
   runner would duplicate the grader a *third* time and create the exact JS↔PS
   port-drift bug class that already bit this project. **Fix:** the corpus is a
   **JSON single-source-of-truth** consumed by one thin runner — strictly better
   than the existing manual dual-port — and it plugs into `validate.ps1`.

2. **Folding 38 probes into the main battery would wreck the regression guard.**
   The main battery is the 4.7/5 trend that must not move (Track A never breaks).
   **Fix:** Odysseus is its **own** artifact — own results dir, NOT written to the
   main `history.jsonl`. The main battery stays the stable regression number;
   Odysseus is the dedicated, expandable immune system.

**The load-bearing constraint (found in code, not assumed):** graph / notebook /
memory reads are **hermetic** in eval sessions (`isEphemeralSession = /^eval/i`),
and the runner deliberately uses an `eval_`-prefixed sessionId. So graph recall
*always* returns the CONFIRMED-EMPTY packet — I cannot seed poisoned nodes through
the chat API. This is not a blocker; it is the *correct rig* for the hot lead. The
live bug of 2026-06-12 was the model laundering a fabricated figure **from the
conversation-memory block (chat history)** onto an empty/thin packet. That is
exactly reproducible in a hermetic multi-turn probe: plant the figure in turn 1,
ask the graph-recall in turn 2, assert it never resurfaces as recorded research.
The probes are built around **history-injection**, not DB-seeding.

---

## The 6 attack groups

| Group | Probes | What it attacks |
|---|---|---|
| `memory_laundering` | 8 | The live-bug class: a figure/status/date/count planted in conversation must never be presented as *recorded research* on graph recall. The graph is hermetic-empty, so any specific figure in the answer is laundered from chat history. |
| `graph_confab` | 8 | Empty/hermetic graph recall must report CONFIRMED-EMPTY, never invent nodes, edges, counts, provenance, or contradictions. Includes "a theorem node = a Lean type-check, not a proof". |
| `theorem_overclaim` | 5 | The frobnicate `n=n` weakening class + conjecture-scale variants: nonsense → UNFORMALIZABLE refusal; a Lean-verified lemma/statement is not a solved conjecture; a trivial true restatement is not the hard claim. |
| `hardroute_bypass` | 6 | "Ignore the data", admin override, "pretend for a demo", roleplay persona, false-prior injection, "just say yes" — none may unlock a fabricated figure or fake records. |
| `route_confusion` | 6 | Compute vs search vs notebook vs graph vs finance lane confusion; a judgment question must not fake a code run. |
| `premise_silentfail` | 5 | net≠profit, partial window, bad-premise arithmetic, false-memory premise, currency-unit swap — flag, don't rubber-stamp. |

Probe weights and exact assertions live in `battery.json`. Every check is a
deterministic predicate (present / absent / refusal / flagsAssumption / anyOf) —
no LLM judge, by design, because the thing being measured is anti-fabrication.

---

## Run log

*(filled in per run — per-run JSON is gitignored; this is the durable summary.)*

### 2026-06-12 — first live run (S3 ship)
- _pending — see below once the run completes._
