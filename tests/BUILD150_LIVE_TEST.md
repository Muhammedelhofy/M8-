# Build-150 Live Test — Router Miss Logger

**Branch:** feat/miss-logger  
**Deploy to prod only after Muhammad's OK.**

---

## What this build does

When M8 can't handle a message and falls through to the Phase-0 capability-decline safety net
(the "I can add, edit, or total your expenses…" reply), it now silently logs the stripped
phrasing to `m8_router_misses` in Supabase. Muhammad can later review these to teach M8
new phrasings. A new read command surfaces the log.

---

## Pre-flight (prod)

- [ ] Verify `m8_router_misses` table exists on the BOLT Supabase project — run the
  migration `M8/migrations/B150_router_misses.sql` if not already applied (it was
  applied during Build-150 via the MCP tool).

---

## Test 1 — Trigger a miss and confirm it logs

Send a message M8 can't handle yet. These should hit the Phase-0 money net:

```
what is my balance from last tuesday
```
```
can you delete my last expense
```

**Expected:** M8 replies with the standard capability card  
("I can add, edit, or total your expenses…").  
**What to check in Supabase:** query `m8_router_misses` — you should see a new row
with `lane=money`, `reason=phase0_safety_net`, and `message_redacted` showing
`[#]` / `[MONEY]` tokens instead of the real content. No raw amounts in the DB.

---

## Test 2 — Task/note miss logging

```
remind me about tomorrow
```
*(This has a task noun but no strong action verb, so parsers return null and it should
fall through to the safety net with `lane=task`.)*

Or try a note miss:
```
note something for me
```

**Expected:** capability card reply; row in `m8_router_misses` with correct lane.

---

## Test 3 — "Show my recent misses" read command

After triggering a couple of misses in Tests 1 & 2, send:

```
show my recent misses
```
```
what did M8 not understand
```
```
what did you miss
```

**Expected:** M8 returns a numbered list of the logged rows with lane, timestamp, and
stripped message. No raw amounts. No LLM call (deterministic response).

---

## Test 4 — General chat is NOT affected

```
what's the weather in Riyadh today
```
```
explain Collatz in one line
```

**Expected:** M8 answers normally. No row added to `m8_router_misses` (general chat
never reaches the Phase-0 safety net).

---

## Test 5 — Money turn content is scrubbed

```
I spent 1200 SAR on groceries last week, update my balance
```

If this hits the Phase-0 net, the `message_redacted` column should contain:
`I [MONEY] [#] [CUR] on groceries last week, update my [MONEY]`  
No digit, no currency code in the DB row.

---

## Rollback

Build-150 is fire-and-forget logging only — it adds no new authority and does not
change any existing response. If the Supabase write fails (timeout, missing env var),
M8's reply is unaffected. Rolling back = revert the `feat/miss-logger` branch and
drop the `m8_router_misses` table.
