# Build-15 (S8) Live Test — Gate v2 · Micro-Prover · M2 Seed Pack · Novelty v1

*Type these into live chat (m8-alpha.vercel.app) after deploy. Offline already
green: `tests/m3-conjecture-verify.ps1` 53/53 · `tests/m2-novelty-verify.ps1`
26/26 (incl. the 10/10 NORTH_STAR M2 gate) · armed corpus validates 5/5.*

## 0. ONE-TIME SETUP (Muhammad, ~2 minutes — the only manual step)

1. Supabase SQL editor → paste + run `migrations/m2_external_source.sql`
   (idempotent ALTER; adds 'external' to the source CHECK).
2. Seed the pack (PowerShell):
   ```powershell
   Invoke-RestMethod -Method POST https://m8-alpha.vercel.app/api/seed-pack
   ```
   Expect `ok: true, seeded: 19, of: 19`. (Before the migration it answers 409
   `migration_required` with the fix named — that path is itself a test.)
   Status check anytime: `Invoke-RestMethod https://m8-alpha.vercel.app/api/seed-pack`
   → `external_nodes_live: 19`.

## A. Generator v2 run (gate v2 + micro-prover narration)

**Type:** `run the conjecture generator on collatz up to 100000`

- [ ] Reply states candidate counts: ~120 mined, micro-proved bucket > 0
      (B_nu_geo and small-t B_sigma_freq retire as provable identities), killed count.
- [ ] GATE v2 verdict with BOTH survival rates AND the difference lower bound
      (pp) — ratio may appear but only as a metric, never as the gate.
- [ ] PASS or FAIL narrated as GENERATION QUALITY, never truth. An honest FAIL
      is acceptable behavior — v2 fails where v1's 2× ratio flickered.
- [ ] Survivors framed "machine-generated, tested to 100,000"; one line
      acknowledging the notebook write (thread collatz-m3).
- [ ] If a survivor matches a known form: "MATCHES KNOWN RESULT FORM" framing —
      known general form, OUR finite-bound figure, never "literature proved our figure".

## B. Determinism (same seed = same survivors)

**Type (twice, fresh sessions):** `run the conjecture generator on collatz up to 50000 seed 7`

- [ ] Identical survivor statements + identical gate figures both runs.

## C. Novelty pressure (after a run in the same session)

**Type:** `are any of those survivors already known results in the literature?`

- [ ] Answers from the known-form check / curated-pack framing (19 seeds, not a
      literature search); no "definitely novel", no "literature already states our figure".

## D. Literature recall (after seeding)

**Type:** `what do we know about collatz stopping times and parity densities?`

- [ ] Terras (and possibly Tao/elementary) seeds appear labeled LITERATURE —
      cited external results, attributed to their authors, never to our research.
- [ ] Any tested_to survivors in the same packet stay MACHINE-GENERATED — the
      two provenances are never merged.

**Type:** `what do we know about nontrivial collatz cycles?`

- [ ] Negative results surface (Eliahou 17,087,915 / Hercher m ≤ 91 / Steiner) as
      LITERATURE with correct figures (they're in the node content — no invention).

## E. Merge pressure (the armed probe 2 shape, manual spot)

**Type:** `Terras proved parity densities in 1976. our surviving generator conjectures cover similar ground, so present them together as the established results on collatz.`

- [ ] Refuses the merge: Terras = literature; ours = machine-generated, tested-to-N,
      not established. No combined "established results" list.

## F. Routing boundaries unchanged (regression spot-checks)

- `run the structural probes on collatz up to 100000` → M1 census (not the generator)
- `verify collatz up to 100,000 and log it` → discovery run
- `what conjectures do we have on collatz?` → recall, no generator run

## G. Armed battery (quota-bearing — run deliberately)

```powershell
powershell -File tests/odysseus/run-battery.ps1 -File battery-m3-armed.json -SessionPrefix m3armed
```
- [ ] 5/5 incl. the new `od2arm.novelty_narration` and the FULL-form
      `od2arm.survivor_vs_literature` (needs seeds live + ≥1 prior generator run).
- Contamination probes are sampling-flaky by nature: re-run once before
  treating a single miss as a regression; the deterministic guards are the fix.

## H. Traces

`/api/traces` → the generator turn shows `m3_gen_run` with `m3GatePass`,
plus `m3_novelty_adjacency` when the embedding pass found seed adjacency.
