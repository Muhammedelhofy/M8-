# Build-151 — wallet/fleet foundation fix — LIVE STRESS TEST (Muhammad's phone)

**Honest status:** I CANNOT verify this live from here (M8 runs on your phone). The offline
test (build151) checks the routing *decision*, but the real proof is you running these.
Until you confirm, this is **shipped, not "done."**

## What changed
1. **"my spend / what did I spend" → YOU (Muhammad) only** — not the household total.
   "Sara" → Sara; "our / total" → both.
2. **"breakdown" routes to the WALLET** (category breakdown by person + period), and
   **remembers the number it just gave** ("what's the breakdown?" after a total).
3. **When it can't tell wallet from fleet, it ASKS** ("your personal wallet or the fleet?")
   instead of silently jumping to driver numbers.

## Stress scenarios — run these EXACT messages
For any that fail, send me **the exact words you typed** so I add it as a route.

### A — Person split (you / Sara / total)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `what is my spend in june` | **YOUR** total (~497 SAR) — labelled "Muhammad", NOT the 6,642+497 combined |
| 2 | `how much did Sara spend in june` | Sara only (6,642 EGP) |
| 3 | `what is our total spend in june` | both (6,642 EGP + 497 SAR) |
| 4 | `what is my total expense in june` | YOU (497 SAR) — "my" wins over "total" |

### B — Wallet vs fleet + breakdown
| # | Type this | Expect |
|---|-----------|--------|
| 5 | `breakdown of my spend in june` | wallet **category** list (Iqos/Food/…), NOT drivers |
| 6 | `am talking about my wallet, what is the breakdown of my spend in june` | same wallet breakdown |
| 7 | (right after #1) `what's the breakdown?` | breaks down YOUR 497 by category |
| 8 | `breakdown of the 497 sar` | same (it remembers the number) |
| 9 | `give me the breakdown` (fresh, no context) | **M8 ASKS: "your personal wallet, or the fleet numbers?"** |

### C — No regression (fleet + basics still work)
| # | Type this | Expect |
|---|-----------|--------|
| 10 | `how are my drivers doing` | fleet brief (unchanged) |
| 11 | `how much did I spend this month` | your total + "up/down % vs last month" |
| 12 | `what's my last expense` | YOUR last expense (Muhammad's) |

**Pass bar:** A1–A4 split correctly; B5–B8 stay in the wallet; B9 ASKS; C10–C12 unbroken.
If #9 doesn't ask, or any wallet question still shows driver numbers — that's a miss, tell me.
