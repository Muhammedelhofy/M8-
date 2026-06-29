# Build-157 — WALLET⇄FLEET EXECUTION GATE — live phone test

**What changed:** when the front-door decision is **fleet** (or business **finance**), the wallet
handler now ABSTAINS centrally — so a fleet question can no longer be answered with your personal
money. Fixes the 2026-06-29 live bug where "net earning per driver" returned personal net / "Total
expenses on Jun 1: 0 SAR".

**Offline mirror:** `tests/build157_walletfleet.test.ps1` → **43/43 pass** (Node is absent on the
host; this is the PS-5.1 mirror). Adjacent routing suites (152/155/156/151/153/135/136) still pass.

---

## 1) The 3 bug phrasings — each MUST now answer with FLEET numbers (NOT your wallet)

| # | Type exactly | PASS = | FAIL (the old bug) = |
|---|---|---|---|
| 1 | `how many drivers in the bolt fleet already exceeded net earning of 4000 sar this month` | a fleet/driver answer (count of drivers over 4000) | a personal "net = income − spent" figure |
| 2 | `fleet numbers` then `i want net earning in all june` | June **fleet** earnings | personal net for June |
| 3 | `total net earning per driver from 1st of june till 28th of june` | fleet/driver earnings (or an honest "I don't have a per-driver range breakdown yet" — see backlog) | `Total expenses on Jun 1: 0 SAR` |

> Note for #3: routing is fixed (it reaches the fleet path). A *per-driver date-range breakdown* is a
> separate fleet feature that doesn't exist yet — see the HANDLER GAPS backlog. The hard requirement
> here is **no personal-money answer**.

## 2) The 4 working wallet queries — each MUST still answer from your WALLET (unchanged)

Run these in a wallet context (ask one wallet question first so anaphora has something to point at):

1. `tell me sara's last expense` → Sara's latest expense.
2. (after a wallet answer) `her total in june` → that member's June total.
3. (after a wallet answer) `give me the breakdown highest to lowest` → your category breakdown.
4. `what is my spend in june` → your June spend.

If any of these now says "do you mean wallet or fleet?" or jumps to the fleet engine → FAIL (report it).

## 3) How to confirm the routing (optional)

The shadow log records the decision lane. In Diagnostics / `m8_router_misses`, the 3 fleet phrasings
should log `arb` domain = **fleet** (`fleet_only` or `fleet_context`); the 4 wallet phrasings = **wallet**.

## 4) V2 flip — OFF by default, opt-in only

The wallet/fleet/finance boundary can be decided by the capability registry instead of the B-152
arbiter, behind **`M8_REGISTRY_CRUD=1`** (Vercel env var, default **OFF**). Leaving it unset = today's
arbiter behaviour, byte-for-byte. Turn it on only to live-test the registry flip; the central gate
above protects both modes. Kill switch to revert: remove the env var (or set `=0`) and redeploy.
