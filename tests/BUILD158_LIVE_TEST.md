# Build-158 Live Test — Per-Driver Date-Range Breakdown

**DEPENDS ON**: B-157 (wallet/fleet arbiter) must be deployed first so the fleet
lane actually receives "per driver" questions. Until then, the live turn is
intercepted by the wallet lane.

**What was added**: `driverRangeRef` + `driverRangeRankings` + `renderDriverRangePacket`
in `lib/fleet.js`. When the user asks for "net earning per driver from X to Y",
the fleet lane now returns a full ranked list of ALL drivers (not just fleet totals
with top-3) for that exact date window.

---

## Test questions (send on M8 after B-157 is live)

### T1 — Muhammad's original failing question
```
TOTAL NET EARNING PER DRIVER FROM 1ST OF JUNE TILL 28TH OF JUNE
```
**Expected**: A ranked list of all drivers with their June 1-28 net totals,
ordered high to low, with a fleet total. A bar chart appears below the reply.
M8 should NOT give wallet spending or a single-day fleet snapshot.

### T2 — Current-month per-driver breakdown
```
what is the net per driver this month
```
**Expected**: Ranked list for the current month (June so far), same format.

### T3 — Last-week per-driver breakdown
```
how much did each driver earn last week
```
**Expected**: Ranked list for the last 7 completed days.

### T4 — Short date range
```
breakdown per driver from June 10 to June 20
```
**Expected**: Ranked list only for June 10-20 days that are in the blob.

### T5 — "Each captain" phrasing (Arabic-adjacent style)
```
net for each captain from June 1 to June 28
```
**Expected**: Same ranked list. "Captain" should match.

### T6 — Does NOT steal normal fleet-total questions
```
how did the fleet do this month
```
**Expected**: Fleet TOTAL rollup (not per-driver list). Confirms no regression.

### T7 — Does NOT steal single-driver questions
```
how much did Mansour earn from June 1 to June 28
```
**Expected**: Mansour's day-by-day series (the per-driver daily series path),
NOT the full-fleet ranked list.

---

## Routing checks (in the arbiter shadow log `m8_router_misses`)

After T1, check:
- `lane` should be `fleet` (not `wallet`)
- `intent` should NOT be `mission_control` or `driver_series`

## What "PASS" looks like on your phone

- T1 reply starts with a ranked numbered list of drivers with SAR totals
- A bar chart appears below the text
- Fleet total is stated (e.g. "Fleet total: X SAR across N drivers")
- No wallet spending mentioned
- M8 does not say "I cannot generate a chart"
