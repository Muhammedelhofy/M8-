# M8 — Technical Brief & Session Handoff
**Version:** 3.0 | **Updated:** June 6, 2026
**Reviewed by:** Claude (lead) + Gemini + ChatGPT
**Live URL:** https://m8-alpha.vercel.app
**GitHub:** https://github.com/Muhammedelhofy/M8- (branch `main`, auto-deploys to Vercel)
**Latest commit:** `2056a9a` (e2e test log — June 6)

> **For Grok / Gemini / GPT reading this:** this is the single source of truth for where M8
> stands *right now*. Sections 1–9 are current state. Section 13 has a focused context block +
> consult question for each of you before the next milestone. Everything described as ✅ is live
> in production and verified, not planned.

---

## 1. Project Vision

M8 is a personal AI Operating System for Muhammad El-Hofy — not a chatbot.

Persistent, voice-first AI agent that understands: Bolt KSA fleet ops (~102 bikes), courier supply (Hunger Station, Noon, Keeta, Uber), YouTube channels, daily work in Riyadh. Single user. Egyptian. Based in Saudi Arabia.

**Codename:** M8 (Mate — crew member who knows the ship)
**Interface:** Voice-first (en-US default, ar-SA toggle) + text fallback
**Deployment:** Vercel serverless + Supabase

---

## 2. The One Rule (ChatGPT's law — non-negotiable)

Before adding ANY feature, it must answer YES to at least one:
1. Does this make M8 better at **Memory**?
2. Does this make M8 better at **Research**?
3. Does this make M8 better at **Analysis**?
4. Does this make M8 better at **Automation**?
5. Does this make M8 better at **Communication**?

---

## 3. Current Architecture (Milestone 2 — LIVE & VERIFIED)

```
Frontend (Vanilla JS)
    ↓
api/chat.js              ← HTTP handler only (~40 lines, never grows)
    ↓
api/orchestrator.js      ← FAULT-TOLERANT pipeline — never throws a 500
    ├─ api/intentClassifier.js  ← regex 6-category router (no LLM call)
    ├─ api/memory.js            ← Supabase keyword-filtered recall (summaries stubbed)
    ├─ api/search.js → api/tools/searchTool.js  ← Tavily (ACTIVE)
    └─ api/llm.js               ← MULTI-PROVIDER fallback chain (single swap point)
```

### Repository Tree (current)

```
M8/
├── index.html                  ← UI shell (en-US default)
├── css/style.css               ← Dark theme, RTL/LTR, language badges
├── js/
│   ├── app.js                  ← UI controller, sendMessage(), language toggle
│   ├── chat.js                 ← In-session message history + bubble rendering
│   └── voice.js                ← Web Speech API (ar-SA / en-US)
├── api/
│   ├── chat.js                 ← HTTP handler only — never grows
│   ├── orchestrator.js         ← THE pipeline; fault-tolerant; injects CURRENT DATE
│   ├── intentClassifier.js     ← 6-category regex classifier (extracted, testable) ✅
│   ├── memory.js               ← Keyword recall + summarizeSession()/semanticRecall() STUBS
│   ├── llm.js                  ← Multi-provider chain: gemini→groq→openai→grok ✅
│   ├── health.js               ← GET /api/health — env check
│   ├── search.js               ← Thin interface to searchTool ✅
│   ├── analysis.js             ← ⬜ Milestone 3 stub
│   └── tools/
│       ├── searchTool.js       ← Pure Tavily fetch wrapper (per-category params) ✅
│       └── analysisTool.js     ← ⬜ Milestone 3 scaffold
├── tests/
│   ├── classifier-test.js      ← 33-case unit suite (needs Node to run)
│   └── e2e-scenarios.md        ← Live-HTTP matrix + test log
├── package.json                ← @google/genai + @supabase/supabase-js
└── vercel.json                 ← API rewrites, maxDuration: 30 for chat.js
```

---

## 4. Stack & Environment

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS |
| Serverless | Vercel (Node.js 18+, global fetch/AbortController) |
| LLM | **Multi-provider chain** — Gemini (free) → Groq (free) → OpenAI (paid) → Grok (paid) |
| Database | Supabase (`m8_conversations` table, ref `ltqpoupferwituusxwal`) |
| Search | **Tavily — ACTIVE** (per-category params, 7s timeout) |

### LLM Provider Chain (the big change since v2.0)
`api/llm.js` is the single swap point. `generate()` runs a provider CHAIN ordered by
`LLM_PROVIDER_ORDER` (default `gemini,groq,openai,grok` — free first). On ANY failure
(429 quota / safety block / empty / network / missing key) it auto-retries the next provider
and logs `recovered via <name>`. A provider whose key is unset throws immediately and is skipped (inert/harmless).

