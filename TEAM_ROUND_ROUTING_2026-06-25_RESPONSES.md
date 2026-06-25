# M8 Team Round — Routing Architecture: Council Replies + Synthesis (2026-06-25)

**Companion to:** `TEAM_ROUND_ROUTING_2026-06-25.md` (the problem statement).
**Author of synthesis:** Claude Code (build agent), after reading the live source
(`lib/orchestrator.js`, `lib/fleet.js`, `lib/intent-router.js`, `lib/miss-logger.js`).
**Council:** GPT · Grok · Gemini · Manus.
**Status:** PROPOSAL — awaiting Muhammad's OK before any code.

---

## 0. TL;DR

The council is **unanimous on the big call, and it is NOT the brief's call.** The brief
proposed *"the FIRST step on (almost) every turn is a small LLM classifier."* All three
responders (GPT, Grok, Gemini) independently say: **do not put the LLM at the literal
front door.** Keep the deterministic keyword fast-path for the obvious ~80%; make the LLM
the **semantic safety-net / arbiter** for the contested or missed ~20%. Migrate in
**shadow mode** (run the new router silently, log deltas, prove it, then flip per-domain).

My recommendation **adopts the council's cascade** and refines it with two things the
source code reveals that the council couldn't see:

1. The existing **intent brain is gated OUT exactly when it's needed** (`!looksFleet(m)`),
   and the wallet⇄fleet arbitration is **scattered across ~14 lanes** as per-lane
   `!looksFleet` guards. The fix is a **single Domain Arbiter**, not LLM-first.
2. The **miss-log is empty (0 rows) AND structurally cannot capture the wallet→fleet
   misroute** — so "test against the real miss-log" is not yet possible. We must widen
   logging *first*, or the rollout is flying blind.

**My pick: a Tiered Cascade with one shared Domain Arbiter, shadow-first, wallet⇄fleet
boundary only to start.** Details in §4–§5.

---

## 1. Council replies (logged)

### 1.1 GPT — "Hybrid Cascade, not LLM-first. Several failures are CONTEXT failures."

**Ranking:**
1. **Hybrid Cascade Router** (Keyword fast-path → LLM intent brain → Clarifier) — *recommended.*
2. Embedding-based intent matching — good as a *signal inside* the router, bad as the sole router (great at "same meaning / different words", weak at wallet-vs-fleet, owner-vs-Sara, read-vs-write).
3. The brief's full front-door LLM brain — already much better than today, but ranked #3 because classifying *every* turn becomes wasteful as abilities grow (`last expense`, `what bills are due` don't need an LLM).
4. Grammar / FSM — fine for `add expense / delete task / confirm`; dies on "what did I spend around the time Sara paid the school fee?".
5. Fine-tune — **don't.** Free-stack + maintenance + changing menu. "Your router problem is architectural, not model-quality."

**Unique, highest-value insight:** *Some of the cited failures are not routing failures —
they are context-resolution failures.* "breakdown of the 497 SAR" and "what's the
breakdown?" after M8 said "497 SAR" → M8 routed fine initially, then **forgot its own
number**. No router fixes that. He insists the order must be
**Context resolution → Route selection → Deterministic execution**, and the schema needs a
`references` block (amount/source_domain/turn), resolved *before* routing.

**Other points:** Deterministic **ownership layer** (each domain owns vocabulary; LLM
decides only when BOTH wallet+fleet evidence present). **Confidence ladder** (>90% act;
70–90% act + state assumption; <70% ask). **Capability drift** is the real long-term
risk: *generate the router's action menu from capability definitions, not a hand-kept
prompt* — else in 6 months "router knows 25 actions, wallet has 40" = today's problem one
level up. **Migration:** shadow mode → measure on miss-log → wallet-only → global.

**Single biggest risk (GPT):** capability drift (hand-maintained menu becomes the new
keyword problem).

---

### 1.2 Grok — "Viable but suboptimal; prefer keyword + embeddings + LLM-last. Don't let it become a months-long refactor."

