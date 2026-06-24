# M8 Intelligence Upgrade — Intent Routing Roadmap

**Owner:** Muhammad · **Started:** 2026-06-24 · **Status:** Phases 0/1/1.1/2 LIVE-VERIFIED on prod (m8-alpha) · Phase 3 (tasks/notes) next
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

## Found during Phase 0 live test (2026-06-24) → Phase 1 targets
Phase 0 fixed *fall-through* loops (the screenshot cases ✅). But the live test
exposed a second bug class — a **greedy lane claims the message before the safety
net runs** ("mis-claim", not fall-through). A net at the END of the chain can't fix
these; the **Phase 1 intent brain (decide the lane up front)** is the real fix.
- **AR "احذف آخر مصروف"** → Tasks lane claimed it. Cheap deterministic fix shipped
  (Build-120: Arabic generic-delete → strong:false, mirrors English). ✅
- **"make me rich"** → Fleet lane treats unknown text as a driver name and loops
  "which account?". **Deferred to Phase 1** (Muhammad's call 2026-06-24) — fleet is
  the live job tool; the intent brain fixes it safely rather than a rushed hack.

## Phase 1 code review — council round 2 (2026-06-24) → rulings
All four (GPT/Grok/Gemini/Manus): **architecture is right, spread it.** Unanimous #1 fix = the
**write-action gate**. Reconciled decisions:
- **Writes (add/edit) must require a DETERMINISTIC amount** present in the message — never let the
  AI invent one ("add lunch" must NOT become "add 50"). No number → CLARIFY ("how much?"), not
  confirm. (GPT B-table + Grok/Manus numeric sanity + Gemini "drop fake confidence".)
- **Stop trusting the LLM confidence float** as the write gate (a free model says 0.95 on a
  hallucination — Gemini). Use it only as a coarse floor; the deterministic amount-check + the
  confirm card are the real safety. Reads (total/category) keep the low bar.
- **Add numeric/currency sanity checks** in `classifyMoneyIntent` (reject ≤0, NaN, absurd, currency
  ∉ {SAR,EGP}).
- **Use native JSON mode** (`response_format:{type:"json_object"}`) on OpenAI-compatible providers;
  keep `extractJson` as fallback (3/4 — manual parsing across 6 free models is brittle).
- **Length guard** (Claude found live): skip the money AI on long pastes (>~200 chars) — a paste of
  the team brief got misread as an 8 EGP expense.
- **Privacy — CORRECT THE CLAIM (honesty):** "nothing logged" is only true on M8's side; the live
  message IS sent to a free external provider that MAY log/retain it. Accurate statement + Muhammad
  re-confirms posture (accept / pin to one provider / strip numbers before the call).
- **Per-lane classifiers, shared plumbing** (3/4 vs Manus's generic) — share provider/timeout/JSON/
  validation; keep prompts per-domain (generic = "prompt soup" + free-model attention loss).
- **Future arbitrary-delete = hard invariant:** AI extracts SEARCH PARAMS only; deterministic code
  queries; count>1 → numbered list, user picks; AI never generates the row id.
- **Phase 4 Fleet RESHAPE (unanimous):** make Fleet HARDER to enter, not smarter. Unknowns →
  "unknown" → Phase 0, NEVER into fleet (false negative OK, false positive dangerous). Any fleet AI
  = READ-ONLY intents; fleet gets its own Phase 0 net. This is the real "make me rich" fix.

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
| **0 — Safety net** | **Deterministic, NO AI.** When a message hits a lane's keywords but no parser matches, reply plainly instead of looping. All lanes. | 🟢 none | The real screenshot cases ("remove the last expense", "what was the last expense Sara did") → clear message, no loop | ✅ **DONE** — live-confirmed EN + AR on his phone (Build-119 `08d801d` + AR fix Build-120 `29c0834`). Offline 12/12. Rollback → `422e97c`. |
| **1 — Wallet pilot + intent core** | Build the **reusable** intent classifier (domain+intent+entity, strict JSON), prove it on the money lane. Includes basic reference ("that/last"). | 🟢 low | messy money sentences all route right; deletes confirm-gated; never guesses between 2 matches | ✅ **DONE — live-verified on prod** (Build-121 `d1c1a11`). EN+AR messy adds understood (incl. a typo "غدا"), survived "yes", logged right; delete_last graceful; keyword path intact. Kill switch `M8_INTENT_BRAIN_DISABLED`. |
| **2 — Reference resolution** | Generalize "it / that / the last one / undo / scratch that" across lanes. | 🟢 low | reference phrases work | ✅ **DONE — LIVE-VERIFIED on prod** (m8-alpha `67c44e1` = Build-123 references + Build-124 privacy + Build-125 edit-yes fix). Confirmed on his device 2026-06-24: log → "change that to 40" → update card → "yes" → **"Done ✓ updated the last expense to 40 EGP."** Deterministic `parseReference`+`walletRefContext` resolve "it/that/last/undo/scratch/change-to-N" → last M8 write, gated on recent wallet context; edits confirm-gated, delete stays honest (no new power). Offline 48/48. Other lanes (tasks/notes) = Phase 3. |
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
- **2026-06-24 — Phase 0 DEPLOYED + live-tested.** Build-119 (`08d801d`) live; Muhammad tested on
  phone: EN money read+delete loops FIXED ✅, add-expense intact ✅. Two greedy-lane MIS-CLAIMS
  surfaced (not fall-through): AR delete → Tasks lane (fixed, Build-120 `29c0834`, deployed,
  awaiting AR re-test); "make me rich" → Fleet driver loop (DEFERRED to Phase 1 per Muhammad —
  fleet is the live job tool). Key lesson recorded above. Phase 0 ✅ once AR re-test passes.
- **2026-06-24 — Phase 1 BUILT** (branch `phase1-intent-brain`). `lib/intent-router.js`:
  `classifyMoneyIntent()` → fast free model (Groq-first), strict JSON {kind,amount,currency,
  category,note,confidence}, temp 0 / thinkingBudget 0 / 6s timeout, PRIVACY = live message only
  (his explicit choice), not logged, fail-safe → null. Wired as the wallet lane's 2nd-stage parser
  (keyword fast-path first; AI only on a miss + money-plausible). `pendingExpenseFromHistory` now
  reconstructs from the confirm prompt so AI-detected adds survive "yes". Kill switch
  `M8_INTENT_BRAIN_DISABLED=1`. Offline `tests/phase1-confirm-parse-test.ps1` 5/5. Live sheet
  `tests/PHASE1_LIVE_TEST.md`. NOT deployed — awaiting Muhammad's go.
- **2026-06-24 — Phase 1 DEPLOYED + live-verified ✅** (prod `d1c1a11`, m8-alpha). Verified on his
  laptop: "throw 30 egp to groceries", "put down fifty riyals for lunch", AND Arabic "حط ٥٠ ريال غدا"
  (with a typo) all understood → correct confirm → "yes" logged the right amount/category; keyword
  path ("add 50 sar lunch") unchanged; delete_last stayed honest. The intent brain works on the
  wallet, EN+AR, typo-tolerant. PROCESS NOTE: deploy needs an EXPLICIT yes — a preview build
  load-check (405 on /api/chat) caught nothing wrong but de-risked the un-syntax-checkable push;
  the wallet can't be tested on a preview (per-origin localStorage key + prod-only env) → prod is
  the only real test. NEXT: team round on the real Phase-1 code, then Phase 2 (reference resolution).
- **2026-06-24 — Phase 1.1 HARDENING built** (branch `phase1-hardening`) from the council round 2.
  (1) **Amount is now deterministic** — the model returns KIND+CATEGORY only; the figure is parsed
  from the text (never invented). Writes REQUIRE a real digit amount; none → clarify (deliberate
  trade: spelled-out "fifty" now asks for digits). (2) **Numeric sanity** cap (>0, ≤1,000,000).
  (3) **Length guard** — AI skipped on >200-char messages (fixes the paste-as-8-EGP bug).
  (4) **Native JSON mode** (`response_format`/`responseMimeType`) wired through `lib/llm.js`;
  `extractJson` kept as fallback. (5) **Privacy: amounts MASKED to "#"** before the provider call +
  the claim corrected to the honest version (provider may log the rest; M8 doesn't, and never sends
  stored data). Offline `tests/phase1-hardening-test.ps1` 8/8. Confidence float demoted to a coarse
  floor (0.5) — the real write-safety is the deterministic amount + confirm card (Gemini's point).
  FOUND (pre-existing, not fixed tonight): `parseAmountCurrency` turns "1,500" into 1.5 (comma→dot).
- **2026-06-24 — Build-122 DEPLOYED to prod** (`d4af231`, m8-alpha, preview-load-verified first).
  Live spot-check of the 3 lines (throw 30 egp / spelled-out / long paste) folded into the NEXT
  session's Step 1. NEXT = Phase 2 (reference resolution) in a fresh session, Opus·High.
- **2026-06-24 — Phase 2 BUILT** (branch `phase2-reference`, Build-123). Reference resolution on the
  WALLET lane: a deterministic resolver (no LLM) turns anaphoric commands into actions on the SINGLE
  last M8-added expense. New in `lib/orchestrator.js`: `refHasAnaphor` (pronoun / "the last one" /
  Arabic clitic verb), `parseReference` → `{action: edit|delete|show, amount}` (EDIT needs a real
  digit amount, DELETE never does, ≤80 chars so a paste isn't a reference), `walletRefContext(history)`
  (is the LAST turn a wallet reply? add_pending / edit_pending / recent / null), and
  `handleWalletReference` — wired *before* the Phase-1 intent brain. Edits reuse the existing
  confirm card; **delete stays honest** ("can't delete from chat… I can edit it / Wallet app") — NO
  new delete power (invariant). Tier-2: the intent-brain gate now also fires on a fuzzy anaphor when
  there's wallet context (`refish`), so phrasings the regex misses still reach `delete_last`/`edit_last`.
  GATING = the safety: references are claimed ONLY right after a wallet turn, so a stray "remove it" in
  a task/notes chat is not hijacked; only ever the single last write (never guesses). KEY JS LESSON:
  `\b` is ASCII-only in JS → a trailing `\b` after Arabic letters never matches; Arabic patterns use
  substring-on-stem instead. Offline `tests/phase2-reference-test.ps1` **32/32** (mirror gotcha hit +
  fixed: a helper named `H` was shadowed by the `Get-History` alias). Live sheet
  `tests/PHASE2_LIVE_TEST.md`. NOT deployed — awaiting Muhammad's live test, then explicit "go".
- **2026-06-24 — Build-124 PRIVACY FIX** (same branch, found during the Phase 2 live test). The live
  transcript showed the fall-through LLM echoing real expenses ("30 EGP groceries", "50 SAR lunch").
  ROOT CAUSE: `stripMoneyHistory` decided what to hide using the *keyword* parsers, which MISS the
  messy phrasings the Phase-1 brain understands ("throw 30 egp…", "put down fifty riyals…") → they
  leaked into the LLM history on a fall-through turn. FIX: also strip any user turn matching
  `_MONEY_PLAUSIBLE` (currency word / spend verb), EN+AR. Deterministic, one clause; over-strip only
  costs prior-turn LLM context (never the current turn). Residual (documented): a money sentence with
  NO currency word + a non-category number (e.g. "throw 30 to it") still slips — full closure needs the
  LLM, declined. Offline mirror extended → **39/39**. Deploying together with Build-123 (his "go").
- **2026-06-24 — Build-123 + Build-124 DEPLOYED to prod** (m8-alpha `2faa2a7`; he chose "deploy Phase 2 +
  privacy fix"). Merged `phase2-reference` → main (clean ff). Vercel prod build READY (12 lambdas);
  prod `/api/chat` GET → **405** (loads) on `m8-alpha.vercel.app`; alias confirmed on `2faa2a7`.
  Awaiting his live confirmation of the reference cases (`tests/PHASE2_LIVE_TEST.md`). Rollback →
  Vercel `d4af231`. NEXT = Phase 3 (tasks/notes).
- **2026-06-24 — Build-125 FIX (live test caught it).** Live: "change that to 40" gave the right update
  card, but replying "yes" looped ("What do you want to change to 40?"). ROOT CAUSE: `pendingEditFromHistory`
  re-parsed the user's words with the keyword `parseEditExpense` (which can't read reference phrasing) —
  the EDIT path never got the prompt-reconstruction the ADD path got in Phase 1. FIX: `parseConfirmEditPrompt`
  reconstructs {amount,category} from OUR "🧾 Update last expense (…) → 40 EGP?" prompt (post-arrow only,
  so the OLD value isn't grabbed); `pendingEditFromHistory` is now prompt-first. Also `parseEditTargetAmount`
  picks the figure AFTER "to" ("change the 30 to 40" → 40, not 30) — used by `parseReference` + the
  intent-brain edit path. Offline mirror → **48/48**. Deploying with his "go" still in effect for Phase 2.
- **2026-06-24 — Phase 2 LIVE-VERIFIED ✅ (prod `67c44e1`).** On his device: `throw 30 egp to groceries`
  → `yes` (logged) → `change that to 40` → `🧾 Update last expense (30 EGP · Groceries) → 40 EGP?` → `yes`
  → **"Done ✓ updated the last expense to 40 EGP."** Reference resolution + the edit-yes reconstruction
  both proven on real prod. Phase 2 CLOSED. NEXT = Phase 3 (tasks/notes), then Phase 4 (fleet harder to enter).
