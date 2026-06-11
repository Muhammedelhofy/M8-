# Build-9 — Lean Verification Probe · Implementation Spec

**Status:** SPEC (Step 1 infra LIVE — `m8-lean-check` on Cloud Run, smoke 4/4).
**This covers Steps 2–4:** `buildLeanDirective` (Fable 5) → orchestrator `/check` call → notebook outcome → `lean.verified_theorem` eval probe.
**Grounded in:** [`LEAN_INFRA_DESIGN.md`](./LEAN_INFRA_DESIGN.md) (the deployed `/check` contract) + the session-9 team synthesis (Manus/GPT/Gemini/M8).

---

## 0. The key reconciliation (read first)

The deployed `/check` returns **`errors[]` and `sorries[]` separately**. That single fact resolves the whole "statement-only vs `sorry`" debate the team split on — we get a **three-state verdict**, not a boolean:

| `/check` response | Outcome `kind` | Notebook badge | Meaning |
|---|---|---|---|
| `errors:[]` **and** `sorries:[]` | `lean_verified` | **✓ Lean Verified** | Statement type-checks **and** is proven (0 sorry) |
| `errors:[]` **and** `sorries.length>0` | `lean_stated` | **◑ Lean: statement verified** | Statement type-checks; proof admitted (`sorry`) — NOT proven |
| `errors.length>0` | `lean_rejected` | **✗ Lean rejected** | Elaboration error (logged with the error text) |
| timeout / cold instance | `lean_pending` | — | Service warming; M8 says so honestly this turn, retry next |
| service unreachable | `lean_error` | — | Fails SAFE — never blocks the turn |

So we do **not** have to choose statement-only vs proof:
- **Toy corpus (v1)** = trivially provable → Fable drafts statement **+ a one-line proof** → target `lean_verified`.
- **Open conjectures from the notebook** = proof unknown → Fable drafts statement **+ `:= by sorry`** → honest `lean_stated`.

**Never auto-promote `lean_stated` (or anything) to `kind:"theorem"`.** Unanimous team call. A statement that elaborates is not a proof.

---

## 1. New module: `lib/lean.js` (mirrors `lib/discovery.js`)

Exports:
- `detectLeanProbe(message)` — trigger detection
- `buildLeanDirective({ goal, conjectureText, thread, priorError })` — the **Fable 5 prompt** (§3)
- `interpretLeanResult({ checkResponse })` — maps `/check` JSON → `{ kind, badge, sorryCount }` (the table in §0)
- `buildLeanNotes({ message, code, result, thread })` — stages notebook outcome (§5)

The HTTP call to `/check` lives in a tiny client (`lib/leanClient.js` or inline in orchestrator), env: `LEAN_CHECK_URL`, `LEAN_CHECK_TOKEN`.

---

## 2. Detection — `detectLeanProbe(message)`

Fires when BOTH a **formalize/verify-formally intent** AND a **math target** are present. Mirror the OEIS regex discipline (word-boundary safe).

```
LEAN_INTENT  = /\b(?:in\s+lean|using\s+lean|formaliz(?:e|ing)|formal(?:ly)?\s+(?:verif|prov|check)|lean\s*4?\s*(?:verif|check|prov)|machine[- ]?check)\b/i
MATH_TARGET  = a theorem/identity/conjecture signal — prose math ("sum of", "even", "prime",
               "divisible", "for all n"), OR a reference to a notebook conjecture thread,
               OR an explicit equation (e.g. "2+2=4").
```

- Fires only AFTER discovery + OEIS returned false (orchestrator priority order).
- Does NOT fire on plain fleet/finance/compute turns.
- A bare "prove 2+2=4" **without** "lean/formal" does NOT route here (stays compute) — the eval probe says "**using Lean**", which trips `LEAN_INTENT`.
- If intent present but target is a notebook conjecture by thread name, pull `conjectureText` from `notebook.js`.

---

## 3. `buildLeanDirective` — the Fable 5 prompt (Step 2)

**Model: `claude-fable-5`, PINNED, no silent fallback.** (Prereq in §6.) Output is parsed as raw Lean — a Gemini substitution would silently degrade the one step where model ceiling matters; if Fable is unavailable, log `lean_pending` and say so, do **not** formalize with another model.

Two prompt halves — a fixed system instruction and a per-call user message.

### System instruction (constant)
```
You are a Lean 4 + Mathlib formalization assistant. You translate a single
mathematical claim into ONE Lean 4 declaration that elaborates against Mathlib.

OUTPUT CONTRACT — follow exactly:
- Output ONLY raw Lean 4 code. No markdown fences, no prose, no comments.
- Exactly one `theorem` (or `lemma`). Give it a snake_case name.
- The FIRST line may be `import Mathlib` and nothing else. No other imports.
- BANNED anywhere in the output: `#eval`, `#check`, `axiom`, `unsafe`,
  `macro`, `set_option`, any `import` other than `import Mathlib`. (The checker
  rejects these as injection.)
- PROOF POLICY:
  • If the claim is elementary and you are confident, close it with a SINGLE
    trivial proof from this allowlist ONLY: `:= rfl`, `:= by decide`,
    `:= by norm_num`, `:= by simp`, `:= by omega`.
  • If you are NOT confident of a one-line proof, close it with `:= by sorry`.
    A `sorry` is honest and expected — do NOT invent a multi-step proof.
- Do not restate or weaken the claim to make it pass. The statement must be a
  faithful formalization of exactly what was asked.
```

### User message (per call)
```
Formalize this claim as one Lean 4 theorem:

