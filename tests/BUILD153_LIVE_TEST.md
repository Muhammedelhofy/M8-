# Build-153 — "show it all in one currency" — LIVE PHONE TEST (Muhammad)

**What changed (plain):** your breakdown mixes SAR (yours) and EGP (Sara/family). Now you
can ask M8 to show it **all in one currency** and it does the math — using the exchange
rate from your Wallet app (no amount leaves M8, only the rate is used). It also stops
misreading "put all currency in sar" as logging an expense.

**Honest note:** I can't run this from here. Numbers below assume the rate ≈ 1 SAR = 13 EGP
(your Wallet app's actual rate is used live, so the totals may differ slightly).

## Run these
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `put all currency in sar` (right after a breakdown) | the SAME breakdown, every line in SAR + a **Total**, and a "(converted at 1 SAR = X EGP)" note — **no more "how much?"** |
| 2 | `convert to sar` | same — everything in SAR with a total |
| 3 | `breakdown of my spend in sar` | your categories, all in SAR, with a total |
| 4 | `put it all in egp` | everything in **EGP** instead |
| 5 | `one currency` | defaults to SAR |
| 6 | `بالريال` | الكل بالريال + الإجمالي |

## Must still work (no regression)
| # | Type this | Expect |
|---|-----------|--------|
| 7 | `give me the breakdown` | normal breakdown (native SAR + EGP, as before) |
| 8 | `did I pay rent` | the payment check — NOT a currency conversion |
| 9 | `add 50 sar lunch` → `yes` | logs the expense (unchanged) |
| 10 | `how much did I spend in june` | June total (not hijacked by "currency") |

**Pass bar:** #1 converts to one SAR total (and does NOT ask "how much?"); #4 does EGP;
#7–#10 unchanged. If "put all currency in sar" still says "how much?", or a total looks
wrong, send me the exact words + what you saw.

**Off-switch:** `M8_FX_CONVERT_DISABLED=1` on Vercel → disables the convert lane (back to
native per-currency breakdown).
