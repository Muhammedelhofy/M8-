# Parallel Session — B-157 · WALLET⇄FLEET EXECUTION GATE + flip + clean
**Model: Opus · Effort: MAX** (central file; fixes a LIVE user-facing bug; must-not-regress)
**Branch:** `feat/b157-wallet-fleet` off `origin/main`
**⛔ SEQUENCING: DO NOT START until B-156 is MERGED to `main`.** You and B-156 both edit
`lib/orchestrator.js`; branch off the UPDATED `origin/main` (which must contain B-156) or you will
conflict. Confirm B-156 is on `main` first (`git log origin/main --oneline | grep -i b-156`).

## STEP 0 — create your ISOLATED worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/b157-wallet-fleet ../../M8-b157 origin/main
```
`cd ../../M8-b157`; verify `git rev-parse --abbrev-ref HEAD` = `feat/b157-wallet-fleet`. Never work in
the shared `Bolt/M8` checkout alongside a live session.

## THE BUG — proven by a live test (2026-06-29 ~04:05, his phone + the shadow log)
**The router is NOT the problem. The wallet HANDLER is.** For three real fleet questions, BOTH the
live arbiter AND the new registry classified them `fleet` correctly — but a wallet sub-lane fired
anyway and answered with his PERSONAL money:

| He asked (clearly fleet) | Arbiter decided | He WRONGLY got |
|---|---|---|
| "how many drivers in the bolt fleet already exceeded net earning of 4000 sar this month" | fleet ✓ | personal net (income−spent) |
| "i want net earning in ALL JUNE" (after "fleet numbers") | fleet ✓ | personal net |
| "TOTAL NET EARNING PER DRIVER FROM 1ST OF JUNE TILL 28TH OF JUNE" | fleet ✓ | "Total expenses on Jun 1: 0 SAR" |

Root cause: the wallet **income/net** lane (Build-141) and **expense-by-date** lane (Build-138) were
added AFTER the Build-152 arbiter and **do not respect `arb.domain === "fleet"`** — they run inside
`handleWalletCommand` and answer first. The B-152 wiring gated only SOME wallet lanes (breakdown,
capability fallback) with the arbiter; the newer lanes slipped the net. Classic whack-a-mole — the
exact thing the registry exists to end.

## PRIMARY FIX (ship this first — it kills the live pain)
Make `handleWalletCommand` (lib/orchestrator.js) **honor the arbiter centrally**: when
`arb.domain === "fleet"`, NO wallet sub-lane may answer — return `null` so the fleet path runs.
- Audit EVERY wallet sub-lane (income/net, expense-by-date, breakdown, total, last_expense, member,
  convert, add, payment-check) and route them all through ONE `arb`-aware guard at the top, not
  per-lane `!looksFleet`. One decision, enforced once.
- Re-run his three phrasings: each must now reach the FLEET path, never the wallet/finance answer.
- Do NOT break the wallet queries that WORK today: "tell me sara's last expense", "her total in
  june", "give me the breakdown highest to lowest", "what is my spend in june" → all still wallet.

## THEN (same boundary, same file — the V2 "flip + clean")
- Flip wallet/fleet/finance routing to be decided by `domain-arbiter.classifyAll()` (the registry),
  behind a kill switch (e.g. `M8_REGISTRY_CRUD=1`, default OFF).
- **Remove the now-redundant scattered `!looksFleet` per-lane guards** — the central guard replaces them.

## HANDLER GAPS (optional this build; backlog if out of scope) — these are NOT routing
- Currency filter: "what's the breakdown on 921 sar" returned a mix incl. EGP. A "breakdown on N <cur>"
  must filter to that currency only.
- Per-driver date-range fleet breakdown: "net earning per driver, all June" resolved to fleet but gave
  the daily snapshot — no per-driver-range breakdown exists. New fleet feature or backlog it.

## Owns / Do NOT touch
- OWN: `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/capability-registry.js`, `lib/fleet.js`
  (only if adding the per-driver-range breakdown), `tests/build157_*`.
- Other sessions are done; still, `git add` your OWN files only (never `-A`).

## Constraints + test
- Privacy wall ABSOLUTE; free-LLM default; Vercel **12-fn cap FULL** (no new `api/*.js`); confirm-before-write.
- Node ABSENT → `tests/build157_walletfleet.test.ps1` PS-5.1 mirror: assert the 3 fleet phrasings →
  fleet AND `handleWalletCommand` returns null for them; assert the 4 working Sara/owner wallet
  queries are UNCHANGED. Plus a live phone re-test of all of the above.
- Zero money mis-routes stays the hard gate. **No push to `main` without Muhammad's explicit OK.**
- Finish: `reports/build-157-done.json` → commit → push the BRANCH.
