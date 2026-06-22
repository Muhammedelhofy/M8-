# ENTITY-CARD SEARCH SUPPRESSION — live chat test (run on PREVIEW/PROD)

Session-2 follow-up. Offline proof: `tests/entity-card-search-suppress-verify.ps1` (21/21).
Branch `feat/entity-card-search-suppress` — NOT deployed until Muhammad merges.

**Goal:** a "who is X / tell me about X" turn for an entity we TRACK answers from the
entity card, NOT a web search that lists irrelevant same-named businesses.

## PASS case — tracked entity (the fix)
1. Type:  `who is Terras?`
   - ✅ EXPECT: answers ONLY about the tracked mathematician (parity prefix densities,
     1976, Collatz). **No** rooftop bar, **no** Terras.co sustainability network, **no**
     `[1][2]` web citations, ideally no `[unverified]` web tag.
   - ❌ BEFORE this build it also listed Terras Miami / Terras.co / Cambridge Dictionary.
2. Vercel runtime log for that turn shows `entity_card_search_suppressed` and NOT
   `search_done`.

## FAIL-OPEN case — untracked entity (must still search)
3. Type:  `who is Elon Musk?`  (not in your entity store)
   - ✅ EXPECT: behaves exactly as before — it may web-search / answer normally. No
     suppression (no tracked card → `entityCardSuppressSearch=false`).
4. Type:  `tell me about Atomic Habits`  (not currently tracked)
   - ✅ EXPECT: normal behavior (search/answer), not suppressed.

## Not-affected case — live-info ask about a tracked entity
5. Type:  `latest news on <a tracked company>` (if you ever track one)
   - ✅ EXPECT: STILL searches. `ENTITY_CARD_QUERY_RE` only matches identity asks
     ("who is", "tell me about"), never "latest news on X", so live-info turns are
     never suppressed.

## Regression
6. A fleet turn (`what's June 7 net?`) and a normal web turn (`who won <recent match>?`)
   are unchanged — the guard only adds `&& !entityCardSuppressSearch` to the existing
   gates, and the flag is false for both.
