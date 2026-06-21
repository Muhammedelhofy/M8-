# Build-110 "Brain CPR" — LIVE TEST (run AFTER deploy)

**Why this file exists:** the host has no Node, so the offline suite
(`tests/BRAINCPR-verify.ps1`, 38/38) can only prove the *wiring*. The REAL proof
is **rows landing** in four tables that were stuck at 0 because their writes were
fire-and-forget and got frozen out by the Vercel lambda before the insert flushed.

Run these **only after Muhammad says "deploy"** and the production deploy is live.

---

## 0. Baseline (before sending any chat) — Supabase SQL editor (BOLT project)

```sql
select count(*) as reflections     from m8_reflections;
select count(*) as chains          from m8_reasoning_chains;
select count(*) as entities        from m8_entities;
select count(*) as entity_mentions from m8_entity_mentions;
select count(*) as conjecture_out  from m8_conjecture_outcomes;
```
Record the five numbers. Expectation pre-fix: reflections / chains / entity_mentions
≈ 0. (entities may already be >0 from earlier; watch the **mentions** delta.)

---

## 1. Reflector → `m8_reflections`

Trigger = a **general/knowledge** answer **>200 chars** (fleet/finance/compute/lean
are gated OUT by design — do NOT use a fleet question here).

Type in live chat (voice or text):
> "Explain the trade-offs between optimistic and pessimistic concurrency control
> in databases, and when you'd pick each. Give a concrete example of a race each one
> prevents."

Then:
```sql
select id, session_id, relevance_score, overclaim_flag, missed_source_flag, was_rewritten
from m8_reflections order by id desc limit 5;
```
**PASS** = at least one fresh row. Vercel runtime logs should show `[persist:reflect] +1`.

---

## 2. Reasoning chains → `m8_reasoning_chains`

Trigger = a **complex why/how/compare** question **>80 chars**, NOT fleet/finance.

> "Why does spaced repetition improve long-term retention more than cramming, and
> how does that mechanism compare to interleaving different topics in one session?"

Then:
```sql
select id, session_id, question, jsonb_array_length(steps) as n_steps
from m8_reasoning_chains order by id desc limit 5;
```
**PASS** = a fresh row with `n_steps >= 2`. Logs show `[persist:chain] +1`.
(If no row: the 8s chain budget may have fallen back to single-hop — re-ask a
slightly simpler multi-part question. A single-hop answer intentionally writes nothing.)

---

## 3. Entity store → `m8_entities` + `m8_entity_mentions`

Trigger = any message naming a **specific entity** (book/person/company), len >= 12.

> "I've been reading Antifragile by Nassim Taleb and thinking about how its ideas
> apply to running the fleet."

Then:
```sql
select id, name, entity_type, mention_count, last_seen
from m8_entities order by last_seen desc nulls last limit 10;

select count(*) as entity_mentions from m8_entity_mentions;
```
**PASS** = `m8_entity_mentions` count went UP vs baseline, and an "Antifragile" (book)
/ "Nassim Taleb" (person) row appears. Logs show `[persist:entity] +1`.
NOTE: the *core* entity + mention INSERTs are covered by waitUntil. The optional
1-sentence `summary` enrichment (`summarizeEntityContext`) is still a secondary
fire-and-forget and may lag — that's the AI Council's heavier follow-up (move the
Gemini extraction into cron-summarize). Judge this test on the **mention row**, not
on the summary column being populated immediately.

---

## 4. Conjecture loop → `m8_conjecture_outcomes`  (NOT chat-triggerable)

This write only fires from the **nightly Lean/M4 cron** (`cron-verify`, 01:15 UTC)
when a scaffold leaf newly **verifies** or comes back **`sorry`**. You cannot trigger
it from chat.

- **Wiring proof (now):** after the next `cron-verify` run that has
  `m4_leaves_verified > 0` or sorry leaves, the Vercel logs show
  `[persist:conjecture-outcome] +1` and a row appears:
  ```sql
  select id, problem_id, left(conjecture_text, 60) as conj, structural_tags, verified_at
  from m8_conjecture_outcomes order by id desc limit 5;
  ```
- **Honest expectation:** `m8_conjecture_outcomes` will stay **near-0 until the
  Lean/M4 lane actually produces verified/sorry leaves** — that is **Build B (next)**.
  Build-110 fixes the *write* (the prerequisite); it does not by itself make the
  number climb. ALSO: migration `B92_conjecture_outcomes.sql` must be applied or the
  insert errors (logged as `[persist:conjecture-outcome] <error>`).

---

## 5. Instrumentation sweep (Vercel runtime logs)

After the chat tests, grep the Vercel **runtime** logs for the success markers:
```
[persist:reflect] +1
[persist:chain] +1
[persist:entity] +1
[persist:conjecture-outcome] +1   (only after a qualifying cron-verify run)
```
A `[persist:<label>] <error text>` line instead of `+1` = the insert was reached
but the table/column/migration is wrong — fix that, not the wiring.

---

## 6. If rows STILL don't land after deploy

`waitUntil` extends the lambda lifetime only when the runtime supports it. If `+1`
logs appear but rows are missing, check:
1. **Fluid Compute** is ON (Vercel → Project → Settings → Functions). waitUntil is
   most reliable with Fluid Compute; it's default-on for newer projects.
2. The relevant **migration** is applied (`m8_reflections`, `m8_reasoning_chains`,
   `m8_entities`/`m8_entity_mentions`, `B92_conjecture_outcomes.sql`).
3. `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set in the Vercel env (they are for
   the working writes, so this should already hold).
