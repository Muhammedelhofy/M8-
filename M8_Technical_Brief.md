# M8 — Technical Brief & Session Handoff
**Version:** 4.0 | **Updated:** June 7, 2026
**Lead:** Claude · **Consults:** GPT (architecture) · Grok (data/UX/trends) · Gemini (Google/API)
**Live URL:** https://m8-alpha.vercel.app
**GitHub:** https://github.com/Muhammedelhofy/M8- (branch `main`, auto-deploys to Vercel)
**Latest commit:** `233710a` (reliability layer — June 7) · deploys GREEN

> **For GPT / Grok / Gemini:** single source of truth for where M8 stands *now*. Everything marked ✅ is live in production and verified. §13 has the next-milestone (M3) consult questions per lane.

---

## 1. Vision
M8 is a personal AI Operating System for Muhammad El-Hofy — not a chatbot. Persistent, voice-first agent that understands his world: Bolt KSA fleet ops (~102 bikes), courier supply (Hunger Station, Noon, Keeta, Uber), YouTube, daily work in Riyadh. Single user, Egyptian, in Saudi Arabia. Codename M8 = "mate" (crew member who knows the ship).

## 2. The One Rule (non-negotiable)
Before any feature: it must improve at least one of **Memory · Research · Analysis · Automation · Communication.**

---

## 3. Architecture (current — all ✅ LIVE)

```
Frontend (vanilla JS)
   ↓
api/chat.js            ← thin HTTP handler
   ↓
lib/orchestrator.js    ← THE pipeline (fault-tolerant, never 500). Per request:
   ├─ trivial-input bypass (garbage → static reply)
   ├─ recallMemory()                      (lib/memory.js)
   ├─ classifyIntent() + slot-fill merge  (lib/intentClassifier.js)
   ├─ DOC intent → generateArtifact()     (lib/docgen.js)
   ├─ knowledge-decision router           (lib/router.js)  answer | search | clarify
   ├─ clarification gate (deterministic)  (lib/slots.js)
   ├─ search() → Tavily                   (lib/search.js → lib/tools/searchTool.js)
   ├─ domain playbooks injected           (lib/playbooks.js)
   ├─ generate() multi-provider + breaker (lib/llm.js)
   ├─ saveMemory() + summarizeSession()   (lib/memory.js)
   └─ logTrace()                          (observability)
```

### ⚠️ Architecture RULE (learned the hard way this session)
**`api/` = HTTP endpoints ONLY.** Vercel **Hobby caps Serverless Functions at 12**, and Vercel counts *every* `.js` in `/api/` as a function. We hit it (16 files → all deploys silently failed). Fix: **all shared logic lives in `/lib/`** (modules = free); only endpoints live in `/api/`. We're at **5 endpoints** (8 to spare).

```
M8/
├── api/                       ← ENDPOINTS ONLY (5/12)
│   ├── chat.js                ← POST /api/chat
│   ├── health.js              ← GET  /api/health (env check)
│   ├── summary-health.js      ← GET  /api/summary-health (summarizer observability)
│   ├── traces.js              ← GET  /api/traces (per-request observability)
│   └── cron-summarize.js      ← GET  /api/cron-summarize (daily self-heal cron)
├── lib/                       ← all logic (free, not counted as functions)
│   ├── orchestrator.js  llm.js  memory.js  intentClassifier.js
│   ├── slots.js  router.js  docgen.js  playbooks.js  search.js
│   └── tools/ (searchTool.js, analysisTool.js)
├── js/ (app.js, chat.js, voice.js)   css/style.css   index.html
├── tests/   package.json   vercel.json (crons + maxDuration)
```

---

## 4. Stack & Providers
| Layer | Tech |
|------|------|
| Serverless | Vercel (Node 18+) | 
| DB | Supabase (`m8_conversations`, ref `ltqpoupferwituusxwal`) + `summary_runs`, `request_traces` |
| Search | Tavily (per-category params, 7s timeout, no `include_answer`) |
| LLM | **6-provider chain + circuit breaker** |

