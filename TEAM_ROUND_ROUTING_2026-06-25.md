# M8 Team Round — The Routing Problem (2026-06-25)

**For:** the AI Council — GPT · Grok · Gemini · Manus.
**From:** Muhammad (owner) + Claude Code (build agent).
**Ask:** is our recommended fix the right architecture? Rank alternatives, name the trade-offs, and tell us where we're wrong. This is the foundation question — we will stop adding features until it's settled.

---

## 1. The problem (concrete, evidence-backed)
M8 is a personal AI on Vercel (free-LLM stack: Groq/Gemini/Cerebras…). It has grown ~15 wallet abilities (last expense, per-person, breakdown, ranges, income/net, compare, budgets, bills, "did I pay X"), plus separate domains: **fleet** (driver P&L), tasks, notes, knowledge/docs.

**Symptom:** M8 "gets lost when one word is off." When the user phrases something the way it wasn't explicitly taught, it either drifts to the **wrong domain** or declines.

**Evidence (request_traces logs, real):** the user asked *"breakdown of my spend in June"* and *"breakdown of the 497 SAR"* about his **wallet** — both logged `tool_decision: "fleet"`. M8 handed wallet questions to the fleet engine. Other real failures: *"my spend"* returned the **household total** instead of the user's own; *"what's the breakdown?"* after M8 itself said "497 SAR" → M8 replied "no 497 in fleet data" (it didn't remember its own number).

## 2. Why it happens (the architecture today)
A **keyword-first hybrid router**:
1. deterministic **keyword parsers** run first (instant, free) →
2. a small free-LLM **"intent brain"** fires only when parsers miss — BUT it's **gated to money-plausible messages** and only knows a **handful of old intents** (add / total / last_expense). It has no idea about the ~15 newer abilities, so it can't rescue a missed phrasing →
3. fall-through → the **fleet lane is greedy** and grabs ambiguous money/number questions → wrong answer.

So every "fix" = adding one more keyword pattern. It's whack-a-mole. The "understands meaning" layer exists but is too narrow + too gated to help.

## 3. Our recommended fix
**Flip the order: a comprehensive, domain-aware "front-door brain."**
The FIRST step on (almost) every turn is a small LLM classifier that reads the message and returns a strict-JSON route:
- **domain**: wallet | fleet | tasks | notes | docs | chat
- **action**: the specific ability (from a FULL menu, not a short list)
- **subject**: owner (Muhammad) | a named member (Sara) | household total
- **period**: this month | a date | a range | …
- **confidence** + an **ambiguous flag** → when low/ambiguous, M8 ASKS ("your wallet or the fleet?") instead of guessing.

Then **deterministic code does the actual work** (numbers/money NEVER enter the LLM — the privacy wall holds; the LLM only picks the route). Keyword parsers stay as a **fast path** for obvious cases; the LLM is the **safety net** that catches everything else by meaning.

**Claimed benefits:** novel phrasing understood; fixes live in ONE capability menu, not 20 parsers; ambiguity → a question, not a wrong domain. **Honest limits we already accept:** not 100% (it'll mis-route sometimes); a small LLM call per unclear turn (latency/quota); needs the domains cleanly described.

## 4. Hard constraints (any proposal must respect)
- **Free-LLM stack** by default (premium opt-in OFF). One classifier call per turn must be cheap/fast.
- **Privacy wall is absolute:** the router LLM may see the user's message, but money/financial *data* must NEVER enter any LLM prompt or log. Computation stays deterministic.
- **Vercel 12-serverless-function cap is FULL** — no new `api/*.js`; reuse `api/ops?fn=`.
- **Confirm-before-write**; the LLM proposes a route, deterministic+gated code disposes. No new authority to the model.
- Node is absent on the build host → every build ships a PS-5.1 test mirror + a live phone test.
- There is already a **miss-logger** (logs redacted phrasings M8 couldn't handle) — usable as the real test set.

## 5. Questions for the Council (please rank + justify)
1. Is the **front-door LLM router → deterministic handlers** the right call, or is there a better pattern on a free stack (e.g. embeddings-based intent matching, a small fine-tune, a grammar/FSM, a tiered cascade)?
2. **Latency/quota:** one classifier call per turn on free models — acceptable, or do we need a cheap pre-filter (keyword fast-path) to keep it off the LLM for the obvious 80%?
3. **Wallet-vs-fleet disambiguation** specifically: best deterministic + LLM split so personal money never lands on fleet, and vice-versa? When exactly should it ASK vs decide?
4. **Robustness without over-asking:** how to make it clarify only when truly ambiguous (the user hates both "lost" AND constant "which did you mean?").
5. **Migration risk:** flip-the-router is invasive. Incremental path that doesn't regress the 168 things that work today?

## 6. Added questions — RAG / "ask my own docs" + embeddings
Context: the owner also wants M8 to answer about HIS OWN documents (CV, Obsidian notes) — an "Obsidian I can ask." M8 already has a working RAG engine (pgvector + citations) but with ~0 of his personal content in it; we can load his docs **Gemini-free** (the build agent reads PDFs/DOCX/MD off disk directly and inserts raw text — no ingest-extraction cost). Note the engine extraction step normally uses Gemini, which he wants to avoid.

6. **Embeddings vs LLM-classifier for the router:** should the "front-door brain" match meaning via **embeddings** (the same technique as RAG) instead of, or alongside, a small LLM classifier? Which is better on a free stack for latency + quota + accuracy?
7. **Personal-docs RAG:** is it worth wiring his CV + notes into the existing RAG engine? How do we keep *retrieval* free (keyword match vs embeddings on Gemini's embedding quota) and avoid the costly Gemini extraction step?
8. **Should "ask my docs" be a first-class domain** the router routes to (alongside wallet/fleet/tasks/notes)?

---

Return: a ranked recommendation with one-line rationale each, the single biggest risk you see, and anything we have wrong.
