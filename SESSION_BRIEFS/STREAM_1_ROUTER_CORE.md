# Parallel Session — STREAM 1 · ROUTER CORE
**Model: Opus · Effort: MAX** (central nervous system; must-not-regress; risky)
**Branch:** `feat/router-registry` off `origin/main`
**This file IS your kickoff prompt — it is self-contained. Read the files it names before editing.**

---

## Who you are
You are the **Router Core** build session for **M8**, Muhammad's personal AI assistant.
Repo: `Muhammedelhofy/M8-` (this `M8/` folder has its OWN git; prod = `m8-alpha.vercel.app`,
which **auto-deploys on push to `main`** — so **never push `main` without Muhammad's explicit OK**).

## YOU OWN these files (no other session touches them)
- `lib/orchestrator.js`  ← the single ~5k-line central router
- `lib/domain-arbiter.js`
- `lib/intent-router.js`
- **NEW** `lib/capability-registry.js`
- `tests/build155_*.ps1`, `tests/build156_*.ps1`, `tests/build157_*.ps1`, `tests/build158_*.ps1`

## DO NOT TOUCH (other streams own these — editing them = a merge race)
- `scripts/ingest-*`, `lib/knowledge-intake.js`, `INGEST_MANIFEST.md`  → Stream 2
- `tests/routing_corpus.jsonl`  → Stream 3 produces it; you only **read** it

## Where routing stands (cold-start context)
M8's router was keyword-first whack-a-mole. **Build-152 shipped a wallet⇄fleet "front-door
arbiter"** (`lib/domain-arbiter.js`): deterministic ownership scoring + a free-LLM tie-break
**only on a true contest**, amounts masked to `#`, toss-ups **ASK** ("wallet or fleet?"), and it
logs every decision (redacted) to `m8_router_misses` lane=`arbiter:*`. It is wired into BOTH
`orchestrate()` and `orchestrateStream()` via the shared `resolveDomainRoute()` seam.
**Your job: extend that one-decision arbiter from wallet⇄fleet to ALL domains.**

> Validation note: the live "shadow" did **not** accumulate — only **7 rows exist (all 06-25)**.
> So you validate against a **seeded corpus** (`tests/routing_corpus.jsonl`, from Stream 3), NOT
> live traffic. If the corpus file is absent when you reach test time, build a minimal inline one
> from the 7 known phrasings (see Stream 3 brief) and proceed.

## The build sequence (ALL touch `orchestrator.js` → ONE session, STRICTLY SEQUENTIAL)
Each step ships behind its own kill switch, off a branch from `origin/main`, with a PS-5.1 mirror
+ a live phone test, and a `reports/build-15X-done.json`. **No push to `main` without Muhammad's OK.**

**B-155 — Capability registry + broaden the classifier (DEFAULT-OFF, zero behavior change)**
- Create `lib/capability-registry.js` = ONE source of truth: `{ domain: [coarse actions] }` for
  `wallet | fleet | tasks | notes | memory | docs | web | chat`. **Coarse actions only**
  (`read/add/edit/delete/convert/recall/search/generate`) — this is the explicit guard against
  BOTH capability drift (hand-kept menu rots) AND free-model schema-bloat / attention degradation.
- Generalize `domain-arbiter.arbitrate()` into a registry-driven classifier: deterministic
  ownership scoring across ALL domains FIRST; the free-LLM leg (Groq→Gemini, message-only, digits
  masked) fires ONLY on a genuine multi-domain contest; ambiguous → **ASK**.
- Kill switch `M8_REGISTRY_ROUTER` (default OFF ⇒ byte-for-byte pre-155 behaviour). The broadened
  path is dormant until flagged on.
- Wire through the EXISTING `resolveDomainRoute()` seam so `orchestrate()` + `orchestrateStream()`
  stay in lockstep (do NOT fork the two paths).
- Test: `tests/build155_registry.test.ps1` mirrors the deterministic scoring + dispatch against
  `tests/routing_corpus.jsonl`. The LLM leg is stubbed in the mirror.

**B-156 — Flip the LOOKUP boundary** (`memory ⇄ web ⇄ knowledge/docs ⇄ chat`) — lowest risk first.
Kill-switched. Corpus + no-regression + live phone test green before B-157.

**B-157 — Flip CRUD** (`tasks ⇄ notes ⇄ wallet ⇄ fleet`) **+ the code cleaning**: now that the
registry router owns the decision, **remove the redundant scattered `!looksFleet` per-lane guards**.
Kill-switched. This is where "cleaning" lands — it MUST be sequential (same file), not parallel.

**B-158 — Add the `docs` route** (consumes Stream 2's ingested RAG content) + the finance/fleet edge.
Kill-switched.

## Hard constraints (never violate)
- **Privacy wall ABSOLUTE:** money/financial DATA never enters any LLM prompt or log. The classifier
  sees the message with digits masked to `#` only; ALL math stays deterministic.
- **Free-LLM default** (premium OFF). Classifier call only on contest/miss — keep the fast-path free.
- **Vercel 12-function cap is FULL** — NEVER add `api/*.js`; reuse `api/ops?fn=`.
- **Confirm-before-write** — the model proposes a route; gated deterministic code disposes.
- **Node is ABSENT on the host** — every build ships a **PS-5.1 mirror** + a live phone test.
- **Never regress the ~170 working paths** — the deterministic fast-path must win BEFORE the
  classifier ever runs; default-OFF until the corpus proves a boundary.

## STEP 0 — create your ISOLATED worktree FIRST (mandatory; do not skip)
Parallel sessions in the SAME folder share one git HEAD and **clobber each other** (a
committed file vanishes when another session switches branch). So each session runs in its
OWN `git worktree`. From the `M8` repo, before anything else:
```bash
git fetch origin
git worktree add -b feat/router-registry ../../M8-router origin/main
```
Then `cd ../../M8-router` and do ALL your work there. Verify with `git rev-parse --abbrev-ref HEAD`
(must say `feat/router-registry`) and `git worktree list`. If the worktree already exists, just
`cd` into it. NEVER work in the shared `Bolt/M8` checkout alongside another live session.

## Parallel-session rules (your doctrine)
1. You are in your OWN worktree (Step 0). `git fetch` and **check `origin/main` FIRST**.
2. You are already on `feat/router-registry` (created in Step 0) off `origin/main`.
3. `git add` **your OWN files only** — NEVER `git add -A`.
4. Finish each build by writing `reports/build-15X-done.json`
   (`{build, status, files, tests:{pass,fail}, kill_switch, rollback, notes}`) → commit → **push the
   branch** (not `main`). Open a PR or wait for Muhammad's merge OK.
5. If you need something another stream owns, STOP and flag it — do not reach across.
