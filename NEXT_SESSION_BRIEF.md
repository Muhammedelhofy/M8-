# M8 — Next Session Brief
**Written:** 2026-06-15 (Session-31, Opus) · **Branch:** main · **Head:** `62239fb`

---

## Where we are (shipped + pushed this session)

| Commit | What |
|---|---|
| `619fa18` | **Build-33b** — attach-file UI (📎 button + file picker + drag-drop, not just paste) + **empty-search honesty guard** (a live search returning 0 results no longer lets the model fabricate). |
| `bc185e1` | **Build-34** — image/vision attachments. Attach png/jpeg/webp/gif → M8 sees it (general vision + reads text off receipts/docs/screenshots). Forced onto a vision-capable model; honest refusal if none available (never a blind/invented answer). |
| `575e255` | **Honesty stress harness** — `tests/odysseus/battery-realworld.json` (10 probes) + `tests/HONESTY_HARNESS.md`. Measures real-world-fact confabulation. |
| `62239fb` | Harness grader fix (entity probes accept cited alternatives). **Baseline = 10/10 clean (5.0/5).** |

**Live-verified:** architecture-diagram read accurately · receipt total (350 SAR) + line items read correctly · the Brazil-Morocco question now grounds-and-cites or honestly declines instead of fabricating.

---

## The honesty picture (the important part)

- ✅ **Fabricate-from-nothing is fixed AND measured.** The exact bug ("Brazil 2-1 Morocco" invented from nothing) no longer happens, and we now have a re-runnable score.
- ⚠️ **The residual risk moved to SOURCE-TRUST.** M8's live-fact answers are non-deterministic (depend on what web search returns that second) and it relays whatever search hands it. If a source is a prediction/sim/junk, M8 passes it on confidently with a citation. The harness counts a cited answer as "grounded" — it can't judge source quality. **This is the next thing to harden.**
- 🔑 **Doctrine confirmed:** the system prompt already forbade the fabrication and the model did it anyway → prompts don't hold; only structure (guards) + measurement (the battery) do.

---

## Recommended next order

### 1. Source-trust hardening  ← START HERE
Make M8 skeptical of weak sources instead of relaying them.
- Weight/rank search results by recency + source credibility (prefer known outlets/official sites over fan/forum/prediction pages).
- When an answer rests on a **single weak source**, have M8 flag it ("one source, unconfirmed — treat as provisional").
- Distinguish a **result** page from a **schedule/prediction** page (the over-read risk) where feasible.
- **Prove it:** re-run `battery-realworld.json` before/after; the number is the evidence.
- Likely files: `lib/tools/searchTool.js` (return source metadata), `lib/orchestrator.js` (the search-results injection block ~line 1072 + the SEARCH_DIRECTIVES).

### 2. Broaden search routing
The intent classifier is brittle regex; some factual/live questions ("who won X") slip past it and never get grounded. Widen what routes to search so more checkable questions hit grounding + the empty-search guard. File: `lib/intentClassifier.js`.

### 3. Grow + run the honesty battery every build
Add probes as new failure modes appear (esp. over-read-snippet cases). Run `run-battery.ps1 -File battery-realworld.json` each build; treat a drop as a regression.

### Background / not blocking
- **L5 promotion gate:** nightly attest cron — first auto run was due ~05:00 AST 2026-06-15; check it ran clean (0/3 → counting toward 3 clean nights).
- **Build-34 remaining live checks:** `tests/BUILD34_LIVE_TEST.md` scenarios #5 (vision-unavailable refusal) and #6 (memory isolation) not yet run.

---

## How to run the honesty harness (the measurement loop)
```powershell
# full battery (live — hits the deployed app, uses Gemini quota)
powershell -File tests/odysseus/run-battery.ps1 -File battery-realworld.json
# structure-only (free)
powershell -File tests/odysseus/validate.ps1 -File tests/odysseus/battery-realworld.json
```
Results land in `tests/odysseus/results/`. Read a reply with PowerShell (no Python on this box):
`$d = gc <results>.json -Raw | ConvertFrom-Json; ($d.probes | ? {$_.id -eq '<id>'}).replies`

---

## Kickoff prompt to paste into the next session
> Continue M8. Read `M8/NEXT_SESSION_BRIEF.md`. Start on **#1 source-trust hardening**: rank/weight web-search results by recency + credibility, flag single-weak-source answers, and distinguish result pages from schedule/prediction pages. Write a short spec first, then implement, then re-run `tests/odysseus/battery-realworld.json` to prove the honesty score held/improved. Don't add paid APIs without asking; keep the free Gemini/Tavily stack.
