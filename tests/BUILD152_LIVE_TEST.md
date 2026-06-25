# Build-152 — wallet⇄fleet front-door arbiter — LIVE PHONE TEST (Muhammad)

**Honest status:** I CANNOT verify this from here — M8 runs on your phone. The PS
mirror (`tests/build152_arbiter.test.ps1`, 35/35) proves the *decision logic*; these
messages prove it on the real model + your real data. Until you run them, this is
**shipped, not "done."**

## What changed (plain)
M8 now decides **"is this about my wallet or the fleet?"** in ONE place, by meaning —
before it answers. Before, a greedy fleet matcher could grab a personal-money question
and the "understand it anyway" layer was switched off exactly when needed. Now:
- A clear personal-money question → **wallet** (never drifts to drivers).
- A clear fleet question → **fleet** (unchanged).
- A genuine toss-up → M8 **asks** "wallet or fleet?" instead of guessing — and if you
  reply just **"wallet"** or **"fleet"**, it answers your original question.
- Off-switch if it ever misbehaves: set `M8_DOMAIN_ARBITER_DISABLED=1` on Vercel →
  instantly back to the old behaviour. (`M8_ARBITER_LLM_DISABLED=1` keeps the arbiter
  but turns off the model tie-breaker — toss-ups just ask.)

## Run these EXACT messages. For any miss, send me the words you typed.

### A — personal money must NOT go to the fleet (the headline fix)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `breakdown of my spend in june` | your wallet category breakdown — NOT drivers |
| 2 | `what is my spend in june` | YOUR total (~497 SAR, labelled Muhammad) |
| 3 | `how much did I spend this month` | your total + up/down % vs last month |
| 4 | `what's my last expense` | your latest expense (incl. app-logged) |
| 5 | `how much did Sara spend in june` | Sara only |

### B — the clarifier (ask, don't guess) + the follow-up
| # | Type this | Expect |
|---|-----------|--------|
| 6 | `give me the breakdown` (fresh chat, no prior money/fleet turn) | M8 ASKS: "your personal wallet, or the fleet numbers?" |
| 7 | (right after #6) `wallet` | it answers the **wallet** breakdown of #6 — does NOT make you re-type |
| 8 | `give me the breakdown` then reply `fleet` | it gives the **fleet** breakdown |

### C — anaphora (it remembers what's on screen)
| # | Type this | Expect |
|---|-----------|--------|
| 9 | (after #2's wallet total) `what's the breakdown?` | breaks down YOUR number — stays in the wallet |
| 10 | (after a fleet answer) `what's the breakdown?` | breaks down the FLEET — stays in fleet |

### D — Arabic (the mirror didn't cover this — your check matters most here)
| # | Type this | Expect |
|---|-----------|--------|
| 11 | `كم صرفت هذا الشهر؟` | مصروفك أنت (wallet), مو الأسطول |
| 12 | `وش آخر مصروف لي؟` | آخر مصروف لك (wallet) |
| 13 | `كيف حال السواقين؟` | ملخص الأسطول (fleet — unchanged) |

### E — NO REGRESSION (the ~168 that already work)
| # | Type this | Expect |
|---|-----------|--------|
| 14 | `how are my drivers doing` | fleet brief (exactly as before) |
| 15 | `net earnings yesterday` | fleet net (as before) |
| 16 | `give me the morning brief` | the fleet morning brief (as before) |
| 17 | `add 50 sar lunch` → `yes` | logs the expense (confirm-gated, as before) |
| 18 | `who is the president of egypt` | normal answer / web — NOT a wallet/fleet detour |

**Pass bar:** A1–A5 stay in the wallet; B6 asks and B7/B8 resolve to the right domain
without re-typing; C9/C10 follow the domain on screen; D11–D13 correct in Arabic;
E14–E18 unchanged. If #6 doesn't ask, or any wallet question shows driver numbers, or
M8 asks "wallet or fleet?" on something that's obviously one or the other (an over-ask) —
that's a miss, send me the exact text.

## Rollback
- Mild (turn off just the model tie-breaker): `M8_ARBITER_LLM_DISABLED=1`
- Full (back to pre-152 routing): `M8_DOMAIN_ARBITER_DISABLED=1`
- Code: revert to the commit before this build (branch `feat/domain-arbiter`).