- **gemini** — `@google/genai` SDK. FREE tier on `gemini-2.5-flash` = **only ~20 requests/day** per project per model. This is the real ceiling that triggers failover.
- **groq** — console.groq.com, FREE generous tier, `llama-3.3-70b-versatile`, OpenAI-compatible. ✅ **Confirmed live catching Gemini 429s** (failover overhead ~350ms).
- **openai** — platform.openai.com, PAID, `gpt-4o-mini`. Key NOT set yet (skipped).
- **grok** — console.x.ai (xAI), PAID. Key NOT set yet (skipped). ⚠️ **GROQ ≠ GROK** — Groq is the free Llama host; Grok is xAI's paid model.

groq/openai/grok all share one `generateOpenAICompatible()` raw-fetch helper (no extra npm dep). It translates Gemini `contents[{role,parts}]` → `messages[{role,content}]`.

### Vercel Environment Variables
| Var | Status | Notes |
|-----|--------|-------|
| `GEMINI_API_KEY` | ✅ set | Google AI Studio |
| `GEMINI_MODEL` | ✅ `gemini-2.5-flash` | **20 req/day free** — confirmed live via /api/health |
| `SUPABASE_URL` | ✅ set | |
| `SUPABASE_SERVICE_KEY` | ✅ set | |
| `TAVILY_API_KEY` | ✅ set | Search active |
| `GROQ_API_KEY` | ✅ set | Free failover working |
| `GROQ_MODEL` | optional | default `llama-3.3-70b-versatile` |
| `OPENAI_API_KEY` | ⬜ not set | enables paid GPT fallback when added |
| `XAI_API_KEY` | ⬜ not set | enables paid Grok fallback when added |
| `LLM_PROVIDER_ORDER` | optional | overrides default chain order |

### Supabase Schema — m8_conversations
```sql
id          UUID / BIGSERIAL (auto)
session_id  TEXT
role        TEXT  ('user' | 'assistant' | 'summary')
content     TEXT
topic       TEXT
summary     TEXT
importance  INTEGER     (DEFAULT 1)
created_at  TIMESTAMPTZ (DEFAULT NOW())
```

---

## 5. Intent Classification (6 categories — priority order)

