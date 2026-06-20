# Build-85d — Multi-hop Reasoning Chain · LIVE TEST

Live URL: https://m8-alpha.vercel.app
Run the migration first (Supabase SQL editor): `migrations/B85d_reasoning_chains.sql`.

**What to look for on a chain turn:** the reply is laid out as visible steps —
`Step 1: … → …` / `Step 2: … → …` / `Therefore: …` — instead of one paragraph.
In Vercel runtime logs you'll see `reasoning_chain` for these turns, and a row
lands in `m8_reasoning_chains` (session_id, question, steps jsonb, final_answer).

Latency budget is 8s — if Gemini is slow, the turn silently falls back to a
normal single-hop answer (still correct, just not stepped). That's expected.

---

## A) SHOULD trigger the chain (complex, >80 chars, not fleet/finance/compute)

1. **Why does compound interest grow so much faster than simple interest over a long period of time?**
   - Expect: stepped breakdown (what each is → how reinvestment compounds → Therefore).

2. **How do electric vehicle batteries degrade over time, and what factors actually accelerate that wear?**
   - Expect: steps separating the chemistry from the accelerating factors, then a conclusion.

3. **Compare nuclear fission and fusion in terms of fuel, safety, waste, and how close each is to practical.**
   - Expect: per-dimension sub-answers stitched into a Therefore.

4. **Explain the relationship between inflation and unemployment and why economists call it a tradeoff.**
   - Expect: define each → the link → why it's a tradeoff → Therefore.

5. **What is the difference between machine learning and deep learning, and how do they relate to AI broadly?**
   - Expect: ML vs DL sub-answers + the nesting under AI, shown as steps.

**Verify after these:** check `m8_reasoning_chains` has 5 new rows, each with a
`steps` array of `{subQ, answer}` and a `final_answer`.

---

## B) Should NOT trigger the chain (single-hop, as before)

6. **Why?**  — too short (≤80 chars). Normal answer.

7. **What's this month's P&L?** — finance lane (deterministic FLEET P&L packet). Never chains.

8. **Who is behind on pace this month?** — fleet lane (driver/pace). Never chains.

9. **9 to the power of 11?** — compute lane (self-contained math). Never chains.

10. **How are you doing today, boss?** — short greeting, no real reasoning. Normal answer.

**Verify:** for 6–10 there should be NO new `m8_reasoning_chains` rows and NO
`reasoning_chain` log line — they go through the normal answer path untouched.
