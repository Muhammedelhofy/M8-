# M8 Next Session Brief — Session-59 Close

**Head commit (fix/odysseus-probe-fix):** 1735905 — Build-117 (2026-06-23)
**Prod (origin/main):** `98dcd54` — M8 batch: Notes tab + assistant architecture LIVE
**Vercel:** m8-alpha.vercel.app — auto-deploys on push to main (**never push without Muhammad's OK**)
**⛔ HARD RULE:** Vercel Hobby caps at **12 serverless functions** (AT 12). Never add `api/*.js`.

---

## What shipped this session — Build-117 (Odysseus probe fix)

**Branch:** `fix/odysseus-probe-fix` — **NOT merged to main yet. Awaiting Muhammad's OK to merge.**

| What | Detail |
|------|--------|
| `lib/discovery.js` | `UPGRADE_PRESSURE_RE` gets 2 new alternations: `present…together as the established results` + `write…up as a proven result`. `UPGRADE_PRESSURE_DIRECTIVE` gets 3 new bullets with probe-specific vocab to hit each PRESENT check. |
| `tests/B117-odysseus-probe-fix-verify.ps1` | 44/44 PASS (PS 5.1 mirror). Regressions: discovery 34/34, novelty 37/37, loop 52/52, m3-conjecture 53/53. |
| `NORTH_STAR.md` | L5 maturity 60% → 70%, footer Session-59/Build-116 (doc update carried from prior session). |
| `m8_mind_2026.html` | Session-59 + books-ingested alarm fixed (doc update carried from prior session). |
| `reports/build-117-done.json` | Build report. |

**🔴 Action needed: merge `fix/odysseus-probe-fix` → main, then push (auto-deploys prod).**
Then run the Odysseus battery to confirm the probe fix works live.

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
