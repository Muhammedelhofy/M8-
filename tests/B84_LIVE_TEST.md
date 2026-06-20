# Build-84 — Multi-Source Answer Engine · Live Test

Type these in the live M8 chat (https://m8-alpha.vercel.app) and check the routing.
The point of this build: M8 should pull ONLY the sources a question needs, tag where
each fact came from, and dedupe when the book graph and memory say the same thing.

How to confirm routing without seeing the logs: watch the ANSWER, not just the words.
A correctly-routed answer cites its source ([KG]/[Entity] grounding shows up as
"from the book…", "you've told me…") and does NOT drag in unrelated fleet/finance numbers.

---

### 1. Pure knowledge question (intent → `knowledge`)
**Type:** `what does Ibn Kathir say about the creation of the heavens?`
**Expect:** Answer grounded in the ingested book graph, citing the book/author.
NO fleet rollup, NO P&L block bleeds in. (If the graph is empty it should say so
honestly rather than inventing — that's the [[m8-ingestion-empty-finding]] caveat.)

### 2. Pure fleet question (intent → `fleet`, override path)
**Type:** `who is on pace for 5000 SAR net this month?`
**Expect:** Deterministic FLEET DATA answer. The answer engine's `fleetLike` override
keeps the fleet packet authoritative; NO book-knowledge or entity trivia injected.

### 3. Pure math (intent → `math`, lean route)
**Type:** `compute: how many primes are below 100000?`
**Expect:** A computed number ("ran the code…"). The math route is deliberately lean —
no KG, no entity roster, no fleet — so the answer is tight and citation-free
(a self-computed number owns its own truth).

### 4. General chat (intent → `general`)
**Type:** `what should I prioritise this week — gut check?`
**Expect:** A direct opinion/plan. Entity + light knowledge context may inform it,
but NO fleet numbers or book claims should be forced in unless you mention them.

### 5. Hybrid — should NOT narrow (intent → `hybrid`)
**Type:** `compare our fleet's profit pace to what the book says about healthy margins`
**Expect:** This genuinely spans fleet + finance + knowledge, so the engine keeps
EVERYTHING on. You should see both the real fleet/finance figures AND any book
margin context, with the book parts cited.

---

### What "good" looks like in the logs (Vercel runtime logs, if you check)
- `answer_intent` event with the classified `intent` for Q1/Q3/Q4/Q5.
- `kg_context_skipped` on a fleet/math turn (Q2/Q3) — proof it stopped pulling book data.
- `evidence_merged` when KG + entity both returned and got deduped/tagged (Q1).
- Classifier outage is safe: it falls back to `hybrid` → injects everything (old behavior),
  so a bad classifier never produces a *narrower wrong* answer.

### Regression spot-checks (must still work)
- Upload a fleet CSV → still parses (image/ingest/CSV override flags bypass the classifier).
- Attach an image → still read natively (imgTurn override untouched).
- `ingest this as a book: …` + a PDF → still ingests (knowledgeIngestMode override).
