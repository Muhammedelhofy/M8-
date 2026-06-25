# M8 — Team Round Brief (2026-06-25)

**For:** the AI Council — GPT · Grok · Gemini · Manus.
**From:** Muhammad (owner) + Claude Code (build agent).
**Ask:** review where M8 is after this session and propose the **highest-leverage next steps** to evolve it toward the vision. Be specific and rank your suggestions.

---

## 1. What M8 is (the North Star)

A dual-track personal system, prod at `m8-alpha.vercel.app` (Vercel Hobby, **hard cap 12 serverless functions**), Node, free-LLM stack (Groq/Gemini/Cerebras/etc.):

- **Track A — Personal AI OS:** an assistant that knows Muhammad's life (fleet business, personal finances, family, tasks/notes) and helps honestly.
- **Track B — Unsolved-Problem Engine:** a nightly Collatz/Lean math sidecar (parked-ish, free).

**Non-negotiable doctrine:** confirm-before-write · a hard **privacy wall** (money/financial data NEVER enters an LLM prompt or a log) · scoped DB keys · deterministic actions (code computes truth, the LLM only narrates) · "never claim more than we can back up."

## 2. What shipped this session (Builds 135→149, 2026-06-25)

15 builds, **168 PS-mirror tests, 0 failures, all Vercel deploys READY**, privacy wall held throughout.

- **Family Wallet → real personal-finance assistant** (read-only, code-computed): last expense · per-person ("Sara's", and pronouns "her"/"his" resolved from context) · specific dates + ranges ("this week", "in June", "between X and Y") · itemized "what for" (category + note, note shown to owner only, never to an LLM) · income/net · "where's the money going" (category insight, custom-category aware) · compare members · budgets/bills · "did I pay X?".
- **Family memory:** M8 now learns the people you name ("X is my wife/brother"), **knows the household**, and answers "who is Sara?" from memory instead of web-searching a generic name.
- **Memory hygiene:** profile/family facts are **never evicted**, transient junk (weather/price/score/daily-snapshot) is **blocked at write**, 17 stale rows purged.
- **Contradiction handling:** same-name conflicting facts are **flagged, never auto-merged** (the "two-Saras" lesson: could be two real people).
- **Proactive brief:** an opt-in, email-only Family Wallet section in the 7am brief (money stays out of the LLM-narrated path).

## 3. The architecture lesson (important for your suggestions)

M8's "**gets lost when one word is off**" failures were always **ROUTING, not the model**. The live design is a **hybrid intent router**:
1. deterministic **keyword parsers** (instant, free, broad) →
2. a free-LLM **intent brain** that fires only when parsers miss (understands messy/novel phrasing, maps to the SAME safe action) →
3. **context/anaphora resolution** ("her", "those 3 entries", "and Sara").

Actions stay deterministic + confirm-gated; the model never gets authority or sees money figures.

## 4. Open questions for the Council — please rank + justify

1. **Tasks ↔ wallet ↔ notes cross-domain (write side):** "remind me to pay rent" → a task enriched with the bill. Worth it, or premature? Safest design?
2. **Closing the routing gap:** novel phrasings still miss. Best free-stack approach to a self-widening router (log misses → auto-propose new routes) WITHOUT giving the LLM authority or risking the privacy wall?
3. **Proactive intelligence:** should M8 nudge ("Sara spent 2× on dining this week", "rent due in 3 days") — and through which channel (the existing email brief vs push)? Where's the privacy line?
4. **Memory evolution:** beyond hygiene — what makes memory genuinely *self-improving* on a free stack (contradiction resolution UX, decay, consolidation, semantic dedup)?
5. **Track A vs Track B focus:** Muhammad's #1 goal is landing a market-rate job (~July 2026). Which M8 investments compound toward that vs are nice-to-have?

## 5. Constraints to respect in any proposal
- Free-LLM stack by default (premium opt-in OFF); explain cost/benefit before any paid dependency.
- **12-function Vercel cap is FULL** — no new `api/*.js`; reuse `api/ops?fn=` consolidation.
- Privacy wall is absolute; deterministic actions; confirm-before-write.
- Each build ships a PS-5.1 test mirror (Node is absent on the host) + a live-test doc.

Return: a ranked list with a one-line rationale each, and call out anything you think we have wrong.
