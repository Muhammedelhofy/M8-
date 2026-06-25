# Build-148 — proactive daily brief: Family Wallet section — LIVE TEST

Sequence item #9 (final feature). Folds a wallet summary into the morning brief —
EMAIL-ONLY, opt-in, fail-safe — built with maximum caution on the live brief core.

## The privacy constraint that shaped it
The brief TEXT is injected into an LLM when shown in chat (orchestrator.js:840). So
money figures must NOT go in `formatBriefText`. The wallet section therefore renders
ONLY in `formatBriefHTML` (the deterministic email to Muhammad) — never the LLM path.
A test (build148) statically guards this: formatBriefText must contain no "wallet".

## Safety (all three, per the HANDS-OFF-core caution)
1. **Default OFF** — `M8_BRIEF_WALLET_ENABLED=1` to turn on. Until then the brief is
   byte-identical (same proven pattern as attachNudgeActivity/attachDueTasks).
2. **Import-isolated** — `require("./wallet")` lazily inside the function; a load error
   can't break the brief module.
3. **Fail-safe** — try/catch; any wallet hiccup leaves the brief valid and unchanged.

## What the email section shows (when enabled)
Spent / income this month (native per-currency, ▲▼ vs last month), bills due soon,
and budget watch (categories ≥ 80%). Code-computed, no `note`, never to an LLM.

## Offline (passed)
- `M8/tests/build148-brief-wallet-test.ps1` → **7/7** (privacy invariant + gate +
  lazy-import + render). Full regression 135–147: **0 failures** (158 tests total).

## To enable (Muhammad's call, on Vercel)
1. Confirm the morning brief reaches you by EMAIL (this section is email-only).
2. Set env `M8_BRIEF_WALLET_ENABLED=1` on the M8 Vercel project → redeploy.
3. Next 7am brief email includes the wallet section. Unset to remove instantly.
