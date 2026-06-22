# Build-113 — FREE survivor-learning — LIVE TEST

**Branch:** `feat/survivor-learning` (off `origin/main a210222`). **NOT deployed** — Muhammad merges + deploys.

## What this build does (one line)
With the Lean checker parked, the Build-112 PREFER block (earns only from Lean-PROVEN
outcomes) is starved. Build-113 adds a **separate, free** learning lane: it aggregates the
M3 generator's existing **survivors** (machine-generated conjectures that survived
falsification to a bound N) by structural **template** and surfaces the comparatively
productive structures as a clearly-labeled **COMPUTATIONAL-EVIDENCE** PREFER hint.

## ⚠️ The honesty wall (the thing to check hardest)
A survivor is **EMPIRICAL evidence, never proven**. The block must read as
"computational evidence / tested to N", and must never call a survivor proven / established
/ true. Only a Lean machine-check mints "proven". The survivor reader reads
`m8_research_notes`, **never** the Lean outcomes table.

---

## Offline (already done this session)
- `tests/survivor-learning-verify.ps1` → **50/50 (8/8 core)**.
- Regressions green: B112 44/44, B92 40/40, B99 37/37, B83d 68/68.
- **Open question resolved against LIVE Supabase**: survivor records carry
  `metadata.m3_template` + `tested_to` + `m3_generated` — zero LLM, schema-free.

## Live data snapshot (BOLT project, verified this session)
Distinct surviving statements per template in `m8_research_notes`:

| template | distinct survivors | earns (≥3)? |
|---|---|---|
| A_peak_power | 17 | ✅ |
| B_cond_peak_nu | 14 | ✅ |
| A_cond_nu_peak | 14 | ✅ |
| B_res_total_gap | 14 | ✅ (also the only 2 graph-mirrored nodes) |
| A_res_sigma_max | 13 | ✅ |
| B_sigma_freq | 5 | ✅ but capped out (top-5 limit) |
| B_nu_geo | 1 | ❌ gated out |

→ Unlike Build-112 (earned_patterns:0, silent), this lane should be **NON-empty immediately**:
5 templates earn. **That is the win — the engine learns for free, today.**

---

## After Muhammad merges + deploys — live-verify steps

### 1. Trigger a nightly run
`POST https://<m8-host>/api/cron-explore` with `Authorization: Bearer $CRON_SECRET`
(or wait for the 01:00 UTC cron).

### 2. Check the telemetry (Supabase SQL editor, BOLT project)
```sql
select run_date,
       metadata->'learn'->>'survivor_templates'      as survivor_templates,
       metadata->'learn'->>'survivor_min_count'      as survivor_min_count,
       metadata->'learn'->'survivor_template_tags'   as survivor_tags,
       metadata->'learn'->>'earned_patterns'         as lean_earned   -- Build-112 (expect 0, Lean parked)
from m8_loop_runs
order by run_date desc limit 3;
```
**Expect (newest row):**
- `survivor_templates` ≈ **5** (was `null` on pre-deploy rows = clean before/after, like B112).
- `survivor_template_tags` lists the productive templates (e.g. `A_peak_power`, …).
- `survivor_min_count` = **3** (or your `M8_SURVIVOR_MIN_COUNT`).
- `earned_patterns` still **0** — proves the FREE lane is what lit up, NOT the Lean lane.

### 3. Confirm the packet shows the EVIDENCE block (chat path)
In live chat type: **"run the M3 conjecture generator on collatz up to 100000"**
The narrated context should now include a block headed:

> **COMPUTATIONAL EVIDENCE — structural templates whose machine-generated conjectures
> SURVIVED falsification to high bounds. This is EMPIRICAL evidence … NOT proof: survived ≠ proven …**
> • [A_peak_power] — 17 distinct survivors, tested to 100,000 (computational evidence, NOT proof)
> …

**PASS =** the block appears, is labeled evidence-not-proof, sits **separate from** the Lean
"VERIFIED CONJECTURE PATTERNS" block, and the model's reply never calls a survivor proven/
established/true.

**FAIL =** any wording that presents a survivor as proven/true, or the survivor list merged
into the Lean-proven block.

### 4. Kill switch / tuning
- Stricter bar: set env `M8_SURVIVOR_MIN_COUNT` higher (e.g. `5`) → fewer templates earn.
- Full silence: set it absurdly high (e.g. `9999`) → block stays empty (no code change).
- The lane is additive + fail-safe: an empty/unreachable table → `[]` → packet byte-identical.
