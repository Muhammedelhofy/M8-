# M8 Team Brief — Build-8 Complete / Session-8 Close
**Date:** 2026-06-12 | **Session:** 8 | **To:** GPT · Grok · Gemini · Manus

---

## WHERE WE ARE (state of the machine)

M8 is Muhammad's personal AI OS — a deterministic-first orchestrator that rides Gemini
as the LLM backbone and wraps it in a hard spine: fleet data, verified compute, a
persistent research notebook, and a layered honesty contract. The North Star is
prize-class open-problem research capability, not fleet automation.

**Maturity ladder position:**
```
L1 Chatbot          ✅ done
L2 Grounded asst    ✅ done  (deterministic spine + honesty brain)
L3 Proactive ops    🟢 ~85%  (fleet frozen at rider-risk)
L4 Verified tools   🟡 ~60%  (compute + tool-decision + orchestration all live)
L5 Autonomous loop  ⚪ ~15%  (Research Notebook substrate shipped; exploration live)
```

**The eval battery** (14 probes, ~4.5/5 baseline — tracked in `tests/eval/`):
Categories: grounding · honesty · fleet_intel · reasoning · state_tracking ·
memory · latency · compression · silent_fail · prompt_bypass · tutoring ·
tool_decision · research_notebook · finance · odysseus_redteam

---

## WHAT SHIPPED THIS SESSION (Build-8)

### OEIS Sequence Probing — `lib/discovery.js` + `lib/orchestrator.js`

A new **open-ended analysis lane** that sits alongside the Phase 4 discovery loop.

**The distinction that matters:**
- **Discovery loop** (Build-1/2) = VERIFIES a KNOWN property to a STATED BOUND.
  "verify Collatz up to 100,000 and log it" → runs code, logs evidence.
- **OEIS probing** (Build-8) = DISCOVERS an UNKNOWN formula/recurrence from raw
  terms or a named OEIS sequence. "analyze 0, 1, 4, 9, 16, 25, 36, 49" → figures
  out a(n) = n².

**How it works:**
1. `detectOEISProbe` — fires on analysis verbs (analyze/examine/investigate/study/
   find-the-formula) + sequence signal (raw numbers OR sequence noun OR research
   target). Does NOT fire on discovery-style bound ("explore primes UP TO 1000"
   stays discovery). Does NOT fire on plain fleet/notebook/compute turns.
2. `buildOEISDirective` — 6-step protocol injected into the system prompt:
   generate 30 terms → compute differences/ratios/mod patterns → state
   "Conjecture: a(n) = ..." → verify n=1..100 → honest "consistent with first 100
   terms, not a proof" frame → "Logged to the notebook as thread '...'."
3. `buildOEISNotes` — post-LLM: extracts the Conjecture line + verified/fails
   markers from the response → stages conjecture note + evidence-for or
   evidence-against note. Requires a real execution marker — no code = nothing
   logged (fails safe).
4. `toolDecision = 'oeis'` — traced in request_traces.

