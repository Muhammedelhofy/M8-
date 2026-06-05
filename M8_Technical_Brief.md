# M8 — Technical Brief & Session Handoff
**Version:** 2.0 | **Updated:** June 5, 2026  
**Reviewed by:** Claude (lead) + Gemini + ChatGPT  
**Live URL:** https://m8-alpha.vercel.app  
**GitHub:** https://github.com/Muhammedelhofy/M8-  

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

## 3. Current Architecture (Phase 1 — LIVE)

```
Frontend (Vanilla JS)
    ↓
api/chat.js          ← HTTP handler only (20 lines)
    ↓
api/orchestrator.js  ← Pipeline: Memory → [Search] → [Analysis] → LLM → Store
    ├─ api/memory.js  ← Supabase keyword-filtered recall + Phase 2/3 stubs
    └─ api/llm.js     ← Gemini adapter (provider-agnostic interface)
```

### Repository Tree

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
│   ├── orchestrator.js         ← THE pipeline (Slots 2&3 stubbed for Search/Analysis)
│   ├── llm.js                  ← Gemini adapter — swap provider here only ✅
│   ├── memory.js               ← Keyword recall + summarizeSession/semanticRecall stubs
│   ├── health.js               ← GET /api/health — env check
│   ├── search.js               ← ⬜ Milestone 2 — Tavily
│   └── analysis.js             ← ⬜ Milestone 3 — Dashboard/Excel
├── package.json                ← @google/genai + @supabase/supabase-js
└── vercel.json                 ← API rewrites
```

---

## 4. Stack & Environment

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS |
| Serverless | Vercel (Node.js) |
| LLM | Gemini 1.5 Flash (`gemini-1.5-flash`) |
| Database | Supabase (`m8_conversations` table) |
| Search | Tavily (key set, not yet active) |

### Vercel Environment Variables (all set ✅)
- `GEMINI_API_KEY` — Google AI Studio key (new project, free tier active)
- `GEMINI_MODEL` — `gemini-1.5-flash` (gemini-2.0-flash has limit:0 in KSA)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `TAVILY_API_KEY` — reserved for Milestone 2

### Supabase Schema — m8_conversations
```sql
id          UUID / BIGSERIAL (auto)
session_id  TEXT
role        TEXT  ('user' | 'assistant' | 'summary')
content     TEXT
topic       TEXT        ← added June 5 (Phase 2)
summary     TEXT        ← added June 5 (Phase 2)
importance  INTEGER     ← added June 5 (Phase 2, DEFAULT 1)
created_at  TIMESTAMPTZ ← added June 5 (DEFAULT NOW())
```

---

## 5. How Memory Works (Phase 1)

**Keyword-filtered recall** — NOT raw injection of all history:

1. Extract keywords from current message (EN + AR stop-word filter)
2. Fetch last 80 rows from past sessions (not current) — ORDER BY id DESC
3. Score each row by keyword overlap + importance
4. Take top 6 highest-scoring rows
5. Sort top 6 by id ASC (true chronological order)
6. Inject into system prompt as STATIC context (top of payload)
7. Dynamic conversation sits BELOW static context (primed for future caching)

**Known limitation:** No synonym matching. "courier partners" won't match "Keeta".  
**Fix:** Phase 3 pgvector semantic search (stubbed in memory.js as `semanticRecall()`).

---

## 6. API Contract (unchanged — frontend safe)

```
POST /api/chat
Body:    { message: string, sessionId: string, history: array }
Returns: { response: string }

GET /api/health
Returns: { ok: bool, model: string, checks: {GEMINI_API_KEY, SUPABASE_URL, ...} }
```

**History payload:** Frontend sends `history.slice(0, -1)` (past turns only).  
Backend explicitly appends current message via `contents.push()` — no duplication.

---

## 7. Milestone Pipeline

| # | Milestone | Status | Complexity |
|---|-----------|--------|------------|
| 1a | UI Polish (toggle, mic badge, duplicate fix) | ✅ DONE | Low |
| 1b | Orchestrator + LLM adapter + keyword memory | ✅ DONE | Medium |
| 1c | Supabase schema migration | ✅ DONE | Low |
| **2** | **Tavily Search** (`api/search.js` + intent detection) | **⬜ NEXT** | Low |
| 2b | Memory summaries (`summarizeSession()` activated) | ⬜ | Medium |
| 3 | Dashboard Analysis (`api/analysis.js`, Excel upload) | ⬜ | High |
| 4 | Semantic Memory (pgvector, `semanticRecall()`) | ⬜ | High |

---

## 8. Explicitly Forbidden Until Milestones 2→3→4 Complete

🚫 LangGraph / CrewAI / multi-agent  
🚫 Vector databases / Redis  
🚫 WhatsApp / email automation  
🚫 ElevenLabs voice  
🚫 Authentication  
🚫 OpenAI / Groq adapter in llm.js  
🚫 Any UI redesign  

---

## 9. AI Collaboration Model

| AI | Role |
|----|------|
| **Claude** | Lead — all coding, architecture decisions, debugging, git pushes |
| **Gemini** | Consult for: Gemini API specifics (caching syntax, model pricing), Google ecosystem |
| **ChatGPT** | Consult for: milestone architecture reviews, product direction, data pipeline design |

**Rule:** Don't round-trip to GPT/Gemini for decisions with clear engineering answers. Bring them in at milestone boundaries or for their specific domain knowledge.

---

## 10. Next Session — Milestone 2 Brief for Claude

Tell Claude:

> "M8 Phase 1 is complete and live. Architecture: chat.js (HTTP) → orchestrator.js (pipeline) → llm.js (Gemini adapter) + memory.js (keyword recall). Supabase migration done. Now build Milestone 2: Tavily search. Create api/search.js with a Tavily fetch wrapper. Add intent detection in orchestrator.js — a simple classifier that decides whether the message is a research question (trigger search) or a conversational/operational question (skip search). TAVILY_API_KEY is already set in Vercel. Slot 2 in orchestrator.js is already commented and waiting. No other changes needed."

---

## 11. Gemini Consult — Before Milestone 2 Caching

Ask Gemini:

> "For Gemini 1.5 Flash, what is the exact API syntax for explicit Context Caching as of mid-2026? What is the minimum token count required to activate caching? We have a system prompt of ~200 tokens + up to ~500 tokens of memory context. Does that qualify, or do we need to reach a higher threshold first? Show the exact @google/genai SDK call."

---

## 12. Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| Gemini 1.5 Flash (not 2.0) | gemini-2.0-flash returns limit:0 on KSA free tier accounts |
| Keyword filter (not raw injection) | Controls token growth, improves relevance |
| `id ASC` sort after relevance scoring | `.reverse()` breaks chronological order after relevance sort (bug found + fixed) |
| Static-top / dynamic-bottom prompt | Primes structure for Gemini explicit caching in Phase 2 |
| `IF NOT EXISTS` in SQL migration | Safe to run regardless of existing schema state |
