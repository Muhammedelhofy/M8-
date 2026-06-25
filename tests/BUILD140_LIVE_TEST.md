# Build-140 — memory hygiene — LIVE TEST

Protects what we built this session (family facts) and stops memory from rotting.

## What shipped
- **Profile facts never evicted** (`recallMemory`): profile (identity/family) and
  operational (business state) are now fetched SEPARATELY — profile in full, operational
  capped to the newest N (`RECALL_OPERATIONAL_CAP`, default 18; `RECALL_PROFILE_CAP` 40).
  So "Sara is your wife" can't be pushed out by churning fleet/research status rows.
- **Transient junk blocked at write** (`isTransientFact` in `upsertFact`): weather,
  stock/flight prices, sports scores, daily driver/fleet snapshots, and loop seeds are
  refused durable storage. Business config / family / research facts are NOT caught.
- **One-time purge**: 17 existing stale rows retired (is_current=false, kept for history).

## Offline (passed)
- `M8/tests/build140-memory-hygiene-test.ps1` → **16/16** (transient blocked, durable kept).

## Live checks (after deploy)
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `who is Sara?` | still knows your wife (profile fact intact + protected) |
| 2 | `what's the weather in Riyadh?` | answers live, but does NOT save it as a durable fact |
| 3 | ask M8 something fleet-config (e.g. headcount) | still recalled (config not purged) |

## Rollback
- Code: Vercel → previous deploy.
- Data: the 17 rows are soft-retired — restore with `update m8_conversations set is_current=true where memory_key in (...)`.