**Bug fixed in this build:**
- `OEIS_ANALYZE` regex had a trailing `\b` after the whole group — meaning
  `analyz\b` never matches "analyze" (the 'e' after 'z' isn't a word boundary).
  Same for `examin` → "examine" and `investigat` → "investigate". Removed.
- `stud[yi]ing?` matched "studying" but not "study". Changed to `stud(?:y|ying?)`.

**Tests:** `tests/oeis-verify.ps1` — 24/24 (17 detection + 7 note-building).
Eval probe `notebook.oeis_conjecture_honest` — LIVE 4/4. Perfect squares sequence
as the fixture: code ran + n² conjecture named + no proof claim.

---

## THE FULL TOOL ORCHESTRATION STACK (for context)

All tools share one spine. Detection priority (first match wins):

```
Fleet data query       → lib/fleet.js       (hard-route, no LLM routing)
Finance / P&L          → lib/finance.js     (hard-route)
EOSB calculator        → lib/eosb.js        (hard-route)
State tracking         → lib/stateEngine.js (hard-route)
Discovery loop         → lib/discovery.js   (verify KNOWN to BOUND + log)
OEIS probing           → lib/discovery.js   (discover UNKNOWN formula) ← BUILD-8
Research notebook      → lib/notebook.js    (read/write/registry/inference)
Company context        → lib/companies.js   (multi-company registry)
Compound search→compute → orchestrator      (live variable + arithmetic)
Compute (auto-route)   → Gemini code-exec   (COMPUTE_HEURISTIC + tool-decision)
LLM tool-decision      → lib/router.js      (answer/search/compute/clarify)
Web search             → search()           (suppressed when compute owns the #)
```

**Honesty contract (non-negotiable, load-bearing everywhere):**
- Narration ≤ evidence. A bounded check is evidence, never a proof.
- A run without real code logs nothing (EXEC_MARKER required).
- An unverified conjecture is NEVER upgraded by user pressure.
- Future data (fleet projections, unverified facts) = decline or flag assumption.

---

## WHAT'S NEXT (the question for the team)

### Build-9 candidate: Lean Verification Probe (Phase 3 rung)

This is the **next North Star step** after OEIS probing. The idea:
M8 proposes a formal Lean 4 statement from a notebook conjecture → a Lean+Mathlib
checker accepts or rejects it → result logged as `kind='lean_verified'` or
`kind='lean_rejected'`.

**Why it's hard:**
- Lean 4 + Mathlib cannot run on Vercel serverless or Gemini sandbox (memory/time
  limits). It needs a dedicated executor.
- The plan is a Cloud Run container: Docker image with Lean 4 + Mathlib, a FastAPI
  `/check` endpoint that accepts a Lean statement string and returns pass/fail +
  error output. M8 calls it as a truth-tool (like fleet calls Supabase).
- The formalization step (LLM writes valid Lean 4 from a natural-language conjecture)
  is the hardest reasoning step M8 has attempted. This is where model capability
  matters most.

**Scope questions the team should weigh in on:**
1. **Cloud Run vs alternative** — is Cloud Run the right executor for Lean? Any
   better serverless Lean infra in 2026? (e.g. Modal, Fly.io, a hosted Lean API?)
2. **Formalization strategy** — should M8 attempt to write Lean statements itself
   (risky, may produce unverifiable syntax), or should it propose a STRUCTURED
   template (fill-in-the-blank for known theorem patterns) that the LLM fills in?
3. **Starting corpus** — which theorems are the RIGHT first targets? Lean community
   has Mathlib; we want the EASIEST formalizable theorems first (not Riemann).
   Suggestions: prime infinitude, Euclid's algorithm, basic number theory.
4. **Model for Build-9** — Fable 5 is on the table (Muhammad has a free trial
   ending soon). Does Build-9's Lean formalization step specifically warrant Fable 5
   over Sonnet 4.6? Where exactly does the capability ceiling matter?

### Also open for team input:
5. **OEIS battery extension** — are there sequence types that `detectOEISProbe`
   will miss? Any false-positive risk (sequences that look like fleet data)?
6. **Adversarial probes for OEIS** — what attack vectors should the Odysseus
   pipeline generate next? The OEIS lane has a new honesty surface: the conjecture
   framing. What pressure tests would you add?
7. **Full battery regression** — we haven't run all 14 probes since Build-8 shipped.
   Run recommended before Build-9 starts. Any predicted regressions?

---

## THE HONEST CAPABILITY STATEMENT (for calibration)

M8 is a **deterministic harness around Gemini's spark**, not an independent
discovery engine. It enforces structure, honesty, and persistence that the raw
frontier model won't maintain on its own. The discovery loop + OEIS probing are
the first real rungs on the autonomous-exploration ladder. Lean verification is the
third rung and the first one that requires external infra.

**Realistic near-term contribution:** smaller open problems + computational
verification + being a genuine thinking instrument for Muhammad.
**The bar we build toward:** $1M Millennium tier. **The claim we never make:** that
we're there.

---

*Brief prepared by Claude Sonnet 4.6 / M8 session-8. Repo: github.com/Muhammedelhofy/M8-*
