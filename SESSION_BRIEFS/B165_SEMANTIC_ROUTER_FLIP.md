# Session — B-165 · SEMANTIC ROUTER (flip it on as a TIE-BREAKER)
**Model: Opus · Effort: MAX** (flips behavior on the riskiest core — full care + regression)
**Branch:** `feat/b165-semantic-router-flip` off `origin/main`
**This file IS your kickoff prompt — self-contained. Read the files it names before editing.**

## ⚠️ PREREQUISITE — run AFTER B-164 is MERGED
B-165 consumes `lib/semantic-router.js` (built in B-164) and edits the same arbiter. **Do NOT run in parallel with B-164.** First confirm B-164 is on `origin/main`:
```bash
git fetch origin
git -C . cat-file -e origin/main:lib/semantic-router.js && echo "B-164 present" || echo "STOP — merge B-164 first"
```
If present, also check the B-164 shadow data justifies the flip (Muhammad's call): `m8_router_misses` should show `sem:*` picking the RIGHT lane on turns the deterministic router got wrong. If the shadow data is weak, STOP and report — don't flip a tie-breaker that doesn't help.

## STEP 0 — isolated worktree FIRST (mandatory)
```bash
git worktree add -b feat/b165-semantic-router-flip ../../M8-b165 origin/main
```
`cd ../../M8-b165`; verify HEAD. Never work in the shared `Bolt/M8` checkout.

## THE GOAL (one line)
When the deterministic router is **UNSURE**, let MEANING decide — so novel phrasings ("tell me about my kafala operation") reach the right lane — **without ever overriding a clear decision or the money-safety gate.**

## BUILD (in `domain-arbiter.js` `classifyAll`, behind `M8_SEMANTIC_ROUTER_ACT === "1"`, default OFF)
Consume `scoreSemantic` from `lib/semantic-router.js` ONLY in the gaps:
- Fire **only when** the deterministic pick is **ambiguous** (`pick.ambiguous`) OR **chat** (no signal) — i.e. exactly where today's router shrugs.
- Use the semantic domain **only if it is confident**: `confidence >= SEM_THRESHOLD` (start 0.78, env-tunable) AND `margin >= SEM_MARGIN` (start 0.06) over the runner-up. Otherwise leave the deterministic result untouched.
- Return `{ domain, confidence, ambiguous:false, why:"semantic" }` when it fires; log it (`sem:act:<domain>`).
- **NEVER override, under any flag:** a CLEAR deterministic winner · the wallet⇄fleet money-safety contest (the `contest_wallet_*` / `ask` branch) · `doc_read_dominant` (B-163). Those run FIRST and win. The semantic leg only fills `ambiguous`/`chat`.

## HARD RULES
- Flag OFF ⇒ byte-for-byte pre-165. Money-safety is sacred — a wallet/fleet question can NEVER be re-routed by meaning.
- Free-LLM only · privacy wall absolute · 12-fn cap FULL (no new `api/*.js`) · confirm-before-write · **no push to `main` without Muhammad's OK**.

## TEST
- **PS-5.1 mirror** `tests/build165_semantic_flip.test.ps1`: the tie-break decision — fires ONLY when (det-ambiguous OR det-chat) AND (conf≥threshold AND margin≥margin); does NOT fire on a clear det win; NEVER fires over money-safety / doc_read_dominant; flag-OFF = no-op.
- **Regression (MUST be green):** `build152_arbiter` · `build155_registry` · `build156_lookup` · `build157_walletfleet` · `build160_askmydocs` · `build163_routing`. Zero money mis-routes, zero clean-lane mis-routes.
- **Live (preview → Muhammad's OK → prod):** with the flag on — "tell me about my kafala operation" now reaches knowledge/docs; a couple more novel phrasings route right; AND re-confirm fleet ("my fleet net today"), wallet ("my last expense"), and "what does my CV say about my earnings" are all UNCHANGED. This is the risky one — verify on the branch preview, show Muhammad the before/after, get explicit OK before merging to main.

## FINISH
Write `reports/build-165-done.json` (decision rule · thresholds + kill-switch · regression result · live before/after) → commit → **push the BRANCH**. Do NOT merge to main without Muhammad's explicit deploy OK.
