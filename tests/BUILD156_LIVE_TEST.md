# BUILD-156 — Live phone test: the LOOKUP-boundary flip

**What shipped:** when `M8_REGISTRY_LOOKUP=1`, M8 routes the **read-only** lanes
(knowledge / web / memory / chat) through the registry classifier. The headline win is
the **knowledge (ask-my-docs) lane**: "what does my CV say about X" now answers from
**your own ingested CV/notes/books** (cited) instead of a web search or a generic reply.

> 🟢 **Safe to deploy dormant.** The flag defaults **OFF** → byte-for-byte pre-156. Nothing
> changes until you turn the flag on. The wallet / fleet / finance / tasks / notes /
> driver-profile lanes are **NOT touched** by this build.

---

## STEP 1 — turn the flag on (Vercel)
This is **not a secret** — it's a plain on/off switch, so you set the value yourself.

1. Go to **vercel.com** → the **M8** project (`m8-alpha`).
2. Top menu: **Settings** → left sidebar: **Environment Variables**.
3. Click **Add New** (or **Add Another**).
   - **Key:**  `M8_REGISTRY_LOOKUP`
   - **Value:** `1`
   - **Environments:** tick **Production** (and Preview if you test there).
4. Click **Save**.
5. Left sidebar: **Deployments** → the latest Production build → **⋯** menu → **Redeploy**
   (env-var changes need a redeploy to take effect).
6. Wait for the green ✓, then open M8 on your phone.

**To roll back instantly:** delete that env var (or set it to `0`) and Redeploy. No code change needed.

---

## STEP 2 — the chat questions

### 🎯 A. KNOWLEDGE lane (the win — must cite YOUR content, not web)
Ask these in M8 chat. Expect an answer grounded in **your ingested CV / notes / books**,
ideally naming the source — **not** a list of web links.

1. `what does my CV say about leadership`
2. `in my resume, what experience do I have with operations`
3. `search my books for the Lychrel number definition`
4. `according to my notes, what's the plan for the Keeta dashboard`

✅ PASS = the answer clearly comes from your own material (mentions your CV/notes/book content).
❌ FAIL = it web-searches, or says "I can't see your CV", or gives a generic answer ignoring your docs.

### 🎯 B. KNOWLEDGE no-hit (honesty check)
5. `what does my CV say about underwater basket weaving`

✅ PASS = it says briefly that it **didn't find that in your ingested material**, then answers
from general knowledge (or asks). ❌ FAIL = it invents a CV detail.

### C. WEB lane (should be unchanged — live answer)
6. `what's the weather in Riyadh today`
7. `what's the current SAR to EGP rate`

✅ PASS = a live, current answer (same as before this build).

### D. MEMORY lane (should be unchanged — from memory/entity card)
8. `who is Ahmad`  (a driver/known person)
9. `what do you know about Bolt`

✅ PASS = answers from what M8 remembers / its entity cards, not a random web entity.

---

## STEP 3 — 🔴 REGRESSION checks (these MUST behave exactly as before)
The whole point of this build is that money/fleet/doc turns are untouched. Verify:

10. `what's my spend in June`            → **wallet** breakdown (NOT a web/knowledge answer)
11. `breakdown of my spend in june`      → **wallet**
12. `how are my drivers doing`           → **fleet** numbers
13. `give me the morning brief`          → **fleet** brief
14. `write me a report on fleet performance for June` → **doc** generation
15. `how much did I spend on books`      → **wallet** (the word "books" must NOT pull the knowledge lane)

✅ PASS = each lands in the same lane it always has. ❌ FAIL (report it) = any of these
drifts into a web search or the knowledge graph.

---

## STEP 4 — report back
Tell me for each: ✅ / ❌ + what it actually said. The ones that matter most:
- **#1–#4** (knowledge cites your content) = the feature working.
- **#10–#15** (money/fleet/doc unchanged) = no regression.

If anything in #10–#15 misbehaves, set `M8_REGISTRY_LOOKUP=0` and Redeploy to revert
instantly, and send me the exact question + reply.

---

### Notes
- Offline mirror (`tests/build156_lookup.test.ps1`) is GREEN: 0 money mis-routes, 0 leaks,
  all clean knowledge/web rows routed. This live test catches what the offline mirror can't:
  whether the knowledge **retrieval** actually returns your ingested content (that needs the
  live Supabase graph + your real CV/notes, which only exist in prod).
- Telemetry while the flag is on: routing decisions log as `lane=lk:knowledge|web|memory`
  in `m8_router_misses` — that's the dataset for the next step (meaning-based routing for
  every domain).
