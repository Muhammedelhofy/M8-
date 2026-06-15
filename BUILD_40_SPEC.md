# BUILD_40 SPEC — Search routing: self-referential status guard

**Status:** SPEC → implementing this session
**Session:** Session-35 / 2026-06-15 (Opus)
**Origin:** Backlog #3 "broaden search routing" (Team Round 5). The canonical failure
the brief names: **"what's your most recent build?" → Windows-update web search.**

## 1. Root cause (traced, not guessed)

`lib/intentClassifier.js` is first-match-wins. "what's your most recent build?" lowercases,
clears `isPersonal`/DOC/FACT_CHECK, then hits `newsPatterns`'s `\b(...|recent|...)\b` →
returns **NEWS**. In `lib/orchestrator.js` a non-NONE intent runs the SLOT-2 search path
(`intent !== INTENT.NONE` at ~1067), so M8 web-searches "most recent build" and surfaces
Windows updates. `BUILD_QUERY` (orchestrator ~501) — which suppresses the search fallback
and injects build-state context — does **not** match "most recent / latest / which build",
so it never engages for this phrasing.

So the misroute needs a **two-part** fix, because the two guards sit on different paths:
- the intent classifier must NOT tag a self-status question as a search intent
  (kills the `intent !== NONE` SLOT-2 search path), AND
- `BUILD_QUERY` must match it (kills the `intent === NONE` `decideAction` search fallback
  via its `!buildQuery` term, and injects the build-state context so the answer is grounded
  in M8's actual state).

## 2. Change (shared regex, no drift)

Export one `SELF_STATUS_RE` + `isSelfStatus()` from `lib/intentClassifier.js` and reuse it
in BOTH places (mirrors the probe-class.ps1 "shared predicate, can't drift" doctrine):

- **`classifyIntent`** — add, immediately after the `isPersonal` guard (before DOC):
  `if (isSelfStatus(m)) return INTENT.NONE;`
- **`lib/orchestrator.js`** — `const buildQuery = BUILD_QUERY.test(baseMessage) || isSelfStatus(baseMessage);`
  at both orchestrate sites (~609 and ~1752). Import `isSelfStatus` from the classifier.

`SELF_STATUS_RE` matches self-referential questions about M8 itself:
- `(most recent|latest|last|current|newest|which|what|your) (build|version)`
- `what build (are|is|was|am)` · `build number`
- `(your|you're|are you) … (version|capabilit|architecture|trained|knowledge cutoff|able to)`
- `what (can|do) you (do|support|handle)`
- `did (you|we) (build|ship|add|implement|finish)` — self-referential "did we ship X?"
  that today wrongly hits FACT_CHECK's `^did` → search.

It deliberately requires `build`/`version` (or an explicit `you`/`your` self-reference for
the capability words), so it does NOT steal NEWS/LOOKUP queries that merely contain
`recent`/`latest`/`update` about external entities ("latest keeta news", "recent updates
from bolt ksa") — those carry no build/version/self token.

## 3. Scope (v1 = the documented misroute only)

This build fixes the precise, high-confidence over-routing bug. The fuzzier other half of
"broaden search routing" — *under*-routing, where a checkable external fact falls to NONE
and is answered from training instead of grounded search — is left as a follow-up because
it needs a concrete corpus of mis-handled examples to tune against safely (widening search
has its own honesty cost: more low-quality web answers). Logged as backlog.

## 4. Tests

- **`tests/classifier-test.js`** — FIX the stale import (`../api/intentClassifier` →
  `../lib/intentClassifier`; `api/intentClassifier.js` does not exist, so the suite can't
  currently load) and ADD self-status cases (most-recent/latest/which build, what-version,
  what-can-you-do, did-we-ship-X) all expecting NONE, plus regression cases that must STAY
  NEWS/LOOKUP ("latest keeta news", "recent updates from bolt ksa").
- **`tests/intent-routing-verify.ps1`** — PS mirror of `SELF_STATUS_RE` + the key
  regression set (no local Node), runnable offline like the other Build-3x mirrors.

## 5. Live verify (after offline pass)

On `m8-alpha.vercel.app`: "what's your most recent build?" must answer from M8's build
state / memory (NOT a Windows-update or generic web result); a true external-news query
("latest keeta news") must still search. Confirm deploy SHA via `/api/health` `deploy.sha`
first (the Build-39 deploy-confirm tool).
