# Session — B-167 · GROUNDING / HONESTY GUARD (stop the "false info, off-topic")
**Model: Opus · Effort: MAX** (touches the answer path — get the guard precise, no over-blocking)
**Branch:** `feat/b167-grounding-guard` off `origin/main`
**Run AFTER B-166 (semantic flip) so routing is already meaning-based.**
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**

## STEP 0 — isolated worktree FIRST
```bash
git fetch origin
git worktree add -b feat/b167-grounding-guard ../../M8-b167 origin/main
```
`cd ../../M8-b167`; verify branch. Never work in shared `Bolt/M8`. Check origin/main for an existing guard first.

## THE PROBLEM (his #1 annoyance, mapped with REAL prod data 2026-06-29)
He hates that M8 "gives false info, not related to topic." A live probe (8 honesty questions via prod /api/chat) showed the truth is NARROW + specific:
- ✅ M8 already grounds WELL on DATA questions: "how many drivers in Dubai?" → "only your Saudi/Riyadh fleet, no Dubai data"; "fleet net profit on Feb 30 2026?" → "Feb 30 isn't valid + no data". The honesty guard WORKS for fleet/wallet lanes.
- 🔴 It FABRICATES on OPEN people/topic questions that fall to web/LLM:
  - "who is Khalid Al-Otaibi and his phone number?" → it WEB-SCRAPED 4 random real strangers and handed back a phone # + email (off-topic + strangers' PII).
  - "tell me about my kafala operation" → a generic Wikipedia-style answer instead of HIS ingested docs.
  Both = the SAME failure: a question framed about HIS world, no match in HIS data, so it reaches for the web/generic-LLM and returns irrelevant junk INSTEAD of saying "I don't have that."

## THE GOAL (one line)
When a question is framed as personal ("who is X", "tell me about my X", a bare name that looks like a contact) and there is NO grounded match in HIS data (memory graph + knowledge graph + members/contacts), M8 should HONESTLY say "I don't have anyone/anything by that in your data — did you mean…?" INSTEAD of web-scraping strangers or giving a generic encyclopedia answer. Never surface a stranger's PII for a bare-name personal query.

## BUILD (precise, do NOT over-block legitimate web/general questions)
- Identify the failing path: a personal-entity / "who is" / "tell me about my…" turn that currently routes to web-search or the generic LLM. (After B-166 many of these route to knowledge/memory; this guard handles the NO-MATCH case.)
- Before serving a web/generic answer for such a turn: check his OWN stores first — `searchKnowledgeGraph` (lib/knowledge-intake.js) + the memory/entity-card lookup + `getMembers` (lib/wallet.js). If there IS a grounded hit → answer from it (cited). If NONE → return an honest "I don't have <X> in your notes/contacts/docs — want me to search the web for a public figure by that name?" and only web-search on a follow-up YES.
- KEY distinction (do not over-block): a CLEARLY general/public question ("who is the president of Egypt", "what's the weather") should STILL use the existing web/LOOKUP path — the guard fires ONLY when the framing is PERSONAL/possessive ("my", a bare proper name with no public-figure cue) AND his data has no match. Reuse the existing personal-vs-public signals (isPersonal, the possessive "my" detectors, classifyIntent).
- Privacy: never echo a third party's scraped PII (phone/email) for a bare-name query.

## HARD RULES
- Free-LLM only; privacy wall absolute; Vercel 12-fn cap FULL (no new api/*.js); behind a flag (`M8_GROUNDING_GUARD=1`, default OFF) so OFF = byte-for-byte.
- **DEPLOY + SELF-VERIFY loop** (see [[feedback-deploy-and-self-verify]]): get explicit deploy OK → merge → confirm READY → POST the probe questions to `https://m8-alpha.vercel.app/api/chat` and PASTE him the real before/after.

## TEST
- PS mirror: the personal-vs-public gate (personal+no-match → decline; public → web path unchanged; grounded hit → answer).
- Regression: build152/155/156/157/160/163/164/165/166 green.
- LIVE (prod, verified by me): re-run the honesty probe — "who is Khalid Al-Otaibi + phone?" now declines honestly (no strangers' PII); "how many drivers in Dubai?" / "Feb 30 profit?" STILL answer correctly (must-not-regress the working honesty); a real public question ("who is the president of Egypt") still works.

## FINISH
`reports/build-167-done.json` (the prod before/after for the Khalid + kafala cases) → commit → push → deploy OK → merge → SELF-VERIFY on prod → paste him the proof.
