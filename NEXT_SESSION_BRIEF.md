# M8 — Next Session Brief
**Written:** 2026-06-15 (Session-32, Opus) · **Branch:** main · **Head:** `1b545e0`
**Canonical plan:** [`M8/HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md) ← the living backlog. Read it first.

---

## Where we are (all shipped + pushed this session)

| Commit | What |
|---|---|
| `847f0b9` | **Build-35 source-trust hardening** — web results ranked/tagged by code-assessed credibility + recency; hedge directive on single-weak / prediction / stale sources. Live `battery-realworld` held **10/10**. |
| `1dd5fb3` | **L5 attest wrapper fixed** — `run-battery.ps1` `-File`/`-SessionPrefix` take a comma-list; `nightly-attest.ps1` runs both L5 corpora → one combined attestation, `run_date=UtcNow`. (The old stub would have crashed / false-cleaned.) |
| `89a7a23` | **2 L5 graders hardened** — `scaffold_not_proof` (negation-aware) + `self_citation_loop` (broadened); both were false-failing honest replies. |
| `7229f09` | **`no_false_promotion` disambiguated** — flaky on "promoted to the notebook"; sharpened to target the gate. 3/3 live deterministic. |
| `4d686a3` / `1b545e0` | **HONESTY_TRACK_PLAN.md** — the visible living backlog + the 3-run evidence for Option 2. |

Also verified this session: BUILD34 vision scenarios #5 (by construction) + #6 (live pass); vision is reliable on normal images but flakes silently on near-blank ones (backlog item).

---

## The headline finding → what's next

**The L5 promotion gate is structurally blocked by probe noise, not by M8 dishonesty.**
Across 3 full combined attestation runs, a *different* probe flaked each time; after fixing the
real grader/wording bugs, the last flake (`survivor_recall`) was M8 asking for a seed instead of
running the generator — **not a fabrication**. With ~14 non-deterministic probes, ~1 flakes per run
by chance, so the all-or-nothing single-run gate will essentially never pass.

### → NEXT TASK = Option 2: relax the L5 gate (integrity-sensitive)
Absorb probe noise **without weakening the no-fabrication bar**. Three candidate approaches —
**decide the approach with Muhammad first (recommendation required), then code:**
1. **Best-of-N** — re-run a failing probe up to N times; pass if it's clean on any (flakes are noise, a real fabrication repeats).
2. **Per-probe flake allowance** — allow ≤K non-critical probes to miss on a given night, but NEVER a fabrication-class (absent) check.
3. **Fail-K-of-M-nights** — a probe only blocks promotion if it fails on K of the last M nights (sustained, not one-off).
Files: `lib/loop.js evaluatePromotionGate`, `tests/odysseus/run-battery.ps1` attest block, `BUILD_19_SPEC.md` §gate.
Must keep: any `absent`/anti-fabrication failure is an instant hard block (never absorbed).

### Then (lighter backlog, in HONESTY_TRACK_PLAN.md)
- Broaden search routing (`lib/intentClassifier.js`) — checkable questions slipping past grounding.
- Guard the silent vision miss (`lib/orchestrator.js`) — model-authored "I can't see images" on an image turn → honest fallback, not a later confabulation.
- Add a source-trust over-read probe to `battery-realworld.json`.

---

## Heads-up for tonight (no action needed)
- The L5 cron + `M8-L5-Nightly-Attest` task fire ~01:00–05:00 AST. **Tonight's attestation will post FAIL
  (gate stays 0/3) — this is EXPECTED and correct (fail-safe), the single-run gate brittleness, NOT a
  regression.** It'll keep failing nightly until Option 2 lands. (Also: the task is Interactive-logon →
  only runs if you're logged in; and verify `$env:CRON_SECRET` actually reaches it once a clean
  attestation is achievable.)

## How to run the live battery (deliberate — costs Gemini quota)
```powershell
# combined L5 attestation, dry-run (POST suppressed):
$s=$env:CRON_SECRET; $env:CRON_SECRET=''
try { & .\tests\odysseus\run-battery.ps1 -File "battery-l5.json,battery-m3-armed.json" -SessionPrefix "l5,m3armed" -AttestTo "<YYYY-MM-DD>" } finally { $env:CRON_SECRET=$s }
# realworld honesty battery:
.\tests\odysseus\run-battery.ps1 -File battery-realworld.json
```

---

## Kickoff prompt to paste into the next session
> Continue M8. Read `M8/HONESTY_TRACK_PLAN.md` and `M8/NEXT_SESSION_BRIEF.md` first. Start on **Option 2 — relaxing the L5 promotion gate so probe non-determinism stops blocking it, WITHOUT weakening the no-fabrication bar.** Don't write code yet: first give me the three approaches (best-of-N / per-probe flake allowance / fail-K-of-M-nights) with your recommendation and the integrity guardrail (any `absent`/anti-fabrication miss is always an instant hard block), then I'll pick. After that, implement, update `BUILD_19_SPEC.md` §gate + `loop-verify.ps1`, and dry-run the combined attestation to confirm. Keep the free Gemini/Tavily stack; no paid APIs. Update `M8/HONESTY_TRACK_PLAN.md` as you go.
