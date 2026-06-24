# M8 Intent Routing — Phase 2 Handoff (next session)

**Tracker:** `INTENT_UPGRADE_ROADMAP.md` (status table + changelog) · **Memory:** `[[m8-intent-routing]]`

## Where we are
- **Phases 0 / 1 / 1.1 / 2 = LIVE-VERIFIED on prod** (m8-alpha, latest **`67c44e1`**).
- **Phase 2 (wallet reference resolution) = DONE.** Build-123 (references) + Build-124 (privacy strip) +
  Build-125 (edit-"yes" reconstruction). Confirmed on his device 2026-06-24: `change that to 40` →
  update card → `yes` → "Done ✓ updated the last expense to 40 EGP." Offline `tests/phase2-reference-test.ps1`
  **48/48**. Rollback = Vercel → `d4af231`.
- **NEXT = Phase 3** (tasks + notes), then Phase 4 (fleet harder to enter).

## What Phase 2 does (wallet lane only)
Anaphoric commands now resolve to the **single last M8-added expense**, but only right after a wallet turn:
- `change that to 40` / `make it 45` → edit-confirm card → `yes` updates.
- `remove it` / `undo that` / `scratch it` / `get rid of the last one` → **honest** "can't delete from chat,
  I can edit it / Wallet app" (NO delete power — that's gated/later).
- `the last one` → echoes the last expense. Arabic: `احذف آخر مصروف`, `خله ٤٠` work.
- New in `lib/orchestrator.js`: `refHasAnaphor`, `parseReference`, `walletRefContext`, `handleWalletReference`
  (wired before the Phase-1 intent brain); Tier-2 gate also fires on a fuzzy anaphor with wallet context.

## 🔴 BEFORE deploying — Muhammad tests LIVE (prod is the only real test; wallet can't run on a preview)
This branch is **not** on prod yet. To ship it: merge `phase2-reference` → `main` (auto-deploys), OR
redeploy. **Only on his explicit "go."** Rollback = Vercel → `d4af231`.

After it's on prod, run `tests/PHASE2_LIVE_TEST.md`:
1. `throw 30 egp to groceries` → `yes` (creates context) → then `change that to 40` → confirm → `yes`.
2. `remove it` → honest message naming "30/40 EGP · Groceries".
3. In a NON-money chat, `remove it` must **not** be claimed by the wallet.

## Invariants (unchanged, never break)
AI proposes → confirm-gated → amount deterministic → privacy (live-msg-only, masked) → never guess
between matches (only the single last write) → no new delete authority.

## Gotchas banked this build
- **`\b` is ASCII-only in JS** → a trailing `\b` after Arabic letters never matches. Arabic patterns use
  substring-on-stem instead. (Same trap likely lurks in older Arabic regexes, e.g. `parseAddExpense`.)
- **PS mirror:** never name a helper `H` — `h` is the `Get-History` alias and PS is case-insensitive.
- **Pre-existing (not fixed):** after an edit, the "old value" shown can be stale (`getLastM8Write` reads
  the original add row); the edit still targets the correct txn by id.

## Next (after Phase 2 lands)
- **Phase 3** — wire the intent core + reference resolution into **Tasks + Notes** (generalize across lanes).
- **Phase 4** — Fleet: make it **HARDER** to enter (unknowns → "unknown" → Phase 0, never into fleet);
  any fleet AI is READ-ONLY. This is the real "make me rich" mis-claim fix.
