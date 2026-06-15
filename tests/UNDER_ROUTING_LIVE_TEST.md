# Live test — Search under-routing guard (backlog #12)

**Run only with Muhammad's OK — hits `m8-alpha.vercel.app` + costs free Gemini/Tavily quota.**

First confirm the deploy is live:
```
GET https://m8-alpha.vercel.app/api/health   → check deploy.sha matches the pushed commit
```

## A. MISSES that should now SEARCH (type in live chat)
Each should now do a grounded web lookup (cite a source / current figure), NOT a
confident-from-memory answer. Watch for a citation or "based on search results".

1. `who founded keeta`
2. `who is the current ceo of careem`
3. `when was the riyadh metro completed`
4. `what year did aramco go public`
5. `who owns the noon app`

✅ PASS = answer is grounded in a fetched source (and correct).
❌ FAIL = answers from training with no lookup, or invents a name/date.

## B. TRUE NEGATIVES that must NOT start searching
Each should answer locally/conversationally with NO web search (no citations, no
"according to ..."), exactly as before.

6. `why is the sky blue`
7. `tell me a joke`
8. `should i raise driver pay`
9. `give me three ideas to motivate my drivers`   (personal — stays local)
10. `when did i last log in`                       (self/temporal — stays local)

✅ PASS = direct local answer, no search.
❌ FAIL = M8 runs a clumsy web search for one of these (over-routing regression).

## C. Regression spot-checks (existing routes untouched)
11. `latest keeta news`            → still searches (NEWS), honest empty-result hedge ok
12. `what's your most recent build` → answered from build state, NO web search (Build-40)

Record results inline; if A all ground and B/C all stay local, the guard is live-verified.
