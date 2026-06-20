# Build-85c — Self-Reflection Loop — LIVE TEST

Live at https://m8-alpha.vercel.app after the branch deploys (or merge to main).
The reflection pass is **invisible by design** — it only changes the answer when the
draft was weak. To confirm it ran, watch the Vercel function logs for a
`"step":"reflection"` line, and check the `m8_reflections` table fills up.

> Prereqs: run the migration `migrations/B85c_reflections.sql` in Supabase first
> (creates `m8_reflections`). `GEMINI_API_KEY` (or `_2`) must be set — the reflector
> uses `gemini-2.5-flash`. Reflection is gated to **general + knowledge lanes only**;
> fleet/finance/compute/research answers are never touched.

Type each of these in live chat and watch the reply + the Vercel logs.

---

### 1. PASS-THROUGH — a clean, well-scoped general answer (no change expected)
**Type:** `In one sentence, what is the capital of Japan?`

- **Expect:** "Tokyo." (or one short sentence). Answer is returned **unchanged**.
- **Logs:** a `reflection` log line with `relevance` ≥ 3 and `rewritten:false`.
- **Why:** relevance is high, no overclaim, nothing missed → `revised` is null →
  the original answer is shown verbatim.

---

### 2. REWRITE — a vague/evasive draft gets a second pass (relevance < 3)
**Type:** `Explain, specifically, how compound interest differs from simple interest, with the formula for each.`

- **Expect:** a focused answer that actually gives both formulas
  (`A = P(1+r)^t` vs `A = P(1+rt)`) and the difference.
- **Logs:** if the first draft was generic/hand-wavy, a `reflection` line with
  `rewritten:true` (relevance scored < 3, rewrite call fired). If the first draft
  was already sharp, `rewritten:false` and no visible change — both are correct.
- **Why:** this is the rewrite path — a low-relevance draft is regenerated once with
  the issue list, keeping the same facts but improving accuracy/sourcing.

---

### 3. OVERCLAIM — knowledge answer that risks stating guesses as fact
**Type:** `Who will win the 2030 World Cup, and why are you certain?`

- **Expect:** M8 should NOT confidently name a winner. If the model still asserts
  something unverifiable, the reflector flags it: the reply is prefixed with
  **`[unverified]`**.
- **Logs:** `reflection` line; `m8_reflections.overclaim_flag = true` for this row.
- **Why:** overclaim:true → `stripUnverified` wraps the answer with the `[unverified]`
  marker so a guess can't masquerade as fact.

---

### 4. MISSED-SOURCE — a topic the knowledge base may cover
**Type:** `What does Ibn Kathir say about the creation of the heavens?`

- **Expect:** the answer (from the ingested book graph if present), and if the
  reflector judges that more context likely exists, a trailing line:
  **"Note: additional context may exist in knowledge base"**.
- **Logs:** `m8_reflections.missed_source_flag = true`.
- **Why:** missed_source:true → the standing note is appended (idempotently).

---

### 5. NO-REFLECT GUARD — a fleet answer must be returned untouched
**Type:** `who is behind on pace this month?`

- **Expect:** the normal fleet brief / pace answer with real driver names + numbers.
- **Logs:** **NO** `reflection` log line, and **no** new `m8_reflections` row.
- **Why:** the fleet lane carries a deterministic ground-truth packet —
  `reflectEligible` is false (`!fleetCtx.text`), so the reflector never runs. Same
  for finance/P&L, compute (`compute: ...`), and research/Lean/discovery turns.
  This is the load-bearing guard: a probabilistic reflector must never re-judge a
  ground-truth answer.

---

## What to verify overall
- [ ] Migration applied; `m8_reflections` exists.
- [ ] Clean answers (Q1) pass through unchanged.
- [ ] At least one of Q2/Q3/Q4 produces a visible change (rewrite, `[unverified]`,
      or the missed-source note) **or** a logged reflection row — confirming the
      pass actually runs end-to-end.
- [ ] Q5 (fleet) is **never** reflected — no log line, no row.
- [ ] Latency stays sane: the scoring call is capped at ~2s and fails safe — if
      Gemini is slow/over quota the original answer is returned with no error.
