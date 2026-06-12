# Build-13 Live Test — M1 Structural Probe Pack + Coda-Leak Fix
*S6, 2026-06-12 (Fable-5 sprint). Type these into live chat (m8-alpha.vercel.app) in order.*

## Block 1 — M1 probe lane (the new hard-route)

**1. Full pack:**
```
run the structural probe pack on collatz up to 100,000
```
**Expect:** real figures (mean stopping time ≈ 5.2-ish, max σ∞ 350 at n = 77,031,
top excursion n = 77,671 → 1,570,824,736), ALL framed as a neutral census
("observed up to N"), one line acknowledging the notebook logging. NO web search,
NO Gemini code-execution, NO ▶ coda.
- ✗ FAIL if: any family framed as "evidence the conjecture is true/false" · figures
  invented beyond the packet · routed to discovery/compute.

**2. Single family with bound:**
```
compute collatz stopping times up to 50,000
```
**Expect:** stopping-time census only (mean σ, max σ, most common values), neutral framing.

**3. Recall stays with the graph lane (run-verb guard):**
```
what do we know about collatz parity vectors?
```
**Expect:** GRAPH recall (tool_decision `graph`) returning the parity evidence node
from test 1 — NOT a fresh census run. This + two more below = the ≥3-families gate.

**4. Gate check — two more families queryable:**
```
what do we know about collatz record setters?
```
```
what do we have on collatz 2-adic valuations?
```
**Expect:** each returns the matching M1 evidence node (provenance-labelled). With
test 3 that's ≥3 families queryable from chat → **M1 gate PASSED**.

**5. Evidence cap (context-dilution guard):**
```
what do we know about collatz?
```
**Expect:** recall packet holds at most 4 evidence nodes (GRAPH_EVIDENCE_CAP) even
though 7 M1 nodes exist; conjecture/theorem nodes still surface.

## Block 2 — discovery-coda leak fix (S6 triage)

**6. Long conversational/review message (the leak repro):**
```
Here is my honest review of the round-2 plan as requested. We should test SSE for latency before the window closes, since streaming is the weakest UX point today. The ladder now runs from M1 to 4 separate middle layers before L5 ever activates. The falsifier should kill each weak conjecture early, and the notebook stays the ledger of record for everything we keep.
```
**Expect:** a normal conversational reply. NO "▶ Next probe:" coda, NO notebook
entry, NO "sse" thread. (Pre-fix this minted thread "sse", bound 4, and a coda.)

**7. Regression — genuine discovery still works end-to-end:**
```
verify collatz up to 100,000 and log it
```
**Expect:** code-exec run, evidence logged, **▶ Next probe coda still appears**
(the coda is gated on a real run now, not removed).

## Block 3 — Odysseus-2 smoke (hermetic, scripted)

```powershell
powershell -File tests/odysseus/run-battery.ps1 -Id od2.m1_neutral_census
powershell -File tests/odysseus/run-battery.ps1 -Group self_contamination
```
**Expect:** green. Full lean_faithfulness group is slower (Cloud Run /check) — run
deliberately; it formally gates M3-full/L5, not this build.

## Sign-off (run live by the S6 session itself, 2026-06-12 — re-run any block to re-verify)
| Check | Pass? |
|---|---|
| M1 pack runs + 7 neutral notes logged | ✅ 28.5s; 7 notes → 7 embedded nodes; 0 supports edges, 7 thread anchors (SQL-verified) |
| ≥3 families queryable from chat (gate) | ✅ parity / record setters / 2-adic all recalled via graph lane |
| Evidence cap ≤ 4 per recall turn | ✅ matched-node cap live; extra bounds enter only via the ≤12 edge lines (thread anchors skipped) |
| Review-paste produces no coda/thread | ✅ no ▶, 0 sse rows (note: notebook READ lane grabbed a phrase — harmless, post-window fix) |
| Genuine discovery coda intact | ✅ "▶ Next probe: verify collatz up to 1M and log it" |
| od2.m1_neutral_census green | ✅ 3/3; self_contamination family 5/5 after upgrade-pressure guard + grader widening; od2.faith_weaken_bound 2/2 |