**LLM chain** (`lib/llm.js`, single swap point) — order `gemini,gemini2,groq,cerebras,openrouter,mistral,openai,grok` (free first). On failure → next provider. **Circuit breaker:** a provider that 429s is skipped for 60s (15s other errors) so we stop hammering throttled tiers. `generate({…, meta})` reports which provider answered.
- **gemini** (personal acct) + **gemini2** (work acct) — `@google/genai`, `gemini-2.5-flash`, ~20 req/day each free; `thinkingBudget:0` (thinking was eating the output budget → truncation).
- **groq / cerebras / openrouter / mistral** — free tiers, OpenAI-compatible via one `generateOpenAICompatible()` helper.
- **openai / grok** — paid, keys not set (inert). **Adding `OPENAI_API_KEY` (gpt-4o-mini, cents) is the recommended fix for free-tier throttling on heavy days.**
- Gemini calls set `safetySettings: BLOCK_ONLY_HIGH` so non-mainstream/worldview topics aren't silently blocked.

---

## 5. Routing — knowledge state, not topic
1. **Regex classifier** (`intentClassifier.js`, no LLM) fast-paths the obvious: personal/fleet → memory; clear search intents (FACT_CHECK/NEWS/LIVE_DATA/LOOKUP/RESEARCH) → search; DOC → doc-gen.
2. For anything it leaves as NONE (and not personal/chat) → **knowledge-decision router** (`router.js`, one cheap LLM call on a fast free provider) decides **answer | search | clarify**. This ended the "every new topic needs a regex patch" problem.
3. **Clarification gate** (`slots.js`, deterministic): a searchable query missing required slots (e.g. flight w/o destination/dates) → asks instead of searching. **Slot-fill** merges the follow-up answer with the original query. **Query rewriting** enriches before Tavily (e.g. injects "from Riyadh", current year).

