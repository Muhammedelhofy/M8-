# Provenance Tagging Design — `m8_conversations`
**Status:** DESIGN NOTE — not yet built (post-Build-27)  
**Origin:** Team Round 4 consensus; replaces the `LOOP_TRIAGE_CONTAMINATION` content regex  
**Why:** Content-based filters age poorly (wording changes; legitimate user messages collide). Metadata-based filtering is permanent and composable.

---

## The problem it solves

Build-26 added a regex filter that strips memory rows matching `#\d+[^\n]{0,150}(kept|dismissed)` when loop-recall is active. Build-26.1 scoped it to model/summary rows only. But both are still content-based — they will break when confabulation phrasing changes, and they require ongoing maintenance.

The root cause was not a text pattern. It was an **authority problem**: battery-run outputs (eval_probe sessions) were stored in `m8_conversations` and looked identical to real user-session memory at recall time. There was no way to filter by provenance — only by content.

---

## Design

### Two new columns on `m8_conversations`

| Column | Type | Values | Default |
|--------|------|---------|---------|
| `source_type` | TEXT | `user_session` · `eval_probe` · `cron_session` · `summary` | `user_session` |
| `trust_level` | INTEGER | 1–4 (higher = more trustworthy at recall) | `4` |

**Trust level scale:**

| Level | source_type | Meaning |
|-------|-------------|---------|
| 4 | `user_session` | Real Muhammad conversation — always include in recall |
| 3 | `summary` | AI-condensed context — include in recall, lower weight |
| 2 | `cron_session` | Nightly cron output — include ONLY in loop-recall lane |
| 1 | `eval_probe` | Battery/Odysseus run — NEVER include in operational recall |

### Write path — `inferSourceType(sessionId)`

Classify at write time based on the session_id prefix, which is already set by the caller:

```javascript
function inferSourceType(sessionId) {
  if (/^(?:l5_|eval_|od_|battery_)/i.test(sessionId))
    return { source_type: 'eval_probe', trust_level: 1 };
  if (/^cron[_-]/i.test(sessionId))
    return { source_type: 'cron_session', trust_level: 2 };
  return { source_type: 'user_session', trust_level: 4 };
}
```

Called in the write path (wherever `m8_conversations` rows are inserted), collocated with the existing `session_id` assignment. One function, no LLM judgment.

### Read path — replaces the regex filter

**Current (content-based, fragile):**
```javascript
pastMemory.filter(m => {
  if (m.role === "user") return true;
  return !LOOP_TRIAGE_CONTAMINATION.test(String(m.content || ""));
})
```

**After (metadata-based, permanent):**
```sql
-- Default recall: exclude eval probes
SELECT * FROM m8_conversations
WHERE session_id = $1
  AND trust_level >= 3
ORDER BY created_at DESC LIMIT 10;

-- Loop-recall lane: also allow cron sessions
SELECT * FROM m8_conversations
WHERE session_id = $1
  AND trust_level >= 2
ORDER BY created_at DESC LIMIT 10;
```

The `LOOP_TRIAGE_CONTAMINATION` constant and the `filteredMemory` block in `orchestrator.js` are deleted. The filter moves to the Supabase query — cheaper, cleaner, and impossible to evade by rephrasing.

---

## Migration

Two files:

**`migrations/m8_conversations_provenance.sql`** — adds columns + backfill:
```sql
ALTER TABLE m8_conversations
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'user_session'
    CHECK (source_type IN ('user_session','eval_probe','cron_session','summary')),
  ADD COLUMN IF NOT EXISTS trust_level INTEGER DEFAULT 4
    CHECK (trust_level BETWEEN 1 AND 4);

-- Backfill existing known eval sessions
UPDATE m8_conversations
SET source_type = 'eval_probe', trust_level = 1
WHERE session_id ~ '^(l5_|eval_|od_|battery_)';

-- Backfill existing summary rows
UPDATE m8_conversations
SET source_type = 'summary', trust_level = 3
WHERE role = 'summary';
```

Idempotent. Safe to run on the live table — all existing rows default to `user_session` / trust_level 4, which is conservative (no recall degradation).

---

## What it enables beyond the current fix

1. **Cross-lane trust thresholds.** Each orchestrator lane can set its own minimum `trust_level`. Fleet/finance lanes default to 4 (real user sessions only). Loop-recall lane uses 2 (also sees cron output). Future: a knowledge-intake lane can tag ingested-document context as trust_level 3.

2. **Eval output isolation is permanent.** Any session prefix that matches the `eval_probe` pattern is excluded from recall forever — no content regex needed, no future maintenance. New probe families just need a matching session prefix.

3. **Cron output is selectively visible.** The nightly cron logs context (what it found, what it skipped). That context is tagged `cron_session` (trust_level 2). The loop-recall lane can surface it; other lanes can't. This is a safe way to let the loop's own memory feed its own recall without polluting general conversation memory.

4. **Audit trail.** `source_type` is queryable — Muhammad can ask "show me what eval probes ran last week" and get a real list from the DB.

---

## What this does NOT change

- The current Build-26.1 `role === 'user'` guard stays in place as a safety backstop until this migration ships. No regression from removing it — it just becomes redundant once the SQL filter is the primary gate.
- `role = 'summary'` rows already exist and work. The `summary` source_type is a retroactive label on the same mechanism.
- The `recallMemory` function's limit / ordering logic is unchanged.

---

## When to build this

After Build-27 (Knowledge Acquisition Pipeline). It is a pure backend migration + one function + read-path update in orchestrator.js. No new API endpoints. No UI changes. Estimated: 1–2 hours of build time in a fresh session.

**Do not block Build-27 on this.** The current regex filter is sufficient for now (Build-26.1 scoped it correctly). This is an architectural upgrade, not an urgent fix.