`api/intentClassifier.js` — pure regex, **no LLM call** (so it doesn't consume Gemini quota). A personal-context guard runs BEFORE all patterns.

```
Personal guard → "my fleet this week" → NONE (not NEWS)

FACT_CHECK → "Is X operational?" / "Did X happen?"     → Tavily advanced + time_range:year
NEWS       → "Latest X" / "this week"                  → Tavily news topic, days:7
LIVE_DATA  → flights / stock prices / weather / rates  → Tavily basic (NO include_answer)
LOOKUP     → schools / restaurants / shipping / prices → Tavily basic
RESEARCH   → "explain X" / "summarize book"            → Tavily advanced
NONE       → personal / memory / conversational         → memory only, no Tavily
```

---

## 6. How Memory Works (current — Phase 1 keyword recall)

**Keyword-filtered recall**, NOT raw injection of all history:

1. Extract keywords from current message (EN + AR stop-word filter)
2. Fetch last 80 rows from past sessions (not current) — ORDER BY id DESC
3. Score each row by keyword overlap + importance
4. Take top 6 highest-scoring rows
5. Sort top 6 by id ASC (true chronological order)
6. Inject into system prompt as STATIC context (top of payload)
7. Dynamic conversation sits BELOW static context (primed for future caching)

**Known limitation:** No synonym matching. "courier partners" won't match "Keeta".
**Fixes on roadmap:** Milestone 2b `summarizeSession()` (rolling summaries) → Milestone 4 `semanticRecall()` (pgvector). Both currently STUBS in `memory.js`.

---

## 7. Reliability Features (added since v2.0)

- **Fault-tolerant orchestrator** — each slot (memory / search / LLM) has independent try/catch. Search failure → LLM runs without search context (graceful degrade). LLM failure → returns a fallback string. Outer try/catch as last guard. **Never returns a 500.**
- **Temporal anchor** — `orchestrate()` prepends `CURRENT DATE: Today is <date> (Riyadh time)…` to the system instruction every request (en-CA long, Asia/Riyadh tz). Directive tells the model a passed-in projection date is NOT the takeaway — lead with most recent info. (Fixed the "Metro operational in 2025" stale-answer bug.)
- **Tavily recency** — FACT_CHECK adds `time_range: "year"` so it pulls current status, not old forecasts. NEWS uses `days:7`.
- **Timeout safety** — 7s AbortController on all Tavily fetches; `maxDuration: 30` on chat.js. `include_answer` removed everywhere (it ran Tavily's internal LLM → +5-8s → Vercel timeout).
- **Robust LLM text extraction** — tries SDK `result.text`, falls back to manual `candidates[0].content.parts[]`, logs finishReason/blockReason on failure.
- **History sanitation** — null/undefined content items stripped before the LLM call (was the root cause of early "something went wrong" crashes).

---

## 8. API Contract (unchanged — frontend safe)

```
POST /api/chat
Body:    { message: string, sessionId: string, history: array }
Returns: { response: string }

GET /api/health
Returns: { ok: bool, model: string, checks: {GEMINI_API_KEY, SUPABASE_URL, ...} }
```

**History payload:** Frontend sends past turns only; backend appends current message — no duplication.

---

## 9. Milestone Pipeline

| # | Milestone | Status | Complexity |
|---|-----------|--------|------------|
| 1a | UI Polish (toggle, mic badge, duplicate fix) | ✅ DONE | Low |
| 1b | Orchestrator + LLM adapter + keyword memory | ✅ DONE | Medium |
| 1c | Supabase schema migration | ✅ DONE | Low |
| 2 | Tavily Search + 6-category intent classifier | ✅ DONE | Medium |
| 2.5 | Fault-tolerance + multi-provider chain + temporal fix | ✅ DONE | Medium |
| 2-test | E2E matrix — all 6 categories pass (June 6) | ✅ DONE | — |
| **2b** | **Memory summaries — activate `summarizeSession()`** | **⬜ NEXT** | Medium |
| 3 | Dashboard Analysis (`api/analysis.js`, Excel/CSV upload) | ⬜ | High |
| 4 | Semantic Memory (pgvector, `semanticRecall()`) | ⬜ | High |

### E2E Test Results — June 6, 2026 (all 6 categories PASS)
Ran one live probe per category against `m8-alpha.vercel.app/api/chat`. 6/6 OK, no 500s, no quota/connection errors, 2.6–9.6s (all < 30s limit). Logged in `tests/e2e-scenarios.md`.
- **LIVE_DATA** (weather): temp ranges + correct temporal awareness ("June 7, 2026"), honest about no exact daily data.
- **LOOKUP** (iPhone 16 KSA): real SAR prices with sources (Pricena, Apple SA, Amazon).
- **NEWS** (keeta): routed/searched fine, but Tavily news returned irrelevant crypto hits — model *detected* the mismatch and referenced memory ("the Keeta you oversee"). Data-quality limitation, not a pipeline bug.
- **FACT_CHECK** (keeta Bahrain): direct "yes, launched"; weak on visible citation.
- **RESEARCH** (last-mile): clear explanation + citations + real stat (53% of shipping cost).
- **NONE** (who am i): full profile recall, no search fired.

**Two open quality notes (NOT bugs, future polish):** (1) NEWS on niche brand names pulls junk from Tavily's news topic; (2) FACT_CHECK answers don't surface clickable source links.

---

## 10. Forbidden Until Milestones 2b→3→4 Complete

🚫 LangGraph / CrewAI / multi-agent orchestration
🚫 pgvector / Redis (semantic memory is Milestone 4, deferred until >5000 records)
🚫 WhatsApp / email automation
🚫 ElevenLabs voice
🚫 Authentication
🚫 Any UI redesign

> **Note:** the old "no OpenAI/Groq adapter in llm.js" ban was **lifted by deliberate decision** —
> the multi-provider chain is now core reliability infrastructure (see §4). Adding/removing a
> provider is still confined to `llm.js` only.

---

## 11. AI Collaboration Model

| AI | Role |
|----|------|
| **Claude** | Lead — all coding, architecture decisions, debugging, git pushes |
| **Gemini** | Consult: Gemini API specifics (caching syntax, model/quota, KSA tier behavior), Google ecosystem |
| **ChatGPT** | Consult: milestone architecture reviews, product direction, data-pipeline design |
| **Grok** | Consult: search/research quality, real-time data sourcing; originally specced the web-search module |

**Rule:** Don't round-trip to GPT/Gemini/Grok for decisions with clear engineering answers. Bring them in at milestone boundaries or for their specific domain knowledge.

---

## 12. Next Step — Milestone 2b Brief for Claude

> "M8 is live through Milestone 2.5 (Tavily search, 6-category classifier, multi-provider LLM
> fallback, fault-tolerant orchestrator, temporal anchor) and the e2e matrix passes 6/6. Now do
> Milestone 2b: activate `summarizeSession()` in `memory.js`. Replace raw-row recall growth with
> rolling LLM summaries — when a session ends (or every N turns), summarize its messages into one
> `role:'summary'` row (with `topic` + `importance`), so future recall pulls compact summaries
> instead of an ever-growing list of raw turns. Keep keyword scoring. Don't touch the API contract
> or the provider chain. `semanticRecall()` stays a stub (that's Milestone 4)."

---

## 13. Context + Consult Question for Each External AI (before Milestone 2b)

### → For ChatGPT (architecture review)
**Context:** Memory today = keyword recall over raw `m8_conversations` rows (top-6 by overlap+importance). It grows unbounded and has no synonym matching. Milestone 2b will add `summarizeSession()` — rolling LLM summaries stored as `role:'summary'` rows.
**Question:** "What's the right trigger and granularity for session summarization in a single-user agent — per-session-end, every N turns, or token-budget-based? How do we keep summaries from losing operationally-critical specifics (driver names, amounts, dates) while compressing chatter? And how should summary rows be weighted vs raw rows in keyword recall so summaries don't drown out recent detail?"

### → For Gemini (API specifics)
**Context:** Live model is `gemini-2.5-flash` via `@google/genai`. Free tier ≈ 20 req/day per project per model — this is our real ceiling and the reason we built a Groq failover. System prompt ~200 tokens + up to ~500 tokens memory context + a per-request CURRENT-DATE block.
**Question:** "(1) For `gemini-2.5-flash` as of mid-2026, what is the exact explicit Context Caching syntax in the `@google/genai` SDK, and the minimum token threshold to activate it? Does ~700 tokens of static prefix qualify? (2) Is there a higher free-tier daily request ceiling on any current Flash variant available to KSA accounts, or is paid the only way past ~20/day? (3) Does caching interact badly with a system prefix that changes every request (the date line)?"

### → For Grok (research/search quality)
**Context:** Search = Tavily, routed by a 6-category classifier. Per-category params: FACT_CHECK = advanced + `time_range:year`; NEWS = news topic `days:7`; LIVE_DATA/LOOKUP = basic; RESEARCH = advanced. `include_answer` is OFF (it caused Vercel timeouts). Two known weaknesses surfaced in testing: (a) NEWS on niche brand names (e.g. "Keeta") returns irrelevant results; (b) FACT_CHECK answers don't surface source citations to the user.
**Question:** "(1) How would you improve recall for niche/regional brand-name news queries on Tavily without re-enabling `include_answer` (e.g. query rewriting, domain hints, fallback from news→general)? (2) Best lightweight pattern to attach source citations (title + URL) to FACT_CHECK answers from Tavily results? (3) For genuinely real-time data (flight prices, FX, weather), is Tavily web-page scraping the ceiling, or is there a free/cheap structured-data source worth a dedicated tool later?"

---

## 14. Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| `gemini-2.5-flash` live (env override) | Set in Vercel; ~20 req/day free ceiling — accept + failover, don't fight it |
| Multi-provider chain in llm.js | Gemini free quota (20/day) exhausts fast; Groq (free) + paid backups keep M8 answering. Lifted the old single-provider rule |
| Groq as primary failover (not Grok) | Groq = free generous tier (Llama); Grok = paid. Free-first chain |
| Regex intent classifier (no LLM) | Routing must not consume the scarce Gemini quota |
| `include_answer: false` on all Tavily calls | Its internal LLM added 5-8s → Vercel 10s timeout |
| `time_range:year` on FACT_CHECK | Stops stale forecasts being reported as current status |
| Per-request CURRENT DATE injection | Model was answering with outdated year context |
| Fault-tolerant orchestrator (never 500) | Single-user agent must degrade gracefully, never hard-fail |
| Keyword filter (not raw injection) | Controls token growth, improves relevance |
| `id ASC` sort after relevance scoring | `.reverse()` broke chronological order after relevance sort (bug fixed) |
| Static-top / dynamic-bottom prompt | Primes structure for Gemini explicit caching later |

---

## 15. Operational Notes (for whoever edits the code)

- **M8 is its own git repo** (remote `Muhammedelhofy/M8-`, branch `main`). Vercel auto-deploys on push to `main`.
- **Local edits do nothing until pushed.** Clicking "Redeploy" in Vercel rebuilds the *existing* commit — it does NOT pick up uncommitted local changes. Always `git push` after editing.
- **Node is not installed on the dev Windows machine** (only git). `classifier-test.js` (unit) can't run locally until Node is installed — rely on the live e2e matrix meanwhile.
- PowerShell here-strings mangle `git commit -m` args — use multiple `-m` flags.
