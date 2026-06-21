# Build-B (Lean lane) — live test (run AFTER deploy)

The PS mirror only checks wiring. The real proof is the **nightly cron-verify**
(01:15 UTC) producing M4 activity again. This runs on a schedule — you can't force
it without triggering the cron (which is gated). So verify the morning after deploy.

## What to check the morning after deploy
Run in Supabase SQL editor (project `ltqpoupferwituusxwal`):

```sql
select run_date, lean_ready, m4_attempted, m4_target_id, m4_leaves_verified, m4_leaf_total
from m8_loop_runs order by run_date desc limit 3;
```

### Expected (vs the 06-19..06-21 baseline of lean_ready flaky, m4_attempted=false)
- **B1 working:** `lean_ready = true` even on a night the checker was cold (the warm-retry woke it).
- **B2 working:** `m4_attempted = true` with `m4_target_id` pointing at a graveyard scaffold (id 1, 2, or 4), i.e. the lane is no longer idle.
- **A repair landing:** a previously `lean_rejected` leaf flips to `lean_verified`:

```sql
select id, target,
       (select count(*) from jsonb_array_elements(lemmas) e where e->>'lean_status' = 'lean_verified') as verified_leaves,
       (select count(*) from jsonb_array_elements(lemmas) e where e->>'lean_status' = 'lean_rejected') as rejected_leaves,
       (select max((e->>'second_chance')::int) from jsonb_array_elements(lemmas) e) as max_second_chance
from m8_lemma_scaffold where id in (1,2,4) order by id;
```
- `second_chance` should be ≥ 1 on attempted leaves (proves the bounded counter persists), and ≤ `M4_MAX_SECOND_CHANCES` (default 2) — never climbing forever.

## Vercel runtime log markers (cron-verify)
- `l5_verify_repair` `{ target, repaired, newlyVerified }` — B2 ran.
- `m4_repair` `{ repaired, newlyVerified }` — repairScaffold executed.
- If a leaf verified: `l5_verify_repair` with `newlyVerified > 0`, then a `recordOutcome` (which lands in `m8_conjecture_outcomes` **once Brain-CPR is also deployed**).

## Kill switches (if anything misbehaves — no redeploy needed)
- `M4_REPAIR_DISABLED=1` — turn off the second-chance repair entirely.
- `M4_MAX_SECOND_CHANCES=0` — same effect.
- `LEAN_WARM_TRIES=1` — restore the old single-ping health check.

## Note
`m8_conjecture_outcomes` only fills once **both** B (a verified leaf is produced)
**and** Brain-CPR (the un-awaited recordOutcome write is fixed) are live. B produces
the event; CPR makes the write stick.
