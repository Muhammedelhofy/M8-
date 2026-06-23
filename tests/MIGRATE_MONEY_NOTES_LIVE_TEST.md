# LIVE TEST — Migrate old money-notes → wallet (assistant-architecture build #3)

Run on prod after deploy. ⚠️ Saying "yes" performs a REAL wallet write (tagged [M8],
audited to m8_wallet_writes). Do the round-trip audit at the end.

## Start
- "migrate my money notes" (or "import my old expenses") →
  "Found 1 possible note. 💸 Old money note — add 30 SAR · Dining · Omar Lord lunch
   to the wallet? Reply yes / skip / stop. (1 left)"
  - Only the **Omar Lord lunch (30 SAR)** should surface — deduped from 3 stored copies.
  - It must NOT offer fleet/business figures (rent 8000, fuel 15000, revenue, profit,
    bonus, investment, invoice…) — those are excluded by design.
  - The amount-less "Khalid owe-back" note must NOT surface (no amount = not an expense).

## Flow
- "yes" → adds the expense (✓ [M8] tag), marks the 3 Omar copies migrated, then
  "Done ✓ that was the last old money note."
- Re-run "migrate my money notes" → "no old expense notes to migrate" (not re-offered).
- (Alternatively "skip" → marks it skipped, not re-offered; "stop" → ends.)

## Round-trip audit (do this)
1. Run the migration, say "yes".
2. Open Family Wallet → confirm a 30 SAR · Dining expense tagged **[M8]** exists.
3. Confirm a row in `m8_wallet_writes`.
4. Delete that test expense from the wallet (and, if you want to re-test, clear the
   `metadata.migrated` flag on the Omar rows in m8_conversations).

## Privacy
- Migration replies carry the money sentinel (stripped from LLM history). The scan
  reads M8 memory directly (code), never via an LLM prompt.
