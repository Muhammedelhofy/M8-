# M8 Intelligence Upgrade — Intent Routing Roadmap

**Owner:** Muhammad · **Started:** 2026-06-24 · **Status:** Phase 0 not started
**This is the doc we follow so we don't get lost.** Update the status column + changelog after every step.

---

## The problem (in one line)
M8 today = a **keyword router in front of a context-starved AI**. Say the magic words → it acts.
Miss a word (typo, synonym, "remove" vs "delete", "it"/"that") → it falls through to an AI that
often can't see the data → **endless clarifying questions / gets lost.**

## The fix (in one line)
Flip the order: **AI reads your message FIRST, understands what you mean + what you're referring
to, THEN calls the same locked action.** This is *intent routing*. Covers **all lanes** (money,
tasks, notes, fleet) — the wallet is just one of them.

## Non-negotiable invariants (NEVER change, any phase)
- 🔒 **Confirm-before-write** — every action shows a confirm card before it touches anything.
- 🔒 **Privacy wall** — the AI never sees stored money DATA (balances/history); only the single
  live message in front of it, and nothing money-related is logged.
- 🔒 **Scoped DB key** — M8 can only do what its narrow key allows; new powers (e.g. delete) are
  granted deliberately, with Muhammad's explicit OK, never silently.
- Rule: **the AI proposes, the locked code disposes.** Intelligence upgrades change how M8
  *understands*, never what it's *allowed to do*.

## Locked design rules (reconciled from the council, 2026-06-24)
- **Phase 0 = pure deterministic, NO LLM.** The safety net is keyword/domain detection +
  templated capability replies. Zero latency, zero cost, cannot worsen behaviour. (Rejected
  Manus/GPT's "confidence-score" Phase 0 — that needs the AI layer, which starts in Phase 1.)
- **Intent router (Phase 1+) = one fast LLM call:** `thinkingBudget: 0`, **strict JSON
  responseSchema** (domain + intent + entity + confidence), **never** conversational text. It's
  in the critical path of every turn, so it must be lightning-fast (Gemini's latency tax).
- **Never guess between valid targets.** If 2+ entries match ("the fuel one" × 3), M8
  disambiguates — it does not assume. Understanding up, assumptions not (GPT).
- **Confidence bands:** high → confirm card · medium → one clarifying question · low →
  capability-honest message (no loop).
- **Privacy wall holds:** the router sees only the live message, never stored money data;
  deterministic Node code does all arithmetic (Gemini's "Gödel brick").

---

## Before → After (across topics — proves it's general)

| You say | Today (keyword) | After (intent) |
|---|---|---|
| 💰 "get rid of that 50 I just added" | confused loop / asks for "balance" | "Delete the 50 SAR lunch I just logged? yes/no" |
| ✅ "scratch the gym task, did it" | may miss "scratch" → nothing happens | marks the gym task done |
| 📝 "note the car insurance is due next week" | needs exact note-phrasing | saves the note, no magic words |
| 🚗 "how'd the fleet do last week" | needs "spent/profit" keywords | reads it as a fleet earnings query |
| 🔗 "remove it" / "the last one" | no idea what "it" is | knows "it" = what you just discussed |

---

## The phases (one at a time; test each before the next)

| Phase | What | Risk | TEST CHECKPOINT | Status |
|---|---|---|---|---|
| **0 — Safety net** | **Deterministic, NO AI.** When a message hits a lane's keywords but no parser matches, reply plainly instead of looping. All lanes. | 🟢 none | The real screenshot cases ("remove the last expense", "what was the last expense Sara did") → clear message, no loop | 🟢 **BUILT — offline test 12/12 PASS; awaiting Muhammad's live test** (branch `phase0-safety-net`) |
| **1 — Wallet pilot + intent core** | Build the **reusable** intent classifier (domain+intent+entity, strict JSON), prove it on the money lane. Includes basic reference ("that/last"). | 🟢 low | messy money sentences all route right; deletes confirm-gated; never guesses between 2 matches | ⬜ not started |
| **2 — Reference resolution** | Generalize "it / that / the last one / undo / scratch that" across lanes. | 🟢 low | reference phrases work | ⬜ not started |
| **3 — Tasks + Notes** | Wire the intent core into tasks + notes. | 🟢 low | work without command vocabulary | ⬜ not started |
| **4 — Fleet + general** | Intent core into fleet/earnings + free chat. | 🟡 med | conversational fleet queries | ⬜ not started |

**Workflow each phase:** build on a branch → **code-only, nothing deployed** → Claude says
"🔴 TEST THIS NOW" → Muhammad tests locally → only deploy on his explicit "go".

## Team round (GPT / Gemini / Grok / Manus)
**Plan:** take ONE focused round **after the Phase 1 pilot exists** — not now as a gate.
They review the real pilot + the one open design question (*how much should the AI see for money?*)
+ failure modes. Reviewing a working thing >> voting on an abstract plan. Brief lives in the repo
as a standalone MD (per team-brief convention), never a chat paste.

---

## Changelog
- **2026-06-24** — Roadmap created. M8 un-parked. Direction agreed: all-lanes intent routing,
  phased, safety rails fixed.
- **2026-06-24 (council round: Manus/GPT/Grok/Gemini)** — All four GO. Reconciled: Phase 0 stays
  pure-deterministic (no AI); GPT's intent-layer folded into Phase 1 as a reusable module;
  reference resolution pulled forward to Phase 2; "never guess between matches" + confidence
  bands + router perf rules (thinkingBudget 0 / strict JSON) locked. Next action: build Phase 0,
  pending Muhammad's go.
- **2026-06-24 — Phase 0 BUILT** on branch `phase0-safety-net`. Added `capabilityFallback()` to
  `lib/orchestrator.js` (deterministic money/task/note nets, fleet/finance + DOC excluded) +
  wired into both routing paths (buffered + streaming). Offline PS mirror
  `tests/phase0-safety-net-test.ps1` = 12/12 PASS. Live test sheet `tests/PHASE0_LIVE_TEST.md`.
  Nothing committed/deployed — awaiting Muhammad's live test, then "go".
