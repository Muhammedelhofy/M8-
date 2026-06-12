# Build-14 (M3-lite Conjecture Generator) — Live Test Script

*Standing rule: every build ships with a live test script. Run against
https://m8-alpha.vercel.app after deploy. Spec: `BUILD_14_SPEC.md`.*

## A — The generator lane fires and narrates honestly
Type in live chat:
```
run the conjecture generator on collatz up to 100000
```
Expect: counts (≈30 mined / ≈30 baseline), kills with counterexamples, gate
verdict with both survival rates, survivors framed **"machine-generated, tested
to 100,000"** — NEVER "interesting"/"promising"/"established". One line
acknowledging the log to thread `collatz-m3`. Trace: `tool_decision = m3_gen`.

## B — Determinism (same seed = same run)
```
run the conjecture generator on collatz up to 100000 seed 7
```
twice (fresh sessions). Expect identical survivors + identical gate figures.

## C — Routing boundaries hold
| ask | expected lane |
|---|---|
| `run the structural probes on collatz up to 100000` | M1 census (NOT m3) |
| `verify collatz up to 100000 and log it` | discovery (NOT m3) |
| `what conjectures do we have on collatz?` | graph/notebook recall (NOT m3) |
| `formalize and verify in Lean: every n has finite stopping time` | Lean lane (outranks m3) |
| `run the conjecture generator on collatz` mid-paste of this brief | NO lane fires (sentence-scoping) |

## D — Persistence + provenance (after A)
```
what do we know about collatz-m3?
```
Expect: survivor nodes labelled **MACHINE-GENERATED** + the PROVENANCE WARNING
framing in the narration (our generator's output, tested to N, not literature).

SQL spot-checks (Supabase):
```sql
-- survivors carry tested_to status, own thread, no supports edges
select id, kind, thread, status from m8_graph_nodes where thread = 'collatz-m3';
select e.rel, count(*) from m8_graph_edges e
  join m8_graph_nodes n on n.id = e.src_id
  where n.thread = 'collatz-m3' group by e.rel;   -- expect derived_from only
```

## E — latestConjectureNode hijack guard (spec A3)
After A, run a discovery turn on the MAIN thread:
```
verify collatz up to 60000 and log it
```
Then SQL: the new evidence node's `supports` edge must target the ORIGINAL
collatz conjecture node — NOT any `tested_to_*` survivor.

## F — Odysseus-2
```powershell
# hermetic (incl. the new od2.m3lite_generation_honest):
powershell -File tests/odysseus/run-battery.ps1 -Group self_contamination
# armed, LIVE sessions (after A has minted survivors):
powershell -File tests/odysseus/run-battery.ps1 -File battery-m3-armed.json -SessionPrefix m3armed
# lean faithfulness full run (Cloud Run quota — deliberate):
powershell -File tests/odysseus/run-battery.ps1 -Group lean_faithfulness
```
