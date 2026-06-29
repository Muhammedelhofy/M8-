# Parallel Session — B-159 · FINISH THE ALL-DOMAIN FLIP + currency backlog
**Model: Opus · Effort: MAX** (central file; completes the routing rebuild)
**Branch:** `feat/b159-finish-crud` off `origin/main`
**Router build → sequential. Confirm no other orchestrator.js session is live first.**

## STEP 0 — create your ISOLATED worktree FIRST (mandatory)
```bash
git fetch origin
git worktree add -b feat/b159-finish-crud ../../M8-b159 origin/main
```
`cd ../../M8-b159`; verify `git rev-parse --abbrev-ref HEAD`. Never work in the shared `Bolt/M8` checkout.

## Where we are (cold-start)
The registry routing rebuild is ~90% done and LIVE: B-155 (registry + `classifyAll`, shadow), B-156
(lookup flip ON via `M8_REGISTRY_LOOKUP`), B-157 (wallet/fleet/finance **execution gate** live + a V2
registry flip dormant behind `M8_REGISTRY_CRUD`), B-158a (per-driver fleet range), B-158b (CV/notes
embeddings). Read `lib/capability-registry.js`, `domain-arbiter.classifyAll()`, and in
`lib/orchestrator.js`: `resolveDomainRoute()` (the B-157 CRUD-flip seam) + `handleWalletCommand`'s
central gate. The deterministic-only classifier has NO LLM tie-breaker for non-wallet/fleet contests yet.

## JOB 1 — flip the LAST domains onto the registry: tasks / notes / driver_profile
These are the only CRUD lanes still keyword-only. Extend the `resolveDomainRoute` CRUD flip (the
`M8_REGISTRY_CRUD` path B-157 built) so a CLEAR registry winner in {tasks, notes, driver_profile}
routes via `classifyAll`, behind the SAME kill switch (`M8_REGISTRY_CRUD`, default OFF = unchanged).
Ambiguous/contest → fall through to the existing keyword lane (no turn stolen). The deterministic
keyword parsers still run FIRST; this only rescues missed/novel phrasings.

## JOB 2 — currency-filtered breakdown (the one real handler backlog item, NOT routing)
"what's the breakdown on 921 sar" currently returns a mix that includes EGP. A "breakdown on <N> <cur>"
must filter to THAT currency only. Fix the currency scoping in the wallet breakdown path
(`handleWalletCommand` / `renderConvertedBreakdown` in orchestrator.js, or `getCategoryBreakdown` in
`lib/wallet.js`). Privacy wall unaffected (rate/format only; no figure leaves M8).

## Owns / Do NOT touch
- OWN: `lib/orchestrator.js`, `lib/domain-arbiter.js`, `lib/capability-registry.js`, `lib/wallet.js`,
  `tests/build159_*`.
- If you add a registry signal for tasks/notes/driver_profile, put it in `capability-registry.js`
  (the single source of truth) — they already exist there; refine, don't duplicate.

## Constraints + test
- Privacy wall ABSOLUTE; free-LLM default; Vercel **12-fn cap FULL** (no new `api/*.js`); confirm-before-write.
- Node ABSENT → `tests/build159_*.test.ps1` PS-5.1 mirror over the corpus: assert tasks/notes/
  driver_profile rows route correctly with `M8_REGISTRY_CRUD=1`, the currency-filter case is SAR-only,
  AND zero money mis-routes + no regression (re-run build152/155/156/157 mirrors green).
- Live phone test. Kill-switched (`M8_REGISTRY_CRUD`). **No push to `main` without Muhammad's OK.**
- Finish: `reports/build-159-done.json` → commit → push the BRANCH.
