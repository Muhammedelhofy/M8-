# M8 Routing V2 — All-Domain Meaning-Based Routing (PLAN)

**Owner:** Muhammad · **Author:** Claude Code · **Date:** 2026-06-25 · **Status:** PLAN (no code yet)
**Builds on:** the wallet⇄fleet arbiter (B-152) + `TEAM_ROUND_ROUTING_2026-06-25_RESPONSES.md`.

## The goal (his words: "the turning point")
Make the meaning-brain the **front door for EVERY domain**, not just wallet⇄fleet. M8 picks the
lane by *what you mean*; the keyword parsers become a fast-path, not the decider. Ambiguity →
**ask**. Novel phrasing → understood. **Hard constraints:** stay under **FREE quota**; never
regress the ~170 things that already work; confirm-before-write + privacy wall unchanged.

## The domains (the full menu the brain must route)
| Domain | Handler today | Notes |
|--------|---------------|-------|
| wallet | `handleWalletCommand` | ✅ already arbitrated (B-152) |
| fleet | `buildFleetContext` | ✅ already arbitrated (B-152) |
| finance (company P&L) | `buildFinanceContext` | currently pre-empts fleet by keyword |
| tasks | `handleTasksCommand` | reference-resolution done; not yet arbitrated |
| notes | `handleNotesCommand` | same |
| memory (recall/teach) | memory layer | "who is X" should prefer known person over web |
| docs (generate) | `generateArtifact` | brief/report nouns collide w/ fleet |
| knowledge / RAG | knowledge router | ingested books/docs |
| web (live search) | search waterfall | only when genuinely live/unknown |
| driver-profile (CRUD) | `handleDriverProfileCommand` | separate, keep |
| chat | LLM | the catch-all |

> Track B (math/Collatz/Lean engine) is OUT of scope — it has its own triggers; don't touch.

## Architecture (settled by the last round — restated, not re-litigated)
1. **`CAPABILITY_REGISTRY`** (new file `lib/capability-registry.js`) — ONE source of truth:
   `domain → { description, examplePhrasings[], handler-ref }`. The classifier prompt is BUILT
   from it; the dispatch map reads from it. (GPT's anti-drift rule.) Coarse actions
   (read/add/edit/delete/compare/convert/generate/recall/search), **not** 50 micro-intents
   (Gemini's anti-bloat rule).
2. **Generalize the arbiter** `domain-arbiter.arbitrate()` → `classifyTurn(message, ctx)` →
   `{ domain, action?, confidence, ambiguous }`. Deterministic ownership *scoring* first
   (per-domain term banks), a **free** LLM call ONLY on a contest/miss. Most-recent-turn wins
   for bare anaphora (the B-154 rule), generalized to all domains.
3. **`resolveTurnRoute`** maps the verdict to the EXISTING handler. The model proposes; locked
   handlers dispose. No new authority. Keyword fast-paths still run first for the obvious cases.
4. **(Optional) embeddings recall** — only if shadow data proves the classifier misses novel
   phrasings: pgvector (free on his Supabase) + a FREE embedding model (Gemini
   `text-embedding-004`, free tier) to map a new phrasing → nearest known intent.

## Rollout — incremental, shadow-first, lowest-risk boundary first (the council's mandate)

### B-155 — Foundation + SHADOW (zero behavior change)
- Build `CAPABILITY_REGISTRY` + generalize the classifier to all domains.
- Run it in **SHADOW**: after the *existing* router decides, log
  `{ existing_route, classifier_route, agree, confidence }` (redacted) — change NOTHING the user sees.
- 🔧 **SQL (small):** add a `kind` column to `m8_router_misses` (values: `miss` | `arbiter` |
  `shadow`) OR a sibling view — so shadow rows are queryable without polluting the miss list.
- 🔴 **HIM — live use:** just use M8 normally for ~3–5 days so shadow data accumulates.
- Kill switch `M8_ROUTER_V2_SHADOW=0`. Deploy on his OK.

### B-156 — FLIP #1: the lookup boundary (memory ⇄ web ⇄ knowledge ⇄ chat)
- Lowest-risk, high-value: fixes the standing backlog item — **"who is X" should recall a known
  person, not web-search a generic acronym** (current known polish item).
- Doesn't touch money/fleet CRUD → small blast radius.
- Gate: shadow agreement ≥ bar on this boundary first. Kill switch. 🔴 live test.

### B-157 — FLIP #2: the CRUD boundary (tasks ⇄ notes ⇄ wallet ⇄ fleet)
- Extend the arbiter to decide tasks/notes the same way it now does wallet/fleet; retire the
  scattered per-lane guards in favour of the one classifier.
- Gate: shadow-proven. Kill switch. 🔴 live test.

### B-158 — FLIP #3: docs ⇄ finance ⇄ fleet ⇄ driver-profile + cleanup
- The trickiest collisions (brief/report/P&L nouns). Last because highest overlap.
- Retire now-redundant keyword guards. Kill switch. 🔴 live test.

### B-159 — (OPTIONAL) embeddings recall — ONLY if B-155 shadow shows the classifier misses
- 🔧 **SQL (bigger, FREE):** enable `pgvector`; create `m8_intent_examples` (domain, phrasing,
  embedding vector); seed example phrasings per domain.
- Free Gemini embeddings to embed examples + the incoming message; nearest match → a domain hint
  fed to the classifier. Kill switch.

## Parallel sessions? — mostly NO (honest)
The core work lives in ONE file (`lib/orchestrator.js`) + `domain-arbiter.js`, so it's **sequential**
— parallelizing the central router invites merge races for little gain. The ONE clean split:
- **Session P (parallel-safe, NEW files only):** `lib/capability-registry.js` (+ B-159
  `lib/intent-embeddings.js` + the SQL migration). Disjoint from orchestrator.
- **Session C (sequential core):** the orchestrator/arbiter wiring that CONSUMES the registry.
Recommendation: run B-155 as ONE session that creates the registry file *and* wires the shadow
classifier (the dependency makes a true parallel split low-value here).

## 🔴 Where I'll call you in (you asked me to flag these)
| When | What I need |
|------|-------------|
| After **B-155** ships | 🔴 **Live use** ~3–5 days (normal usage) so shadow data builds |
| Before **each FLIP** (B-156/157/158) | 🔴 **Review** — I'll show you the shadow disagreements; you sanity-check |
| After each flip | 🔴 **Live phone test** (a `tests/BUILD15x_LIVE_TEST.md` per build) |
| Every prod push | 🔴 **Explicit "deploy" OK** (your standing rule) |

## 🔧 Where SQL / Supabase is needed
| Build | SQL | Size | Cost |
|-------|-----|------|------|
| B-155 | `m8_router_misses` + `kind` column (shadow rows) | tiny | free |
| B-159 (optional) | enable `pgvector` + `m8_intent_examples` table + seed | medium | free |
> I'll hand you the exact SQL to paste (or run it via the Supabase tool with your OK) — and call
> it out clearly each time, never silently.

## Free-stack confirmation ($0)
- Classifier: free Groq/Gemini (already wired) — one call only on unclear turns.
- Embeddings (only if needed): Gemini `text-embedding-004` free tier + Supabase pgvector (free).
- **No paid API.** If anything ever needs a key, I explain purpose/free?/benefit BEFORE adding it.

## Next step
Council red-teams the ROLLOUT (not the architecture) → see
`TEAM_ROUND_ROUTING_V2_2026-06-25.md`. Then I write the full B-155 session prompt + build.
