# M8 Next Session Brief — Session-59 Close

**Prod (origin/main):** `2fa18c6` — Build-135 wallet "latest/recent expense" read (DEPLOYED, awaiting his live confirm)
**Vercel:** m8-alpha.vercel.app — auto-deploys on push to main (**never push without Muhammad's OK**)
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions** (AT 12). Never add `api/*.js`.

## Build-135 — wallet recent-expense read (just shipped)
M8 can now answer "what's my last expense?" incl. app-logged ones (prev. it only knew its OWN
writes + monthly totals → hit a hard decline). `getRecentExpenses()` in `lib/wallet.js` (read-only,
no `note` column — privacy wall intact, uses existing m8_wallet SELECT grant, no DB change).
Routing: `parseRecentQuery` in `lib/orchestrator.js` + `last_expense` intent kind in `lib/intent-router.js`.
Offline 15/15 (`tests/build135-wallet-recent-test.ps1`). 🔴 PENDING: his live confirm — see
`tests/BUILD135_LIVE_TEST.md` (8 chat questions). Rollback = Vercel→`bb0bac7`.

---

## What shipped this session — DEPLOYED + verified

**Build-117 (Odysseus probe fix)** — `08a83ff`/`1735905`. Fixed the 3 failing honesty probes
in `lib/discovery.js` (`UPGRADE_PRESSURE_RE` + directive). Both batteries ran **CLEAN live
2026-06-23**: armed 8/8, L5 6/6, attestation #20 PASS → **L5 promotion streak night 1/3**.
B117 44/44 + regressions green.

**Build-118 (live web-search waterfall)** — `8016c25`. M8 stops fabricating live data
(was inventing fake scores + fake citations). 3 files: `lib/tools/serperSearch.js` (NEW,
Serper/Google wrapper) + `lib/search.js` (Serper→Tavily waterfall, ~3500/mo free) +
`lib/intentClassifier.js` (bare "score"/"who won"/Arabic now search). B118 32/32 + routing
regressions green. **Live-verified working on his phone.** Rollback = Vercel→`08a83ff` or unset `SERPER_API_KEY`.

## 🔴 Only pending item: L5 promotion streak (automatic)

The Odysseus battery is now CLEAN. The nightly cron (~1am) counts clean nights automatically.
**Night 1/3 done (attestation #20).** After 2 more clean nightly runs → `consecutive_clean=3`
→ `promoted=true` → **L5 complete**. Nothing for Muhammad to do — just watch `m8_loop_runs`.
(If a future night regresses, re-run the battery manually: `tests/odysseus/run-battery.ps1
-File battery-m3-armed.json -SessionPrefix live_test` + `-File battery-l5.json -AttestTo <date> -Secret $env:CRON_SECRET`.)

---

## What is ALREADY live on prod (B110–B116)

| Build | What | Status |
|-------|------|--------|
| B110 | Brain tables fix (m8_graph_nodes, m8_loop_runs, etc.) | ✅ LIVE |
| B111 | Durable conjecture-outcome reconciliation | ✅ LIVE |
| B112 | Learn→generate narration (PREFER/EVIDENCE in systemInstruction) | ✅ LIVE |
| B113 | Outcome-aware generation (Lean down-weights, gen_version=3) | ✅ LIVE |
| B114 | Survivor evidence narration (free; 5 templates earn) | ✅ LIVE |
| B115 | "what has the engine learned" read-only chat command | ✅ LIVE |
| B116 | Survivor signal STEERS generation (gen_version=4, 5 over-mined down-weighted) | ✅ LIVE (verified 2026-06-23) |
| M3.1 | Clustering + human review queue | ✅ LIVE |
| Family Wallet bridge | Read + add-expense + edit-expense (privacy wall holds) | ✅ LIVE |
| Sci-fi PWA + voice | MediaRecorder→Groq Whisper, installable | ✅ LIVE |
| Web Push (Android) | 7am KSA daily cron, VAPID live, notification delivered | ✅ LIVE |

**Live telemetry (2026-06-23 nightly run):** `gen_version=4`, `survivor_steered=true`, 5 templates down-weighted.

---

## L5 promotion gate — what's blocking

| Gate condition | Status |
|----------------|--------|
| `run_status=ok` | ✅ nightly cron runs |
| `m3_gate_pass=true` | ✅ Wilson-Newcombe gate passes |
| `survivors_persisted >= 1` | ✅ survivors persist |
| `odysseus_pass=true` | 🔴 **FAILING** — battery has 3 failing probes (fixed in B117, pending deploy) |
| `consecutive_clean >= 3` | 🔴 0 — blocked by above |

**After B117 deploys, re-run the battery** (`tests/odysseus/battery-m3-armed.json` + `tests/odysseus/battery-l5.json`) via the `run-odysseus-battery.ps1` script (or equivalent). If both batteries pass, the nightly cron will start advancing `consecutive_clean`.

---

## What to do next (prioritized)

| Priority | Action |
|----------|--------|
| 🔴 1 | Merge `fix/odysseus-probe-fix` → main → push (auto-deploys) |
| 🔴 2 | Run Odysseus battery — verify all probes pass live |
| 🟢 3 | Watch the next nightly cron row in `m8_loop_runs` for `odysseus_pass=true`, `consecutive_clean=1` |
| ⚪ 4 | Once `consecutive_clean >= 3`: L5 gate passes → begin L6 planning |

---

## Key constraints (never forget)

- **Fable 5 BLOCKED** (US gov) — use Opus for autonomous high-effort sessions
- **Vercel 12-function cap** — NEVER add `api/*.js`; fold new endpoints into `api/ops.js` via `?fn=`
- **Never git add -A** — add files by name only
- **PS 5.1 host** — no Node; all tests are PS mirrors; use `[IO.File]::ReadAllText` for UTF-8
- **Use PowerShell `.Replace()`** for `m8_mind_2026.html` edits (em-dash U+2014 breaks Edit tool)
- **Financial text NEVER enters LLM** — privacy wall in place (`MONEY_SENTINEL` strip)
- **Pushing main auto-deploys prod** — always await explicit "merge/deploy" OK

---

## Canonical docs (update on every ship)

- `NORTH_STAR.md` — maturity ladder + vision (update % and Session/Build footer)
- `m8_mind_2026.html` — the "M8 Mind" diagram (update status cells and footer comment only)
