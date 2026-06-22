# Build-113 — Live test: outcome-aware generation (the Record→Generate wire)

**What changed (plain English):** the nightly conjecture generator used to mine its 120 candidates
by a fixed round-robin over the 10 templates — it ignored what had already verified or `sorry`-ed.
Now a feedback snapshot (earned-verified + sorry outcomes from `m8_conjecture_outcomes`) **down-weights
the template regions it already explored**, so the cohort favors **unexplored** regions. Past outcomes
now measurably steer the next generation.

**What did NOT change (honesty + gate intact):** survival, the Wilson/Newcombe gate, the micro-prover,
the vacuity floor, and the "machine-generated / never proven" contract. Steering changes *which regions
we explore*, never *what counts as surviving*. The random baseline is still rebuilt from the (biased)
mined composition, so the gate still compares like-with-like.

**Offline proof:** `tests/B113-outcome-aware-gen-verify.ps1` — 49/49 (14/14 core). The acceptance check
runs the cohort schedule twice: empty feedback → balanced 12-per-template (byte-identical to v2);
mock down-weight of one region → that region drops to 4 draws (composition diverges). A no-op wire
would make the two identical and FAIL the check.

---

## How to verify it live (in chat)

### 1. Run the generator and read the new line
Type in M8 chat:

```
run the conjecture generator on collatz up to 100000 seed 1337
```

In the results packet, look for the new **`FEEDBACK STEERING (Build-113, generation v3 …)`** line.

- **Today (expected):** it will most likely say *"no recorded outcome earned steering weight … this
  cohort is byte-identical to gen v2 for the seed; the wire is closed but SILENT until a technique
  verifies repeatedly."* ✅ **This is correct, not a bug.** The verified side is gated by Grok's
  N-verifs rule (`M8_LEARN_MIN_VERIFS`, default 3) — with only a couple of verified rows so far, nothing
  has earned steering weight yet. The wire is closed; it just hasn't fired because the Lean lane hasn't
  produced enough repeated verifications.
- **Once the Lean lane accumulates ≥3 verifications of a technique** whose conjecture text maps to a
  template (e.g. stopping-time + residue), the line will instead name the down-weighted region(s), and
  the survivor mix will shift away from them.

### 2. Check the nightly run row in Supabase
After the next `cron-explore` run, in the M8 Supabase → `m8_loop_runs` (latest row), the `metadata`
JSONB now carries:

```json
{
  "gen_version": 3,
  "learn": {
    "min_verifs": 3,
    "earned_patterns": 0,
    "down_weighted": [],
    "gen_steered": false
  }
}
```

- `gen_version: 3` confirms the feedback-conditioned generator ran.
- `gen_steered` / `down_weighted` are the audit trail: `true` + a non-empty list once steering fires.
  `false` + `[]` is the correct silent state until the Lean lane earns it.

### 3. (Optional) Force-see the mechanism
You don't need this, but if you want to *see* steering with the current data, set
`M8_LEARN_MIN_VERIFS=1` in the M8 Vercel env temporarily — then any single classified verified/sorry
row will down-weight its region on the next run (`gen_steered: true`). **Revert it to 3 afterward** so
the Lean flip-flop guard stays in place.

---

## Kill switch (rollback without redeploying code)

| Env var | Effect |
|---|---|
| `M8_GEN_STEER_DISABLED=1` | Keeps the PREFER/AVOID narration, but reverts **generation** to the unsteered v2 cohort (empty profile). Surgical rollback of just this build. |
| `GRAPH_DISABLED=1` | Disables the whole feedback path (no reads at all) → plain v2 generation + no narration blocks. |

No new paid APIs, no schema change (telemetry rides the existing `m8_loop_runs.metadata` JSONB).

## Reminder
`m8_conjecture_outcomes` only grows when the nightly Lean/M4 lane verifies or `sorry`s a leaf. The wire
is now closed end-to-end (Record → Read → **Generate**); its *visible effect* scales with how much the
Lean lane produces. Until then it stays correctly silent.
