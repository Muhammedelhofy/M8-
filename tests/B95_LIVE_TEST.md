# Build-95 — Fleet Intelligence Report — LIVE TEST

Offline mirror: `tests/B95-fleet-report-verify.ps1` (51/51). These checks catch the
routing/persistence things the offline mirror cannot: that the orchestrator actually
fires the report slot, folds it into the fleet answer, and that the cost-profile gate
behaves. Type each in M8 live chat (m8-alpha.vercel.app).

Prereq: at least one row in `driver_cost_profiles` (rental + salary/fuel/other), and a
synced Bolt fleet blob for the current month. Without cost profiles the report is
gated OFF (by design) and you should get the normal fleet packet instead.

## Should FIRE the report (company P&L view)
1. **"how is my fleet doing?"**
   - Expect: a COMPANY P&L headline (projected net profit in SAR), per-driver lines
     (net -> projected -> tier; rental + bonus - costs = company net), and a
     RECOMMENDED ACTIONS list. Numbers must match the cost profiles; no invented driver.
2. **"who's my top performer / who needs attention?"**
   - Expect: recommended actions surfaced (offline -> call, on-pace -> encourage,
     below 4000 -> no-bonus warning), ordered by urgency.
3. **"give me the fleet report"** / **"fleet health"** / **"fleet status"**
   - Expect: same report. Bonus/tier framed as a month-end PROJECTION (an ESTIMATE).

## Should NOT be hijacked by the report (precedence)
4. **"morning brief"** / **"who is behind?"**
   - Expect: the Track-A 3-section pace brief (ON TRACK / BELOW / DROPPED), NOT the
     P&L report. (Morning brief keeps precedence.)
5. **"why did net drop yesterday?"**
   - Expect: the change-analysis decomposition (participation x volume x value), NOT
     the report. (Change analysis keeps precedence.)
6. **"what does Ahmed cost me?"** / a P&L/margin question
   - Expect: the finance packet (with the Build-91 cost-profile overlay), NOT the
     fleet-report slot (finance owns the turn).

## Gate / honesty
7. With **no cost profiles configured**: "how is my fleet doing?"
   - Expect: the normal fleet daily packet (report gated off). No fabricated costs.
8. A driver with **no cost profile** present alongside profiled drivers:
   - Expect: listed as "No cost profile on file - company P&L unknown" and EXCLUDED
     from the P&L totals (costs never invented).

## What to watch in Vercel logs
- `[M8] {"step":"fleet_report","drivers":N,"netProfit":X,"actions":K}` confirms the
  slot fired. Absence on Q1-3 = the gate/regex/profiles need a look.