**Ranking:**
1. **Hybrid: keyword fast-path + pgvector embeddings (semantic intent match) + narrow LLM fallback** — best balance for a free stack; embed example utterances per action/domain (reuse the miss-log), nearest-match → handler, LLM only on low similarity / anaphora.
2. The brief's front-door LLM classifier — good for complex cross-domain, but higher per-turn cost/latency on free models + routing drift if the model changes; use as *final* fallback.
3. Rule/FSM + expanded keywords + miss-driven auto-updates — deterministic safety net, still brittle on novel phrasing.
4. Embeddings-only (no LLM) — fast/cheap, weak on multi-turn anaphora without extra state.

**Points:** One classifier call per turn is **risky on free quotas/latency** — keep a
strong keyword fast-path for 70–80%, embeddings next, LLM last. Wallet-vs-fleet:
**explicit domain separation in the schema** ("my spend" vs "fleet P&L"); never auto-decide
money on low confidence — **ask**. Use **last 2–3 turns** for context. Migration: embed
examples in Supabase, shadow-test on traces/miss-log, flip per-domain, keep all 168 tests.

**Single biggest risk (Grok):** the refactor becomes a **months-long distraction from the
#1 priority (job search ~July 2026)**. "Don't let this become a months-long refactor."

---

### 1.3 Gemini — "Tiered cascade. Broaden the existing intent brain to all domains as the GLOBAL fallback. Shadow first. Beware schema bloat."

**Ranked verdicts:**
1. **Migration = SHADOW MODE** (highest priority) — don't flip overnight; run new JSON router in background, log deltas, prove it beats today before giving it authority.
2. **Latency/quota = KEEP THE FAST PATH** — an LLM front-door "destroys your free-tier quota and UX latency"; keep keyword parsers for the obvious 80%, LLM is the net for the 20%.
3. **Architecture = TIERED CASCADE** — broaden the *existing* LLM intent brain to all domains (over embeddings / fine-tune, which violate low-complexity + free-stack).
4. **Wallet vs fleet = STRICT SCHEMA GATING** — force a `target_domain` key; if markers absent ("Bolt/riders" vs "lunch/Sara"), schema logic forces clarification.
5. **Over-asking = CONFIDENCE THRESHOLD** — temperature 0, strict threshold, ask only when low-confidence AND domain ambiguous.

