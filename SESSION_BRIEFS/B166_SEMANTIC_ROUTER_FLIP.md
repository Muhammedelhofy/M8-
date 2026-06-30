# Session — B-166 · SEMANTIC ROUTER (FLIP it on as a TIE-BREAKER)
**Model: Opus · Effort: MAX** (routing core — a wrong threshold re-introduces the whack-a-mole)
**Branch:** `feat/b166-semantic-flip` off `origin/main`
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**
**Run this ~a day after B-164/B-165 merged (2026-06-29) so the shadow has logged real turns.**

## STEP 0 — isolated worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/b166-semantic-flip ../../M8-b166 origin/main
```
`cd ../../M8-b166`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout. Check `origin/main` first — if a semantic FLIP already exists, STOP and reconcile.

## WHERE WE ARE (context — all DONE + LIVE on prod)
- **B-164 (shadow) MERGED + LIVE-VERIFIED** (`b6b37a1`): `lib/semantic-router.js` embeds each turn + cosine-compares to per-domain `EXEMPLARS`, and `resolveDomainRoute` SHADOW-LOGS what meaning WOULD pick (lane `arbiter:sem:*`) behind `M8_SEMANTIC_ROUTER=1` (ON in prod), changing NO routing. Proven on his real turn: "tell me about my kafala operation" → `arbiter:sem:knowledge conf=0.94 margin=0.28`, while the live keyword router sent it to `memory` → a generic web answer.
- **B-165 (wallet) MERGED + LIVE-VERIFIED** (`ec317ca`): from-X-till-Y date range + breakdown reconcile. (Unrelated to routing; just the prod HEAD you branch from.)

## THE GOAL (one line)
Let the semantic router **ACT** as a tie-breaker: on the turns where the deterministic router is UNSURE, adopt the semantic pick — but ONLY when it's confident, and ONLY into SAFE lanes. Behind a NEW flag `M8_SEMANTIC_FLIP=1` (default OFF). The headline win = "tell me about my kafala operation" (and doc-topic questions like it) finally route to KNOWLEDGE (his ingested docs), not a generic answer.

## STEP 1 — SET THE THRESHOLD FROM REAL DATA (do this FIRST, before coding)
Pull the shadow dataset (BOLT Supabase `ltqpoupferwituusxwal`):
```sql
select created_at, message_redacted, lane, reason
from m8_router_misses
where lane like 'arbiter:sem:%' order by created_at desc;
```
For each turn, compare the `arbiter:sem:<domain>` pick (+ its `conf`/`margin` in `reason`) to the SAME turn's REAL lane (`arbiter:wallet|fleet|ask`, `lk:*`, `reg:*`). Build two piles:
- **TRUE FIXES** — sem disagreed and sem was RIGHT (e.g. kafala → knowledge). These are what the flip should capture.
- **FALSE POSITIVES** — sem disagreed but the keyword router was RIGHT. These set the SAFETY FLOOR: pick a `conf` threshold `T` and `margin` threshold `M` that capture the true fixes but EXCLUDE every false positive. If the data is thin, START STRICT (high T/M) — a missed fix is fine, a wrong override is not.

## BUILD (conservative, safe-lanes-only)
In `resolveDomainRoute` (lib/orchestrator.js), behind `M8_SEMANTIC_FLIP === "1"`:
- Reuse the B-164 `scoreSemantic` result you already compute for the shadow (don't embed twice).
- ADOPT `sem.domain` ONLY when ALL hold: (a) the deterministic registry pick is UNSURE (ambiguous OR chat OR present-only/conf<0.9 — the same cost-guard gate B-164 already uses); (b) `sem.confidence >= T` AND `sem.margin >= M` (from STEP 1); (c) `sem.domain` is a **SAFE read-only lane** — START with `{knowledge, web, memory}` ONLY, reusing the EXISTING B-156 `lookup` soft-attach mechanism (`return { ..., lookup: { domain, ... } }`). 
- **NEVER let semantics override the wallet⇄fleet money-safety boundary** — that stays on the B-152 arbiter (privacy wall + money safety). The flip does not touch `arb`. So a confident `sem:wallet`/`sem:fleet` is logged but NOT acted on in B-166 (money lanes are a later, separate decision).
- Fail-safe: any error → pre-flip behaviour. Flag OFF ⇒ byte-for-byte B-164.

## HARD RULES
- Free embeddings only (reuse `embedText`); privacy wall ABSOLUTE; money-safety lanes stay on the arbiter; Vercel 12-fn cap FULL (no new `api/*.js`).
- **DEPLOY + SELF-VERIFY loop (do NOT hand him a test):** get his explicit deploy OK → merge to main → confirm READY (Vercel) → POST the queries to the OPEN prod endpoint `https://m8-alpha.vercel.app/api/chat` ({message, history:[]}) and PASTE him the real `{response}`. See [[feedback-deploy-and-self-verify]].

## TEST
- PS-5.1 mirror `tests/build166_semantic_flip.test.ps1`: the gate logic (adopt only when det-unsure AND conf>=T AND margin>=M AND domain∈{knowledge,web,memory}); flag OFF = no-op; money lanes never overridden.
- Regression: build152/155/156/157/160/163/164/165 ALL green (proves no money mis-route + no behaviour change with flag OFF).
- LIVE (prod, flag ON, verified BY ME via /api/chat): "tell me about my kafala operation" → now serves his INGESTED docs (cited), NOT a generic answer; AND a sweep of wallet/fleet/working turns return UNCHANGED.

## FINISH
Write `reports/build-166-done.json` (threshold chosen + the data it came from · what flipped · regression · the prod /api/chat verification output) → commit → push branch → get deploy OK → merge → SELF-VERIFY on prod → paste him the kafala before/after.