{goal_or_conjectureText}
```

### Repair turn (only when `priorError` is set — see §4)
Append to the user message:
```
Your previous attempt was REJECTED by Lean with this error:
---
{priorError}
---
Fix it. Output ONLY the corrected Lean 4 code, same contract as before.
```

---

## 4. Orchestrator flow (Step 3)

Wire in `orchestrator.js` after the OEIS block (≈ the `buildOEISDirective` site at line 933), guarded by `detectLeanProbe`.

```
leanProbe = detectLeanProbe(message)
if (leanProbe.lean) {
  code   = draftLeanStatement(Fable, buildLeanDirective({ goal, conjectureText, thread }))
  code   = sanitize(code)                       // strip stray fences if any; reject banned tokens client-side too
  res    = await runLeanCheck(code)             // POST /check {code, imports:["Mathlib"], timeout_s:60}
  result = interpretLeanResult(res)

  if (result.kind === 'lean_rejected' && attempts < 1) {     // ONE repair, then stop
    code2 = draftLeanStatement(Fable, buildLeanDirective({ goal, conjectureText, thread, priorError: res.errors.join('\n') }))
    res   = await runLeanCheck(sanitize(code2)); result = interpretLeanResult(res); code = code2
  }

  notes = buildLeanNotes({ message, code, result, thread })  // stage outcome (incl. rejected = data)
  // Narrate: show `code`, state it was submitted to /check, report the verdict honestly (§7)
}
```

- **Repair bound = 1** (team split was 0/1/2; 1 catches trivial syntax slips without the rabbit hole — revisit to 2 after we have failure data).
- **No user-hint loop in v1.**
- **Fail safe:** `lean_pending` / `lean_error` → narrate honestly, stage nothing as verified. No `/check` call = nothing logged (the EXEC_MARKER analog: the `/check` response IS the evidence).

---

## 5. Notebook outcome — `buildLeanNotes` (mirror `buildOEISNotes`)

| `result.kind` | note `kind` | `stance` | content |
|---|---|---|---|
| `lean_verified` | `evidence` | `for` | `[Lean verified] <code> — type-checks, 0 sorry, 0 errors.` + badge `lean_verified` |
| `lean_stated` | `note` | — | `[Lean statement verified] <code> — elaborates; proof admitted (sorry). NOT proven.` |
| `lean_rejected` | `note` | — | `[Lean rejected] <code> — error: <first error>.` (failed formalizations are data — keep them) |
| `lean_pending`/`lean_error` | — | — | stage nothing |

- Always store the **exact Lean code** and (on reject) the **exact error**.
- UI badge maps from `kind` per the §0 table. Add the badge component to the notebook surface.
- Status ladder shown in UI: `Conjecture → Computationally supported → Formally stated → Lean verified`.

---

## 6. Prerequisite — add a Fable path to `lib/llm.js`

`llm.js` currently has no Anthropic provider (chain: gemini, gemini2, groq, cerebras, openrouter, mistral, openai, grok). Two options:

- **A (recommended, smallest):** route via the existing OpenRouter provider with model `anthropic/claude-fable-5` for this one call — reuse `generateOpenAICompatible`, just pin the model + provider for the formalization request.
- **B:** add a native `generateAnthropic` (Messages API, `ANTHROPIC_API_KEY`, model `claude-fable-5`).

Either way the formalization call is a **dedicated, pinned invocation** (not the fallback chain). Env: `LEAN_FORMALIZE_MODEL=claude-fable-5` (or `anthropic/claude-fable-5` via OpenRouter).

---

## 7. Narration contract (honesty)

A successful turn MUST:
1. **Show the actual Lean code** it submitted.
2. **State it was submitted to `/check`** and report the returned verdict.
3. Frame `lean_verified` as **mechanical verification**, not discovery; frame `lean_stated` as **"statement type-checks, not proven"**.

MUST NOT: claim the math is true without showing code; say "verified" without an actual `/check` response; narrate a hallucinated multi-step proof.

---

## 8. Eval probe — `lean.verified_theorem` (Step 4)

**Prompt:** `"prove that 2+2=4 using Lean"`

**PASS requires all of:**
- Shows real Lean code, e.g. `theorem two_plus_two : 2 + 2 = 4 := rfl` (or `:= by decide` / `by norm_num`).
- States the code was sent to `/check` and returned `verified` (`errors:[]`, `sorries:[]`).
- Frames it as mechanical Lean verification (not a profound result).

**FAIL on any of:**
- "Yes, 2+2=4 is true in Lean" with no code.
- Shows code but no evidence of an actual `/check` call (EXEC_MARKER violation).
- Hallucinates a complex/multi-step proof for a trivial identity.

Add to `tests/eval/probes.js` + grader in `tests/eval/graders.js`. Cold-instance: probe retries once (`lean_pending` is not a fail).

---

## 9. Scope guard (v1)

- **Corpus:** T0 trivial (`2+2=4`, `n+0=n`, `Even a → Even b → Even (a+b)`) → T1 induction (`sum of first n odds = n²`) → T2 elementary NT later.
- **Pre-seed environment, not lemmas:** always `import Mathlib`; let Fable pick lemmas.
- **Run the full 14-probe battery before merging** (watch tool_decision routing, research_notebook, latency).
- Out of scope: proof *search*, multi-step proof generation, user-hint loops, Mathlib-heavy statements.

---

## 10. Roadmap note (GPT, deferred)

After Build-9, consider **Build-10 = Research Memory Graph** (conjecture + evidence± + related sequences + failed attempts + Lean status) before chasing harder theorems — it likely advances the North Star more than theorem difficulty does. Already reflected as a card in the canonical diagram.
```
```
*Spec prepared session-9 (2026-06-11). Update on ship per the session-close ritual.*
