# M8 Build Plan — Builds 150→154 (from the 2026-06-25 council round)

Start any session when convenient. Each prompt below is **self-contained** — paste it as the
first message of a fresh Claude Code session in the `Bolt` root and it knows everything.

---

## The golden rules (every session follows these — already baked into each prompt)
1. **Branch off `origin/main` first.** Run `git fetch origin` and check `origin/main` — if this
   build already shipped, STOP and say so.
2. **Touch ONLY your files.** `git add` your own files **explicitly** — never `git add -A`.
3. **Test + doc:** ship a `tests/buildXXX-*.ps1` (PS-5.1 mirror, re-save with UTF-8 BOM) and a
   `tests/BUILDXXX_LIVE_TEST.md`.
4. **Report when done:** write `reports/build-XXX-done.json` (`{build, branch, head, tests, status}`),
   commit it with your files, push your branch.
5. **NEVER merge to `main` or deploy without Muhammad's explicit OK** — pushing `main` auto-deploys prod.
6. Privacy wall absolute (money never to an LLM); confirm-before-write; Vercel 12-function cap is FULL
   (no new `api/*.js` — reuse `api/ops?fn=`).

---

## Overlap map — what can run together

| Build | Owns these files | Touches `orchestrator.js`? | Can run in parallel with |
|---|---|---|---|
| **150 Miss-logger** | `lib/miss-logger.js` (new) + small hook in `lib/orchestrator.js` | ✅ yes | 153 only |
| **151 Career memory** | `lib/career.js` (new) + lane in `lib/orchestrator.js` | ✅ yes | 153 only |
| **152 Career actions** | extends `lib/career.js` + `lib/orchestrator.js` | ✅ yes | 153 only |
| **153 Email nudges** | `lib/morning-brief.js` + `lib/nudge-thresholds.js` (new) | ❌ no | **any one** of 150/151/152/154 |
| **154 Cross-domain links** | tasks handler + link helper + `lib/orchestrator.js` | ✅ yes | 153 only |

### The rule in one line
**At most 2 sessions at once: ONE orchestrator build (150 → 151 → 152 → 154, in order) + Build-153 (independent).**
The four orchestrator builds share `lib/orchestrator.js`, so they MUST go one-at-a-time — each starts
only **after** the previous one merges to main. Build-153 never touches `orchestrator.js`, so it's the free parallel slot.

### Dependencies
- 152 needs 151 (same `career.js`). 154 is last (most contested — read-only links only).
- 150 and 153 have no dependencies — safest to start first.

---

## Recommended order
1. **150 (miss-logger)** + **153 (email nudges)** — in parallel. Both low-risk, independent.
2. **151 (career memory)** — after 150 merges.
3. **152 (career actions)** — after 151 merges.
4. **154 (cross-domain links)** — last, only if still wanted.

---

## SESSION PROMPTS (paste one to start that build)

### ▶ Build-150 — Miss-Logger  ·  Model: Sonnet · Effort: HIGH
```
Model: Sonnet · Effort: HIGH · Build-150 (Miss-Logger / self-widening router).
First: cd into Bolt/M8, `git fetch origin`, check origin/main — if Build-150 already shipped, STOP.
Branch off origin/main: feat/miss-logger.
GOAL: when M8 falls through to the capability-decline / Phase-0 safety net (i.e. it couldn't handle a
message), log it for later review — so we can teach M8 new phrasings. AI proposes, owner commits; no new authority.
SCOPE (own ONLY these): NEW lib/miss-logger.js (logMiss(message, lane, reason) → Supabase m8_router_misses,
fire-and-forget, NO money/PII: strip digits+currency before storing); a SMALL hook in lib/orchestrator.js
at the capability-fallback / safety-net return path to call logMiss; a read command "show my recent misses" /
"what did M8 not understand" → list last N. Create the Supabase table m8_router_misses (id, created_at,
message_redacted, lane, reason) on the BOLT project ltqpoupferwituusxwal.
TEST: tests/build150-miss-logger-test.ps1 (redaction + the detection of a "should-log" case) + tests/BUILD150_LIVE_TEST.md.
Privacy: redact money/digits before storing; never store a money turn's content.
DONE: write reports/build-150-done.json, `git add` ONLY your files, commit, push feat/miss-logger.
DO NOT merge to main or deploy — wait for Muhammad's OK.
```

