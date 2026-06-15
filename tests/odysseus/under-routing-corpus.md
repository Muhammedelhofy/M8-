# Search Under-Routing Corpus (backlog #12)

**Purpose.** The honest, hand-built list of real example questions that drives the
under-routing fix. Two classes, deliberately balanced:

- **MUST-SEARCH (misses):** checkable, current/real-world fact questions that the
  regex classifier currently leaves as `NONE`. On `NONE` they fall to the LLM
  tool-decision router (`lib/router.js`), which *may* answer from training and be
  wrong. These are the under-routed queries we want to ground.
- **MUST-NOT-SEARCH (true negatives):** conceptual, creative, advisory, or personal
  questions that *also* land in `NONE` and **must stay there** — searching them makes
  answers worse (the trap). The fix must not touch these.

**The trap (why this is judgement, not a big regex):** the classifier already
over-routes broadly — anything matching `what is / explain / how does` → RESEARCH →
search. So the *only* safe place to widen is the genuine `NONE` fall-through, and only
for question *shapes* that are almost always checkable external facts. Every widening
adds low-quality-web-answer risk, so we widen by high-precision shape, not topic.

**Why these specific shapes survive to `NONE` today.** The existing `FACT_CHECK`
verb-pattern `did .*(launch|open|acqui|...)` already catches "when **did** X launch".
What slips through is the *non-`did`* / *non-verb-listed* phrasings of the same
checkable facts:
- `when was / were X founded|completed|...` (perfect tense, no "did", verb not in the FACT_CHECK list)
- `who founded|owns|acquired|developed|... X` (no "did", starts with "who")
- `who is the [current] CEO|founder|minister|... of X` (entity-attribute lookup)
- `what|which year ...` (year-of-event)

These are exactly the future-tense `when is/does/will` cases that LIVE_DATA *already*
routes — the past/perfect-tense and who/role siblings were simply never added. The fix
closes that asymmetry. Self-status (`did you/we ship…`) and personal (`my fleet`)
guards run first and still pre-empt, so "when did **we** ship X" / "who owns **my**
data" never get stolen.

---

## MUST-SEARCH (currently NONE → answered from training; should ground)

| # | Question | Why checkable | Caught by new tier |
|---|----------|---------------|--------------------|
| 1 | when was bolt food founded | company founding date — verifiable, niche | `when was` |
| 2 | who founded keeta | real founder of a named company | `who founded` |
| 3 | who is the ceo of careem | current officeholder — changes over time | `who is the ceo of` |
| 4 | what year did aramco go public | event year ("go public" not in FACT_CHECK verbs) | `what year` |
| 5 | who owns the noon app | ownership of a named company | `who owns` |
| 6 | who is the current ceo of uber | current officeholder ("current" ≠ a news token) | `who is the current ceo` |
| 7 | when was the riyadh metro completed | completion date ("completed" not a FACT_CHECK verb) | `when was` |
| 8 | who acquired careem | M&A fact (no "did" → misses FACT_CHECK) | `who acquired` |
| 9 | what year was aramco's ipo | event year | `what year` |
| 10 | who developed the keeta platform | builder of a named product | `who developed` |

All 10 route to **NONE before** the fix, **LOOKUP after** (proven by the mirror test).

## MUST-NOT-SEARCH (currently NONE; must stay NONE — the safety set)

| # | Question | Why it must stay local |
|---|----------|------------------------|
| 1 | why is the sky blue | stable explanatory knowledge ("why" not a search shape) |
| 2 | write a haiku about the desert | creative generation |
| 3 | give me three ideas to motivate my drivers | advice + personal (`my drivers`) |
| 4 | tell me a joke | chat |
| 5 | what's a good morning routine | advice (not a fact lookup) |
| 6 | should i raise driver pay | judgement/advice |
| 7 | draft a short thank-you message to my top driver | generation, personal-ish |
| 8 | suggest a name for my fleet dashboard | creative + personal (`my fleet`) |
| 9 | what should i name my new bike model | creative |
| 10 | remind me to call the workshop | operational/chat |
| 11 | i feel stuck, any advice on growing the business | advice |
| 12 | make my drivers a motivational poster | generation + personal (`my drivers`) |

All 12 route to **NONE before AND after** the fix (proven by the mirror test).

---

## The conservative widening (one new tier, last before NONE)

_(Backlog #12 / Build-40 follow-up — NOT Build-43, which is reserved for the
problem-solving engine.)_

`CHECKABLE_FACT_RE` in `lib/intentClassifier.js`, evaluated **after** every existing
intent and after the personal/self-status guards, **immediately before** the `NONE`
fall-through, so it can only ever catch genuine fall-throughs (never steals an existing
route). Routes to `LOOKUP` (specific-answer fetch). Negative lookahead drops the
self/personal temporal case (`when did i/you/we/my/our …`).

Proof: `tests/under-routing-verify.ps1` (full-classifier PS mirror, before/after).