**Points:** Skip embeddings ("great for finding documents, terrible for extracting
parameters like amount:497, period:June") and fine-tune. Winner = a single fast LLM call
with `response_format: json_object` / `responseSchema`. Pass last 2–3 turns for anaphora;
if cold-start ambiguous → `action:"clarify", question:"…wallet or fleet?"`.

**Single biggest risk (Gemini):** **JSON-schema bloat → free-tier attention degradation.**
Packing 15 wallet + fleet + tasks + notes intents into one prompt makes small free models
drop params / hallucinate routes. **Keep the menu consolidated** — coarse
`["create","read","update","delete"] × ["wallet","fleet","task"]`, not 50 micro-intents.

---

### 1.4 Manus — no reply ("limited now, can't give answers").

---

## 2. Consensus matrix

| # | Question | GPT | Grok | Gemini | **Consensus** |
|---|----------|-----|------|--------|---------------|
| 1 | LLM front-door, or better pattern? | Hybrid cascade (LLM = recovery, not first) | Keyword + embeddings + LLM-last | Tiered cascade (broaden intent brain) | **Tiered cascade. LLM is the fallback/arbiter, NOT first.** Brief's "LLM first every turn" rejected 3–0. |
| 2 | One LLM call/turn — OK on free stack? | No — fast-path the obvious cases | No — quota/latency trap | No — "destroys quota & latency" | **No. Keep deterministic fast-path for ~80%.** Unanimous. |
| 3 | Wallet-vs-fleet split; when to ask? | Deterministic ownership scores; LLM only when both fire; confidence ladder | Explicit domain separation; never auto-decide money; ask on low conf | Strict `target_domain` gating; clarify when markers absent | **Deterministic ownership scoring decides the clear cases; ASK when contested or low-confidence; never auto-guess money.** |
| 4 | Clarify only when truly ambiguous? | Confidence ladder (>90/70–90/<70) | Threshold + 2–3 turn history | Threshold + temp 0 + last 2–3 turns | **Confidence threshold + conversation history; ask is the *last* resort, not the default.** |
| 5 | Migration without regressing 168? | Shadow → measure → wallet-only → global | Shadow-test → per-domain flip | **Shadow mode (top priority)** → swap | **Shadow mode first, then per-domain flip. Unanimous + emphatic.** |
| — | **Biggest risk** | Capability drift (hand-kept menu) | Months-long refactor vs job-search | JSON-schema bloat on free models | **Three distinct risks — all real; mitigations in §5.** |

**Where they diverge (the only real fork):** the *mechanism* of the semantic layer.
- **Gemini & GPT:** one consolidated JSON **LLM** classifier.
- **Grok:** **pgvector embeddings** first, LLM last.
- GPT treats embeddings as a *signal*, not the router; Gemini rejects embeddings outright
  ("terrible at extracting amount/period").

---

## 3. What the source code reveals (independent findings)

I read the live router. Four facts change the framing — none were visible to the council:

### 3.1 The intent brain is gated OUT exactly when it's needed
`lib/orchestrator.js:2440` — the Phase-1 intent brain only fires when
`_MONEY_PLAUSIBLE.test(m) && !looksFleet(m) && !looksFinance(m)`. So when the **greedy**
`looksFleet` matches (it has ~30 patterns incl. `/\brevenue\b/`, `/\bhow much\b.*\b(make|made|earn|earned)\b/`,
net/gross-near-a-time-word), the semantic rescue is **suppressed**, and the turn falls
through to the fleet context builder. **The greedy fleet lane both steals the turn AND
disables the layer meant to catch the mistake.** This is the mechanical root cause.

### 3.2 Wallet⇄fleet arbitration is scattered, asymmetric, per-lane
Every wallet lane self-guards with `!looksFleet(m)` (e.g. the Build-151 breakdown lane,
`:2139`; the capability fallback, `:2552`). The fleet side has **no symmetric guard** — it
runs on a plain regex gate (`buildFleetContext`) downstream. There is **no single
arbiter**; arbitration is duplicated ~14 times and must be re-remembered for every new
ability. **That is the whack-a-mole, precisely.**

### 3.3 The miss-log is EMPTY and can't capture the failure we care about
`m8_router_misses` = **0 rows** (queried live). Worse: `logMiss` is called from exactly one
place — the Phase-0 safety net (`:3159`), which only fires when **no lane answered**. A
wallet→fleet misroute produces a *confident wrong answer from the fleet lane* — it never
reaches Phase-0, so **it is never logged.** ⇒ "test against the real miss-log" is not
possible today, and the current logger structurally misses the target class. **We must
widen logging before/at the start of the build, or we have no ground truth.**

### 3.4 There are TWO dispatch sites, not one
`orchestrate()` (`:2996`, non-streaming) and `orchestrateStream()` (`:4959`, streaming)
**both** re-run the same lane order (tasks→wallet→notes→fleet). Any router change must be a
**single shared function called from both**, or the streaming path silently diverges.
(Good news: this is also the natural seam to factor the arbiter into.)

**Conclusion from the code:** the problem is not "keyword parsing is bad." The 14 wallet
lanes are *correct and working*. The problem is **arbitration + a suppressed rescue layer**.
That argues for a *surgical* arbiter, not a rewrite — which also answers Grok's
"don't let it become a months-long refactor."

---

## 4. Recommendation

> **Build a Tiered Cascade with one shared Domain Arbiter. LLM is the arbiter of the
> contested middle — never the front door. Ship wallet⇄fleet first, in shadow mode.**

### 4.1 The cascade (runs once, shared by both dispatch sites)

| Stage | What | LLM? | Notes |
|-------|------|------|-------|
| **0. Context resolution** | Resolve anaphora *before* routing: inherit domain+subject+period from the last turn for bare follow-ups ("what's the breakdown?", "and Sara?", "why?"). | No | GPT's point. **Mostly already exists** — `walletRefContext`, `lastWalletQueryContext`, `topicMemoryRoute`, `resolveMemberCtx`. We *consolidate*, not rebuild. |
| **1. Deterministic fast-path** | The existing keyword lanes. If one **confidently** answers → done. | No | The ~80%. **Unchanged → protects the 168.** |
| **2. Domain Arbiter** | Fires only on **contested** (≥2 domains score) or **missed-but-plausibly-a-command** turns. Deterministic ownership *scores* first; one free-LLM JSON call only for the genuinely ambiguous middle. | Sometimes | The new piece. Replaces the scattered `!looksFleet` guards with ONE decision. |
| **3. Clarifier** | Low-confidence / both-domains → **ASK** ("personal wallet or the fleet?") and remember the pending question so the next message resolves it. | No | Build-151 already does this for breakdown; generalize it. |

This is exactly the shape GPT, Grok, and Gemini converged on. The **one** difference from
the brief: the LLM is **Stage 2, gated**, not Stage 0 on every turn.

### 4.2 Ranked vs the alternatives (honest)

| Rank | Option | Verdict | Why |
|------|--------|---------|-----|
| **1** | **Tiered cascade + single arbiter (this)** | ✅ **Recommended** | Keeps the working 80% free/instant; one arbiter kills the scattered-guard whack-a-mole; LLM cost only on hard turns; shadow-able; surgical (not a rewrite). |
| 2 | Brief's LLM-first front door | ⚠️ Rejected as-is | 3–0 council: free-tier quota/latency, and it would re-classify turns the keyword lanes already nail (regression + over-ask risk). Its *intent* (meaning, ask-when-ambiguous) is preserved by option 1. |
| 3 | + pgvector embeddings layer (Grok) | ⏸️ Defer | Adds infra (pgvector) + an examples corpus to maintain, and is weakest exactly at wallet-vs-fleet / owner-vs-Sara. Revisit only if the JSON classifier proves unreliable. Honest upside: cacheable per-phrase, fully free at inference. |
| 4 | Grammar/FSM | ❌ No | Dies on compositional phrasing; we already have parsers. |
| 5 | Fine-tune | ❌ No | Violates free-stack; menu changes constantly; it's an architecture problem, not model quality (GPT). |

### 4.3 Honest limits I accept
- It will still mis-route sometimes (no router is 100%). The safety valve is **ask**, not
  silent drift.
- A free-LLM call on hard turns adds latency/quota — bounded by only firing on the
  contested/missed minority (and a kill switch).
- The arbiter is a *second* opinion next to the keyword lanes; if it over-fires it can turn
  a correct silent answer into an annoying "which did you mean?" — see §5 risk + the
  shadow-mode gate that exists to catch exactly this before any flip.

---

## 5. Build scope (precise)

### 5.1 What the classifier/arbiter returns
A strict JSON proposal — **coarse menu** (Gemini's anti-bloat rule), built **from a
capability registry** (GPT's anti-drift rule):

```jsonc
{
  "domain":  "wallet" | "fleet" | "tasks" | "notes" | "docs" | "chat",
  "action":  "read" | "add" | "edit" | "delete" | "compare" | "breakdown", // coarse, registry-defined
  "subject": "owner" | "member" | "household" | null,   // never a raw name from the model
  "period":  "this_month" | "last_month" | "range" | "date" | null,
  "confidence": 0.0-1.0,
  "ambiguous": true | false
}
```
- **The model picks the ROUTE only.** No amounts, no figures, no names-as-data — those are
  parsed deterministically by the caller (unchanged privacy wall; `intent-router.js`
  already masks digits to `#`).
- `CAPABILITY_REGISTRY` = one small constant: `domain → [actions]`. The classifier prompt
  is generated from it, and the dispatch map reads from it. **One source of truth** so a
  new ability is one registry line, not a new parser + a new `!looksFleet` guard.

### 5.2 How it routes into existing handlers (no new authority)
The arbiter **does not execute** — it returns a domain, and the caller dispatches to the
**same** handlers that exist today:
- `wallet` → `handleWalletCommand(...)` (its 14 lanes do the real work + the privacy-safe
  computation).
- `fleet` → `buildFleetContext(...)`.
- `tasks` → `handleTasksCommand(...)`; `notes` → `handleNotesCommand(...)`.
- `ambiguous` → return the clarifier question (no handler).

Writes stay **confirm-gated**; the scoped DB key is unchanged. AI proposes, locked code
disposes — exactly today's contract.

### 5.3 Test plan (given the miss-log is empty)
1. **Corpus, hand-built first** (`tests/routing_corpus.jsonl`): every documented failure
   (the 497 SAR, "my spend"→household, "breakdown…June"→fleet) + the 12 BUILD151 stress
   lines + ~40 paraphrases (typos, synonyms, Arabic, owner/Sara/household, wallet⇄fleet
   near-misses). Each row: `{ message, history?, expect_domain, expect_action?, expect_ask? }`.
2. **PS-5.1 mirror** (Node is absent): mirror the arbiter's *deterministic* scoring +
   dispatch decision in PowerShell; assert each corpus row routes correctly. The LLM leg is
   stubbed in the mirror (we test the routing logic, not the model).
3. **No-regression suite:** assert the existing keyword lanes still answer the ~168 known-good
   phrasings unchanged (fast-path must win before the arbiter ever runs).
4. **Then the real miss-log becomes the test set** — but only after §5.4 step A widens it.

### 5.4 Incremental rollout (the part that can't regress)
Each step ships behind a **kill switch**, off a branch from `origin/main`, with a PS mirror
+ a live phone test, **no push without your explicit OK**.

| Step | Build | What ships | Behavior change | Proof before next step |
|------|-------|-----------|-----------------|------------------------|
| **A** | B-152a | **Widen logging + Shadow Arbiter.** Build the arbiter; run it *after* the live router decides; log `{live_route, shadow_route, agree, confidence}` to the (widened) miss table. Also start logging wallet→fleet decisions. | **NONE** — pure observation. | A few days of *his* real traffic; review agree-rate + the disagreements. |
| **B** | B-152b | **Wallet⇄fleet arbiter LIVE**, scoped to that boundary only. Replace the scattered `!looksFleet` guards + the suppressed intent-brain gate with the single arbiter, on the wallet/fleet seam. | Wallet questions stop drifting to fleet; ambiguous → ASK. | Shadow data shows agreement ≥ bar; corpus + no-regression green; live phone pass. |
| **C** | B-152c | **Broaden to tasks/notes/docs.** | Full cascade. | Same gates. |

Shadow mode is the council's unanimous #1 and the answer to "can't regress the 168": for
days B and beyond, the new path only goes live where the shadow data has already proven it
agrees (or correctly *improves on*) the old path.

---

## 6. Biggest risk + open decisions for Muhammad

**The biggest risk I see (distinct from the council's three, which we also mitigate):**
the arbiter becomes a *second source of truth* that "helpfully" re-arbitrates turns the
keyword lanes already answered correctly — turning a correct silent answer into an
"which did you mean?" (he hates over-asking) or a new subtle misroute. **Mitigation is
structural:** the arbiter runs *only after* confident fast-path lanes, *only* on
contested/missed turns, and **shadow mode must prove the agree-rate on his real traffic
before any flip.** Plus a kill switch per step.

**Council risks, folded in:** capability drift → `CAPABILITY_REGISTRY` single source
(GPT); schema bloat → coarse menu, not 50 intents (Gemini); months-long refactor →
**surgical** wallet⇄fleet-first scope, not a rewrite (Grok).

**Decisions — RESOLVED by Muhammad (2026-06-25):**
1. **Stage-2 mechanism → JSON LLM classifier.** One free-LLM call, built from the
   `CAPABILITY_REGISTRY`. Embeddings (pgvector) **deferred** — revisit only if the classifier
   proves unreliable.
2. **First live scope → wallet⇄fleet boundary only** (B-152b). Tasks/notes/docs follow in
   B-152c after wallet/fleet is stable.
3. **Shadow gate → until ~30–50 real misses logged.** Flip B-152b on data volume from his
   real phone traffic, not a fixed calendar window.

### Locked spec for B-152a (first build — pure observation, zero behavior change)
- Add a **shared** `arbitrateDomain(message, ctx)` (deterministic ownership scoring + the
  JSON classifier seam) — called from BOTH `orchestrate()` and `orchestrateStream()`.
- Run it in **shadow** *after* the live router decides; **do not act on it.**
- **Widen logging** so `m8_router_misses` (or a sibling table) records
  `{ live_route, shadow_route, agree, confidence, ambiguous }` for wallet/fleet turns —
  fixing the §3.3 blind spot. Redaction/privacy contract unchanged (digits/currency/money
  nouns stripped; message-only; no figures ever).
- Kill switch + PS-5.1 mirror (`tests/routing_corpus.jsonl` + dispatch mirror) + a live
  phone test. Branch off `origin/main`. **No push without explicit OK.**

---

*Prepared 2026-06-25. No code written. Forks resolved (all three = recommended). Ready to
start B-152a on Muhammad's go-ahead.*
