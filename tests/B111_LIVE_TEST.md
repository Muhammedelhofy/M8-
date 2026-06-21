# Build-111 — Conjecture-outcome reconciliation · LIVE TEST

**What it fixes:** `m8_conjecture_outcomes` sat at **0 rows** despite real Lean-verified
leaves in the graph. `recordOutcome` only fired on the per-run `newlyVerified` TRANSITION
edge; those past writes were the pre-Build-110 un-awaited promises Vercel dropped on
freeze, and once a scaffold flips to `leaves_done` it leaves the recheck pool forever, so
the transition can never re-fire to retry. Build-111 adds an idempotent, durable
`reconcileOutcomes()` pass to `runVerifyPhase` that, on every cron-verify (warm **and**
cold), ensures every currently Lean-verified scaffold has exactly one success row.

## Offline proof (already done, no deploy)
- `tests/B111-reconcile-verify.ps1` — 21/21 PASS (idempotency, sorry-exclusion, classification).
- Regression: `B92` 40/40, `B99` 37/37, `BRAINCPR` 46/46, `BUILD-B` 22/22 — all green.
- **Live dry-run (read-only)** against Supabase `ltqpoupferwituusxwal` confirmed the pass
  *would* insert exactly 2 rows now — scaffolds id=3 (`2·Σi = n(n+1)`) and id=6 (`product
  of two odd integers is odd`) — taking the table 0 → 2 without writing anything.

## Live verification (AFTER an approved deploy)

### 1. Baseline (should be 0)
```sql
select count(*) from m8_conjecture_outcomes;
```

### 2. Trigger a verify run (manual, instead of waiting for 01:15 UTC cron)
```bash
# CRON_SECRET is already set in Vercel env; run from a shell that has it.
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<m8-prod-domain>/api/cron-verify | jq '.outcomesReconciled, .events'
```
Expect `outcomesReconciled: 2` (cold or warm — the pass is pure DB) and an
`l5_outcomes_reconciled` event with `inserted: 2`.

### 3. Confirm 0 → 2, both classified as VERIFIED success (no `sorry`)
```sql
select problem_id, left(conjecture_text,48) as conjecture, structural_tags,
       (lean_proof_sketch is not null and lean_proof_sketch !~* '\ysorry\y') as is_success,
       verified_at
from m8_conjecture_outcomes order by verified_at desc;
```
Expect 2 rows, both `is_success = true`.

### 4. Idempotency — run cron-verify again
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<m8-prod-domain>/api/cron-verify | jq '.outcomesReconciled'
```
Expect `0` (rows already present) and `select count(*)` still `2` — no duplicates.

### 5. Proposer now carries signal
Next `cron-explore` (01:00) calls `getSuccessPatterns('collatz')` → the 2 rows feed the
"propose structurally DIFFERENT" block in the conjecture generator.

## Kill / safety
- Nothing new to disable; gated by the existing `L5_LOOP_DISABLED=1`.
- Fail-safe: `reconcileOutcomes`/`reconcileVerifiedOutcomes`/`fetchVerifiedScaffolds` all
  return 0/[] and never throw, so a DB hiccup degrades the run instead of breaking it.
