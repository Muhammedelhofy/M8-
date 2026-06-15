# M8 — Honesty / L5 Track: Living Plan

**Purpose:** the canonical, durable backlog for the honesty + L5-gate track. Findings,
discrepancies, and fixes-needed get logged here the moment they surface, so nothing is
lost and we don't rabbit-hole — a new mid-task issue becomes a *scoped item here*, not an
immediate detour. Update on every change. (Mirrors the auto-memory `[[m8-agent-v2]]`, but
this is the visible in-repo artifact.)

_Last updated: 2026-06-15 (Session-32, Opus)._

---

## ✅ Done (this session)

| Commit | What | Proof |
|---|---|---|
| `847f0b9` | **Build-35 source-trust hardening** — rank/tag web results by credibility+recency, hedge on single-weak / prediction / stale sources | `source-trust-verify.ps1` 30/30; live `battery-realworld` held **10/10** |
| `1dd5fb3` | **L5 attest wrapper fixed** — `run-battery.ps1` `-File`/`-SessionPrefix` take a comma-list; `nightly-attest.ps1` runs both L5 corpora → one combined attestation, `run_date=UtcNow` | offline-validated (14 probes, all 13 baseline IDs covered); live dry-run end-to-end |
| `89a7a23` | **Two L5 graders hardened** — `scaffold_not_proof` absent now negation-aware; `self_citation_loop` present broadened; baseline gained `self_citation_loop` | validated vs captured replies + pos/neg controls; live re-run m3_armed lane **5/5** |
| `7229f09` | **Option 1 — `no_false_promotion` disambiguated** — send sharpened to target the gate (not "the notebook"); present accepts recording-vs-promotion distinction; absent unchanged | offline controls + **3/3 live runs clean** (now deterministic) |

## 🔑 Key takeaways / discrepancies found

1. **Prompts don't hold; structure + measurement do.** (carried from S31) Source-trust is a *code-computed* verdict the LLM narrates — same doctrine as fleet/lean/chart.
2. **M8's live-fact answers are non-deterministic** — they depend on what search returns that second. A one-off manual test gives false confidence; the battery is the real signal.
3. **Vision is reliable on normal images (4/4) but flakes to a model-authored "I cannot see images" on near-blank/degenerate images** — and that silent miss is NOT caught by the throw-only `IMAGE_FALLBACK` guard. → backlog item.
4. **The L5 probe graders were the real promotion blocker, not M8.** Two probes false-failed textbook-honest replies (negation FP + over-narrow present). Fixed.
5. **The L5 gate is structurally brittle:** it needs *all ~14 probes clean on a single nightly run*, but several probes are non-deterministic and/or ambiguously worded → the gate will rarely pass even when M8 is fundamentally honest. → backlog item (Option 2).
6. **`no_false_promotion` probe is ambiguously worded** — "promoted to the notebook" reads as "recorded," which happens nightly, so M8 dodged the gate-status question without fabricating. → ACTIVE fix.

## 🛠️ Active

- _(none — Option 1 shipped `7229f09`, 3/3 live clean. Next up = Backlog #1, Option 2.)_

## 📋 Backlog (planned, not forgotten)

1. **Option 2 — relax the all-or-nothing single-run L5 gate** *(design decision, do after Option 1).*
   The gate fails if any one of ~14 non-deterministic probes flakes on a given night. Options:
   best-of-N runs, a small per-probe flake allowance, or require a probe to fail K-of-M nights
   before it blocks. MUST NOT weaken the no-fabrication bar — only absorb probe noise. This is
   an integrity-sensitive change → decide the approach deliberately before coding.
   *Files: `lib/loop.js` `evaluatePromotionGate`, `tests/odysseus/run-battery.ps1` attest block, `BUILD_19_SPEC.md` §gate.*
2. **Broaden search routing** *(was the original brief task #2).* The intent classifier is brittle
   regex; some checkable/live questions slip past it and never get grounded (this session,
   "what's your most recent build?" mis-routed to a *Windows-update* web search). Widen what
   routes to search so more facts hit grounding + the empty-search guard. *File: `lib/intentClassifier.js`.*
3. **Guard the silent vision miss** *(from finding #3).* When an image turn gets a model-authored
   "I cannot see images / please provide the image" despite an image being attached, detect it and
   return the honest `IMAGE_FALLBACK` instead of letting a later turn confabulate. *File: `lib/orchestrator.js` image path.*
4. **Add a source-trust over-read probe to `battery-realworld.json`** — a query whose only sources
   are prediction/preview pages; assert M8 hedges instead of stating a predicted outcome as fact.
   (Closes the loop on Build-35 — the battery currently can't see the hedge behavior.)

## 📌 Standing notes / gotchas

- `nightly-attest.ps1` task `M8-L5-Nightly-Attest`: NextRun 05:00 AST daily, **Interactive logon**
  (only runs if Muhammad is logged in). `$env:CRON_SECRET` was absent in the tool shell but the
  interactive task should inherit the User-level var — **verify the POST actually lands** once a
  clean attestation is achievable.
- PS gotcha: `ConvertTo-Json` unwraps a single-element array → image `attachments` must be force-
  wrapped to a JSON `[]`. `-Secret ''` doesn't pass through `powershell -File`; clear `$env:CRON_SECRET`
  for the child to suppress the attest POST during a dry-run.
- Live battery runs hit `m8-alpha.vercel.app` and cost Gemini quota — run deliberately, and they
  need explicit authorization (auto-mode classifier blocks unprompted production writes).
