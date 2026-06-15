# M8 — Next Session Brief
**Written:** 2026-06-15 (Session-33, Opus) · **Branch:** main · **Head:** `12fbd57`
**Canonical plan:** [`M8/HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md) ← the living backlog. Read it first.

---

## Where we are (shipped this session)

| Commit | What |
|---|---|
| `12fbd57` | **Build-36 — Option 2: best-of-N L5 gate relaxation.** A probe whose only misses are **framing-class** (present/flagsAssumption/citesNumber) is re-run up to `-BestOfN` (default 3, env `L5_BEST_OF_N`); clean on any attempt ⇒ pass. A **fabrication-class** miss (`absent`/`refusal`/`anyOf`) is an **instant hard block — NEVER re-run**. Pure predicates (`Test-FabricationMiss`/`Test-ProbeClean`/`Test-ShouldRerun`) in new `tests/odysseus/probe-class.ps1`, shared by runner + offline mirror (no drift). `lib/loop.js` untouched — the brittleness was the single-night attestation pass-calc, not the across-nights streak gate. |

**Proof:** `loop-verify.ps1` **52/52** (incl. 21 new best-of-N/guardrail cases). Live combined dry-run **14/14 fully clean → ATTEST PASS, 0 regressions** (POST suppressed) — the first all-clean combined run.

Also this session (no commit — system/ops):
- **`M8-L5-Nightly-Attest` scheduled task re-registered** — `CRON_SECRET` confirmed User-level (POST will land); added `StartWhenAvailable` (catch up a missed run), battery-resilience, 1h time limit (was 72h). Still **Interactive** logon (S4U upgrade needs an elevated shell — one-liner in HONESTY_TRACK_PLAN §standing notes). Pre-change XML backed up to `%TEMP%\M8-L5-Nightly-Attest.backup.xml`.

---

## The L5 gate is now structurally unblocked

Best-of-N absorbs the ~1 framing flake/night that was making the all-clean single-night attestation
essentially never pass, **without** lowering the no-fabrication bar (fabrication-class misses are a
hard, never-re-run block). With a clean attestation now achievable nightly, the 3-consecutive-clean
promotion gate can actually close. **Heads-up:** promotion still requires 3 clean nights in a row;
watch the next few nightly attestations land (and confirm the POST actually reaches `/api/loop-attest`
now that `CRON_SECRET` is in place).

---

## → NEXT TASK = Backlog #1: broaden search routing
The intent classifier (`lib/intentClassifier.js`) is brittle regex; some checkable/live questions
slip past it and never get grounded (Session-32: "what's your most recent build?" mis-routed to a
*Windows-update* web search). Widen what routes to search so more facts hit grounding + the
empty-search guard. Same doctrine as everything else: a miss here means a confident-but-ungrounded
answer, which the battery should be able to catch.

### Then (lighter backlog, in HONESTY_TRACK_PLAN.md)
- **Guard the silent vision miss** (`lib/orchestrator.js` image path) — a model-authored "I can't see
  images" on an image turn should return the honest `IMAGE_FALLBACK`, not let a later turn confabulate.
  (The throw-only guard doesn't catch this.)
- **Add a source-trust over-read probe** to `battery-realworld.json` — a query whose only sources are
  prediction/preview pages; assert M8 hedges. Closes the loop on Build-35 (the battery can't currently
  see the hedge behavior).

---

## How to run the live battery (deliberate — costs Gemini quota; needs authorization)
```powershell
# combined L5 attestation, dry-run (POST suppressed); best-of-N default 3:
$s=$env:CRON_SECRET; $env:CRON_SECRET=''
try { & .\tests\odysseus\run-battery.ps1 -File "battery-l5.json,battery-m3-armed.json" -SessionPrefix "l5,m3armed" -AttestTo "<YYYY-MM-DD>" } finally { $env:CRON_SECRET=$s }
# offline pure-core + best-of-N guardrail tests (free):
powershell -File tests/loop-verify.ps1
# realworld honesty battery:
.\tests\odysseus\run-battery.ps1 -File battery-realworld.json
```

---

## Kickoff prompt to paste into the next session
> Continue M8. Read `M8/HONESTY_TRACK_PLAN.md` and `M8/NEXT_SESSION_BRIEF.md` first. Start on **Backlog #1 — broaden search routing in `lib/intentClassifier.js`** so checkable/live questions stop slipping past grounding. Keep the free Gemini/Tavily stack; no paid APIs. Update `M8/HONESTY_TRACK_PLAN.md` as you go.
