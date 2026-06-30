# M8 — TEAM ROUND (2026-06-30): "Where we stand + what's next (apart from Career OS)"
*For GPT · Grok · Gemini · Manus. Standalone brief — paste this whole file. Be brutally honest; separate fact from guess; respect the constraints below.*

---

## 1 · Who + constraints (read first)
- **Muhammad El-Hofy** — Senior Operations Manager, Riyadh. 10+ yrs fleet/courier supply (GCC + Egypt). **Non-engineer** (thinks in systems/people/numbers, can't hand-apply code).
- **#1 priority = land a market-rate senior-ops job (~SAR 25–40k), target ~July.** Runway ~3.5–4 months. **M8 is a MARGIN-TIME project** — it must never eat job-hunt time or runway money.
- **M8 = his personal phone AI assistant** (PWA on `m8-alpha.vercel.app`) + a math/unsolved-problem research sidecar (hobby).
- **Hard rails (non-negotiable):** FREE LLMs only (Groq/Gemini/Cerebras/Mistral/OpenRouter waterfall — no paid tier); **privacy wall** (his money/wallet text NEVER enters an LLM prompt); confirm-before-write; scoped DB key; **Vercel 12-serverless-function cap is FULL** (no new `api/*.js`); ships to one user (him) so changes can be reversible-by-flag instead of shadow-then-flip.

## 2 · What M8 IS today (live + prod-verified)
- **Reads his real data:** Bolt fleet + Family Wallet (both via Supabase), sends a **morning brief**.
- **Ask-my-docs:** answers from his **own ingested CV / notes / books** (knowledge graph), cited.
- **Meaning-based routing** across 11 domains (wallet/fleet/finance/tasks/notes/knowledge/docs/web/memory/driver-profile/chat).
- **Honesty:** grounds on data ("no Dubai data"), and as of today **declines instead of fabricating** on personal no-match.
- **Math sidecar:** nightly conjecture/Collatz/Lean engine (free, margin-time hobby — stays).

## 3 · The journey just finished — the "false info / off-topic" problem is CLOSED
His #1 annoyance was *"M8 gives false info, not related to the topic."* Root-caused into THREE threads, all now fixed + prod-verified:
| Thread | Symptom | Fix (live) |
|---|---|---|
| **Routing** | same question phrased differently → lost / wrong lane | keyword→**meaning** routing: front-door arbiter (B-152) → all-domain registry (B-155/156) → **semantic router** shadow (B-164) → **flip** (B-166, tie-breaker on safe read-only lanes) |
| **Retrieval** | routed right but answered generic ("my kafala operation" → textbook) | **B-166b** rank knowledge-graph hits by word **rarity** (IDF), embed-independent → surfaces HIS specific nodes |
| **Honesty** | open people/topic w/ no match → **web-scraped random strangers' PII**, or generic encyclopedia | **B-167 grounding guard**: personal-framed ask + no match in his data → honest *"I don't have that — want me to search?"*; web-searches a bare name ONLY on explicit "yes"; never surfaces a stranger's phone/email |

Net: M8 now answers from HIS world or honestly says it can't — it doesn't invent or go off-topic. **This thread is done; we're NOT asking about it.**

## 4 · THE QUESTION
**Apart from the Career-OS job-hunt memory (companies/contacts/applications/follow-ups → tailored drafts + interview prep) — which is already the planned next and directly serves the #1 goal — what should M8 do next?**

React to these candidate directions (add your own). For EACH you'd back, give: **BUILD / SKIP**, the **smallest v1** + rough **hours of HIS time**, and **NOW / LATER / NEVER** (vs the job being #1):
- **A. Enrich the ingested corpus** — get more of his real docs/notes into the knowledge graph so the new grounding guard *answers* (cites) instead of *declining*. (Cheap, synergistic — but is it the best marginal hour?)
- **B. Evolving / long-term memory** — M8 actively learns his patterns/preferences over time, not just recall. (Value vs complexity for one user?)
- **C. The fleet / Settlement engine** — productize the Bolt-API + Supabase + dashboard-merge expertise into a tool for other kafala/fleet operators. NOTE: gated on his leave/stay — if he leaves Bolt, the live-data justification weakens; only a portable Settlement SaaS survives.
- **D. Proactive intelligence** — morning brief → genuine proactive nudges/alerts (fleet anomalies, wallet, follow-ups) rather than answer-on-ask.
- **E. The math / unsolved-problem engine** — push the Track-B research sidecar further. (Joy/learning value; honest about productivity ROI.)
- **F. Something we're missing.**

## 5 · Rules for your answer
- **Brutally honest. Separate fact from guess.** Don't invent his numbers.
- **Weigh against: job is #1, ~3.5–4mo runway, non-engineer, free-tier only, margin-time only.** A thing that's cool but eats job-hunt hours should say so.
- Prefer **smallest-v1 that delivers real value**; name existing tools if BUY beats BUILD.
- **End with a one-paragraph verdict: your single recommended next move for M8 (apart from Career OS) + one sentence why, and whether it's even worth doing before the job lands.**
