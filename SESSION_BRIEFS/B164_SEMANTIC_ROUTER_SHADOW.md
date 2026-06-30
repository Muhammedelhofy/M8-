# Session — B-164 · SEMANTIC ROUTER (shadow only — ZERO behavior change)
**Model: Opus · Effort: MAX** (routing core — get the foundation right)
**Branch:** `feat/b164-semantic-router-shadow` off `origin/main`
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**

## STEP 0 — isolated worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/b164-semantic-router-shadow ../../M8-b164 origin/main
```
`cd ../../M8-b164`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.
Check `origin/main` first — if a semantic-router already exists, STOP and reconcile.

## THE GOAL (one line)
Make M8 understand a turn by **meaning, not keywords** — but in this build, **only MEASURE it**: build a free embedding-based domain scorer and SHADOW-LOG what it *would* pick, alongside the real route. **No routing decision changes.** (Same safe pattern as B-155's `reg:*` shadow.)

## WHY
The deterministic registry/arbiter (`capability-registry.js` + `domain-arbiter.js`) is still pattern-matching — novel phrasings ("tell me about my kafala operation") mis-route. A semantic tie-breaker is the real "understand what I mean" leap (free — M8 already embeds for the knowledge graph). This build proves it would help BEFORE we let it act (B-165).

## BUILD
1. **NEW `lib/semantic-router.js`:**
   - `EXEMPLARS` — a curated map: domain → 6–10 example phrasings, covering the live domains in `capability-registry.js` `DOMAINS` (driver_profile, knowledge, docs, notes, tasks, wallet, finance, fleet, memory, web, chat). Seed `knowledge` with the known misses ("tell me about my kafala operation", "what does my CV say about X", "search my books for Y"); seed fleet/wallet/finance from the real detectors. Keep it small + readable.
   - `embedExemplars()` — embed each exemplar ONCE via the existing `embedText(text, "RETRIEVAL_DOCUMENT")` (the same free `gemini-embedding-001` `searchKnowledgeGraph` uses); cache in-module (warm instance). Lazy + idempotent.
   - `scoreSemantic(message)` — `embedText(message, "RETRIEVAL_QUERY")`, cosine-compare to exemplars, return `{ domain, confidence /*top cosine*/, runnerUp, margin /*top − runnerUp*/ }`. **Fail-safe: any error → null** (never throws).
2. **Shadow wire** (behind `M8_SEMANTIC_ROUTER === "1"`, default OFF): in `resolveDomainRoute` (orchestrator) call `scoreSemantic` and `logRoute(baseMessage, "sem:" + domain, "semantic conf=" + confidence.toFixed(2) + " margin=" + margin.toFixed(2), confidence)` — **LOG ONLY, never read the result into any decision.** Cost guard: only embed when the deterministic pick is **ambiguous OR chat/low-confidence** (the turns that matter) — never on a clear deterministic win.

## HARD RULES
- **ZERO behavior change.** Flag OFF ⇒ byte-for-byte pre-164. Flag ON ⇒ only an extra log row. Do NOT touch `capability-registry.js` scoring or any routing decision.
- Free-LLM only (reuse `embedText`); privacy wall absolute (message text only, never wallet money into a prompt); Vercel **12-fn cap FULL** (no new `api/*.js`); confirm-before-write; **no push to `main` without Muhammad's OK**.

## TEST
- **PS-5.1 mirror** `tests/build164_semantic_router.test.ps1`: cosine-similarity math; exemplar map well-formed (every DOMAINS entry covered; no empties); flag-OFF = no-op; fail-safe returns null. (Node ABSENT — static + logic mirror.)
- **Regression:** `build152_arbiter` / `build155_registry` / `build156_lookup` / `build157_walletfleet` / `build160_askmydocs` / `build163_routing` ALL still green (proves zero behavior change).
- **Live (preview, flag ON):** send the known-miss phrasings; confirm `m8_router_misses` gets `sem:*` rows AND the real answer/route is UNCHANGED. Pull the `sem:*` vs real-lane rows to see how often semantic would've fixed a miss — that's the evidence B-165 acts on.

## FINISH
Write `reports/build-164-done.json` (what shipped · flag name · how to read the shadow data · regression result) → commit → **push the BRANCH**. Tell Muhammad the shadow-data readout so he can OK B-165 (the flip).
