# Build-85b — Entity Timeline: Live Test

Apply the migration first:
```sql
ALTER TABLE public.m8_entity_mentions ADD COLUMN IF NOT EXISTS summary text;
```

---

## Part A — Arc accumulates across sessions

Ask these questions in order across **two or more separate sessions** so that
the same entity gets mentioned multiple times.

**Session 1:**
1. `tell me about Ibn Kathir as a historian of the Islamic world`
2. `what are the main cosmological claims in Al-Bidaya wa'l-Nihaya?`

**Session 2 (new session):**
3. `Ibn Kathir compared to modern historians — how would you assess his methodology?`
4. `who is Ibn Kathir?`

**Expected (session 2, question 4):**
- M8 outputs an ENTITY CARD for Ibn Kathir
- Shows `First seen / Last seen / Mentioned: N×`
- Session arc lists previous sessions with 1-sentence summaries
  e.g. `• session-XX (2026-06-20): "discussed Ibn Kathir as a historian of the Islamic world"`

---

## Part B — getEntityCard: direct queries

These should all trigger the ENTITY CARD path and inject arc context into the answer.

5. `who is Collatz`
6. `tell me about Collatz`
7. `what do you know about the Riemann hypothesis`
8. `background on Ibn Kathir`
9. `info on Al-Bidaya`

**Expected behavior:**
- For entities M8 has seen before: arc is shown in the answer
- For entities M8 has never seen: falls back to knowledge / says "I don't have tracked sessions on X"

---

## Part C — Arc format in KNOWN ENTITIES block

10. In a session where you've already discussed `Collatz` once:
    `tell me more about the Collatz conjecture`

**Expected:** The KNOWN ENTITIES block in the background (shown in M8's grounding) 
should now include an `Arc:` suffix with the prior session summary.

---

## Part D — No false triggers

11. `tell me about your day` → should NOT trigger entity card for "your day"
12. `who are the top drivers this week` → should NOT trigger entity card
13. `what do you know` → (no entity name) should NOT trigger entity card

---

## Checklist

- [ ] Migration applied (summary column exists in m8_entity_mentions)
- [ ] After first mention: summary appears in m8_entity_mentions within ~3 seconds (async)
- [ ] `who is X` triggers entity card injection when entity is tracked
- [ ] `tell me about X` triggers entity card injection
- [ ] Arc lines show session IDs + dates + 1-sentence summaries
- [ ] Fallback works: unknown entity name returns graceful "not tracked" response
- [ ] No false triggers on generic queries (Part D)