## 6. Brain / persona (`M8_SYSTEM_PROMPT` in orchestrator)
Decisive "mate": gives calibrated opinions + reasoning + caveat (not "I can't advise"); separates **fact vs "my read"**, opinion only when asked. EQ (empathy-first), mature, **honest** (never fabricates, admits limits), **respects non-mainstream worldview** (no debunk-lecture), **integrity toward others** (hard-refuses fake reviews/deception). Escalates only on genuine medical/legal/crisis. **Capability honesty:** never claims to "search/retrieve in the background" (it's synchronous). Concise (voice-first).

## 7. Domain Playbooks (`lib/playbooks.js`) — 9 domains
Injectable expertise (NOT agents): **operations, finance, negotiation, youtube, decision, islamic, recruitment, sales, project**. Each = principles + frameworks + common-mistakes + a **NEVER-INVENT** list. A **PLAYBOOK_GUARD** prepends every injection: *playbooks reason, they never create facts — any stat/number must come from search or memory, else hedge.* Up to 2 domains injected per query (multi-domain).

## 8. Memory (`lib/memory.js`)
- **Recall (two-tier):** all current canonical facts (profile/operational, `is_current=true`) always injected + recent summaries/raw scored by keyword + importance. Ordered by `created_at` (NOTE: `id` is a **UUID**, not numeric — never order/compare by it; this bug had silently stopped the summarizer).
- **Rolling summaries:** `summarizeSession()` fires every ~10 new rows, structured JSON (summary + entities + facts), on free providers. ✅ Verified producing summary + fact rows.
- **Fact supersession:** `upsertFact()` — a changed fact marks the old row `is_current=false` (kept for history) + inserts the new current one. One current row per `memory_key`.
- **Observability:** every summary run logged to `summary_runs` → `/api/summary-health`. **Self-heal:** daily cron (`/api/cron-summarize`) re-summarizes stuck sessions.

## 9. Other capabilities
- **Doc/presentation generation** (`lib/docgen.js`): DOC intent → template (6: one-page-plan/brief/meeting-summary/action-plan/deck-brief/proposal) → LLM fills content → Markdown. Frontend export (Copy/PDF/pptx) = phase-1.5 TODO.
- **Observability/reliability:** circuit breaker + `request_traces` (intent, provider, search, memory, latency, ok/error) via `/api/traces`.

---

## 10. API contract (frontend-safe, unchanged)
```
POST /api/chat   body { message, sessionId, history }  → { response }
GET  /api/health → { ok, model, checks }
GET  /api/summary-health , /api/traces → observability JSON
```

## 11. Milestone status
| # | Milestone | Status |
|---|-----------|--------|
| 1–2.5 | Shell, orchestrator, classifier, Tavily, multi-provider, fault-tolerance | ✅ |
| 2b | Structured memory: summaries + supersession + recall rework | ✅ (UUID bug fixed) |
| — | Decisive/honest/EQ/ethical brain + worldview + capability-honesty | ✅ |
| — | Knowledge-decision router + clarification gate + slot-fill + query-rewrite | ✅ |
| — | 9 domain playbooks (anti-fabrication, multi-domain) | ✅ |
| — | Doc/presentation generation | ✅ |
| — | Reliability: circuit breaker + observability (traces, summary-health, cron) | ✅ |
| **3** | **Fleet data analysis (connect dashboard) — data-grounded playbooks** | **⬜ NEXT** |
| 4 | Semantic memory (pgvector) — only after data volume warrants | ⬜ |

## 12. Don't (consensus — deferred/skip)
🚫 Multi-agent swarms · framework migration (LangGraph/CrewAI/AutoGen) · MCP *now* (stay MCP-shaped, wrap later) · ripping out the working summarizer for mem0 (borrow its "ADD-only" idea at M4 only) · pgvector before data warrants · WhatsApp/email · auth · UI redesign · **adding modules to `api/` (keep ≤12 functions).**

---

## 13. Milestone 3 — Fleet Data — consult questions
**Goal:** connect M8 to the fleet's real data → live fleet answers + ground the ops playbook in real numbers. **Source:** the MOHM fleet dashboard stores its full history as a **compressed JSON blob ('c1' codec) in the *same* Supabase project** (not normalized rows). Per driver/day: net/gross earnings, cash vs in-app, commission/fees, payout, tier, utilisation, acceptance/finish rates, rating. **`Net earnings` is Bolt-side, not fleet profit.** Principle: **deterministic compute — code finds truth, LLM explains.** Bolt-side analysis first; P&L cost overlay later.

- **GPT (architecture):** read+decode the blob on demand vs. a **sync into normalized rows** (one driver/one day)? `FLEET` intent → analysis module reusing the router? How do **data-grounded playbooks** inject real fleet metrics into the ops playbook cleanly? Minimum lovable v1?
- **Gemini (API):** best use of **Code Execution** (Gemini-only) for reliable fleet math, **structured output** for chart-ready analytics, **function-calling** so M8 pulls only the data it needs; decoding a large blob within Vercel limits (4.5MB body / timeouts)?
- **Grok (data/UX):** the 5–8 highest-value daily analytics for a delivery-fleet manager; the voice-friendly **"mission-control" summary** format; proactive briefs/anomaly alerts; blob-decoding gotchas.

Output: `## Recommended M3 design` / `## Your-lane` / `## One thing to tell Claude`.

---

## 14. Key decisions log (additions this session)
| Decision | Rationale |
|----------|-----------|
| `api/` = endpoints only, logic in `lib/` | Vercel Hobby 12-function cap silently failed every deploy when api/ hit 16 |
| Order/compare memory by `created_at`, not `id` | `id` is a UUID; `id>0` → NaN → summarizer never fired (root-caused via SQL error) |
| Knowledge-decision router (answer/search/clarify) | Topic-based regex can't cover every domain — classify by knowledge state instead |
| Playbooks = reasoning, never authority | They made M8 confidently fabricate stats; guard + NEVER-INVENT + search-grounding |
| Provider circuit breaker | Stop hammering a 429'd provider; faster failover (free tiers throttle under load) |
| `thinkingBudget:0` on Gemini | 2.5-flash "thinking" ate maxOutputTokens → truncated reasoning answers |
| 2 Gemini accounts (personal primary) | More free quota + keep personal queries off the work Google account |
| Deterministic-first everywhere | Code/regex where possible; LLM for reasoning. "More deterministic, not more agentic." |

## 15. Operational notes
- M8 is its own git repo (`Muhammedelhofy/M8-`, `main`); Vercel auto-deploys on push. **A new endpoint that 404s = CHECK the Vercel deploy status** (don't assume "lag" — a failed build serves the last good commit).
- **Pending migration:** run the `request_traces` table SQL (so `/api/traces` populates). `summary_runs` + the 2b columns already migrated.
- No Node on the dev Windows box (only git) — unit tests run via live e2e. PowerShell mangles Arabic + here-strings; use `curl --data-binary @utf8file` for Arabic tests and multiple `-m` flags for commits.
