# Parallel Session — B · PER-DRIVER DATE-RANGE FLEET BREAKDOWN
**Model: Sonnet · Effort: HIGH** (bounded; fleet engine, NOT the router)
**Branch:** `feat/fleet-per-driver-range` off `origin/main`
**Runs in PARALLEL with B-157 (router) — they are DISJOINT files. Start after B-156 merges.**

## STEP 0 — create your ISOLATED worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/fleet-per-driver-range ../../M8-fleet origin/main
```
`cd ../../M8-fleet`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.

## The gap (from the 2026-06-29 live test)
Muhammad asked **"TOTAL NET EARNING PER DRIVER FROM 1ST OF JUNE TILL 28TH OF JUNE"** and got a wrong
answer. Two separate bugs: (1) it was mis-handled by the wallet lane — **the B-157 session fixes the
routing**, not you; (2) even when it reaches fleet, there is **no per-driver date-RANGE breakdown** —
the fleet lane returns a daily snapshot or MTD list. **Your job is (2): add a per-driver net-earning
breakdown for an arbitrary date range.**

## What to build
A fleet capability that answers "net earning per driver from <date> to <date>" / "per-driver June" /
"each driver's net this month" with a ranked per-driver list (driver → net for the range).
- The engine ALREADY computes per-driver figures — the morning brief's "Exceeding Target / projected"
  per-driver MTD list proves it. **Find that path** (likely `lib/fleet-analysis.js`, `lib/pnl-engine.js`,
  or `lib/fleet-report.js`; per-driver P&L via `computeDriverPnL`) and add a **date-range variant**
  (start..end) rather than month-to-date only. Reuse the existing P&L math; do not reinvent it.
- Make the result available to the fleet context/packet the fleet lane already builds (`buildFleetContext`
  in `lib/fleet.js`), so the existing fleet reply path can render it.

## Owns / Do NOT touch
- OWN: `lib/fleet.js`, `lib/pnl-engine.js`, `lib/fleet-analysis.js`, `lib/fleet-report.js`,
  `tests/fleet-per-driver-range.test.ps1`.
- **DO NOT TOUCH `lib/orchestrator.js`** (the B-157 router session owns it). If you find you need a new
  route/sub-intent hook in the orchestrator, **STOP and FLAG it** in your report for the B-157 session
  to wire — do not edit orchestrator yourself (that's a merge collision).

## Constraints + test
- This is FLEET/business data (his job tool) — no personal-wallet privacy wall here, but keep money
  figures out of any LLM PROMPT used for classification (rendering the final number to him is fine).
- Free-LLM default; Vercel **12-fn cap FULL** (no new `api/*.js`).
- Node ABSENT → `tests/fleet-per-driver-range.test.ps1` PS-5.1 mirror over sample fleet rows: assert the
  per-driver range breakdown sums correctly and ranks high→low. **Live test waits for B-157 to merge**
  (until the wallet lane stops stealing the question, the live turn can't reach fleet).
- Finish: `reports/fleet-per-driver-done.json` → commit → push the BRANCH. **No push to `main` without OK.**