### ▶ Build-153 — Proactive Email Nudges  ·  Model: Sonnet · Effort: HIGH  ·  (parallel-safe)
```
Model: Sonnet · Effort: HIGH · Build-153 (Proactive email-only nudges).
First: cd into Bolt/M8, `git fetch origin`, check origin/main — if Build-153 already shipped, STOP.
Branch off origin/main: feat/brief-nudges.
GOAL: add deterministic NUDGES to the 7am email brief ONLY (never chat, never an LLM): "rent due in 3 days",
"spending higher than usual this week", "follow-up overdue". Signals, NOT raw amounts — a glanceable phone
screen must not reveal figures. Email-only (formatBriefHTML), NOT formatBriefText (that path is LLM-narrated).
SCOPE (own ONLY these): lib/morning-brief.js (a nudge section in the HTML email + attach), NEW
lib/nudge-thresholds.js (deterministic threshold logic, pre-computed static strings). Gate behind
M8_BRIEF_NUDGES_ENABLED=1 (default OFF → brief byte-identical). Import-isolated + fail-safe.
DO NOT touch lib/orchestrator.js (keep this disjoint so it runs parallel with the router/career builds).
TEST: tests/build153-nudges-test.ps1 (privacy invariant: formatBriefText has no nudge amounts; threshold logic)
+ tests/BUILD153_LIVE_TEST.md. Ask Muhammad to define the exact thresholds before enabling.
DONE: write reports/build-153-done.json, `git add` ONLY your files, commit, push feat/brief-nudges.
DO NOT merge to main or deploy — wait for Muhammad's OK.
```

### ▶ Build-151 — Career Memory  ·  Model: Opus · Effort: MAX  ·  (start AFTER 150 merges)
```
Model: Opus · Effort: MAX · Build-151 (Career OS — memory foundation).
First: cd into Bolt/M8, `git fetch origin`, check origin/main — if Build-151 already shipped, STOP.
Branch off the LATEST origin/main (so you get Build-150's merged changes): feat/career-memory.
GOAL: M8 tracks the job hunt — companies, contacts/recruiters, applications, follow-ups. Chat:
"log: applied to Noon as Ops Director", "where am I with Noon?", "who do I follow up with?".
Reuses the existing entity-graph (lib/entity-graph.js, m8_entities) where it helps. Confirm-before-write.
SCOPE (own ONLY these): NEW lib/career.js (CRUD + reads over new Supabase tables m8_career_companies /
m8_career_contacts / m8_career_applications); a career lane in lib/orchestrator.js. Create the Supabase
tables on BOLT ltqpoupferwituusxwal.
TEST: tests/build151-career-test.ps1 (intent parsing for the career lane) + tests/BUILD151_LIVE_TEST.md.
This serves Muhammad's #1 goal (market-rate job ~July 2026) — make it genuinely useful, not a toy.
DONE: write reports/build-151-done.json, `git add` ONLY your files, commit, push feat/career-memory.
DO NOT merge to main or deploy — wait for Muhammad's OK.
```

### ▶ Build-152 — Career Actions  ·  Model: Opus · Effort: MAX  ·  (start AFTER 151 merges)
```
Model: Opus · Effort: MAX · Build-152 (Career OS — drafts/tracker/prep).
First: cd into Bolt/M8, `git fetch origin`, check origin/main — if Build-152 already shipped, STOP.
Branch off the LATEST origin/main (needs Build-151's career.js): feat/career-actions.
GOAL: on top of Build-151, add: a status-tracker view ("show my pipeline"), draft helpers (LinkedIn
message / cover-letter / follow-up email drafts — DRAFT ONLY, never auto-send), and interview prep
("likely questions for an Ops Director role" using his fleet/finance experience).
SCOPE (own ONLY these): extend lib/career.js; the career lane in lib/orchestrator.js. No new tables unless needed.
TEST: tests/build152-career-actions-test.ps1 + tests/BUILD152_LIVE_TEST.md.
DONE: write reports/build-152-done.json, `git add` ONLY your files, commit, push feat/career-actions.
DO NOT merge to main or deploy — wait for Muhammad's OK.
```

### ▶ Build-154 — Read-only Cross-Domain Links  ·  Model: Opus · Effort: MAX  ·  (LAST)
```
Model: Opus · Effort: MAX · Build-154 (read-only cross-domain links).
First: cd into Bolt/M8, `git fetch origin`, check origin/main — if Build-154 already shipped, STOP.
Branch off the LATEST origin/main: feat/cross-domain-links.
GOAL: "remind me to pay rent" → create a TASK that REFERENCES the bill by id (a read-only link), confirm-gated.
HARD RULE (Gemini's council kill): NO shared mutable state — a task NEVER creates/edits/rolls-back a wallet
transaction. Links are read-only references only (task.bill_id), so deleting a task can't corrupt money state.
SCOPE (own ONLY these): the tasks handler (lib/handlers or wherever tasks live) + a small link helper +
the relevant lane in lib/orchestrator.js. Add a nullable bill_id reference to m8_tasks if needed.
TEST: tests/build154-cross-link-test.ps1 + tests/BUILD154_LIVE_TEST.md.
DONE: write reports/build-154-done.json, `git add` ONLY your files, commit, push feat/cross-domain-links.
DO NOT merge to main or deploy — wait for Muhammad's OK.
```

---

## After each session finishes
Muhammad reviews → says deploy → that session (or this main one) merges its branch to main and pushes
(auto-deploys). The `reports/build-XXX-done.json` files make it obvious which builds are finished and
which are still open, so nothing is lost between sessions.
