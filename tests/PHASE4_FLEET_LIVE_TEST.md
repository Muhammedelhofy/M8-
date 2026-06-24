# Phase 4 — Fleet RESHAPE (make Fleet HARDER to enter) · Live Chat Test

**Branch:** `phase4-fleet` · **Changed:** `lib/fleet.js` ONLY (the chat fleet lane's
`buildFleetContext` entry/gating + two new helpers `bareNameCandidate` / `fleetCapabilityReply`).
The Bolt sync (MHMBOLT) and the 7am brief are untouched. Fleet is **READ-ONLY** — no writes.

**The fix (one line):** unknown / non-fleet text is never claimed as a driver name and never loops
"which account?". A bare short reply is treated as a driver ONLY if it matches a REAL driver on the
roster; otherwise it falls through to normal chat. False negative (miss a real fleet query) is OK;
false positive (claim non-fleet text) is what we killed.

## A. The reported bug — must NOT loop
| # | Type this (in a session where you JUST asked something fleet) | Expect |
|---|---|---|
| 1 | `make me rich` | a normal chat reply — NOT "I don't have a driver by that name / which account?" |
| 2 | `make me money` | normal chat — no driver loop |
| 3 | `thank you` / `purple monkey dishwasher` | normal chat — no driver loop |

## B. Real fleet queries still work (regression)
| # | Type this | Expect |
|---|---|---|
| 4 | `how did the fleet do this week` | the weekly rollup (real net/orders) |
| 5 | `what was net yesterday` | yesterday's snapshot |
| 6 | `who can hit 5000 SAR this month` | the pace-to-target list + chart |
| 7 | `give me the morning brief` | the full exec brief |
| 8 | `how much did <a real driver> make` | that driver's real line |

## C. Driver disambiguation still honest (read-only, never guess)
| # | Type this | Expect |
|---|---|---|
| 9 | `how did Ali do` (2+ drivers named Ali) | "more than one driver matches: … which?" — NOT a silent pick |
| 10 | then reply the full bare name `Ali Alshahrani` | resolves to that driver (bare-name reply still works WHEN it's a real driver) |
| 11 | `how much did <a made-up name> make` | honest "I don't have that Bolt account" — never invents figures (this is correct, not a loop) |

## D. Capability net (no data / unresolvable)
| # | Situation | Expect |
|---|---|---|
| 12 | a fleet ask when no data is synced | "I can read fleet earnings/brief/driver stats … e.g. 'how did the fleet do this week'" — never a fabricated number |

## Offline checks already done
- `tests/phase4-fleet-gate-test.ps1` → **24/24** (looksFleet classification + the entry-gate decision:
  fall-through vs driver vs snapshot vs honest not-found, incl. the "make me rich" loop case).

## What to watch for
- ✅ A non-fleet phrase in a fleet chat → normal answer, never "which account?".
- ✅ A real driver name (even bare, as a reply) → still resolves.
- ✅ Fleet stays READ-ONLY — no message ever changes fleet data.
- 🔴 If ANY stray phrase still triggers a "which driver / which account?" loop → tell me the exact words.
