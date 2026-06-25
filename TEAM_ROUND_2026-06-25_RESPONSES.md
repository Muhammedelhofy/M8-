# M8 Team Round — Council Responses (2026-06-25)

Companion to `TEAM_ROUND_2026-06-25.md`. Each member's ranked recommendations captured here.

---

## GPT — ranked recommendations

> "The biggest shift is not Family Wallet itself — it's that you crossed from *keyword-triggered tools* to *intent → deterministic action*. The second shift is the privacy wall: smarter without becoming less trustworthy."

| Rank | Investment | ROI |
|---|---|---|
| 1 | **Cross-domain entity linking** (wallet/tasks/notes/people/bills) — deterministic links only, LLM never creates links, confirm before linking | Massive |
| 2 | **Self-widening router** — `router_misses` table → nightly LLM suggests routes → human approves (model = route *advisor*, never owner) | Massive |
| 3 | **Career OS memory** (companies/contacts/interviews/CV versions/applications/follow-ups) — Track A wins *temporarily* given the 2026 job goal | Massive |
| 4 | **Proactive email intelligence** — YES for bills/unusual-spend/deadlines/follow-ups; NO to push/real-time; privacy line = *signals not amounts* ("rent due in 3 days", never the figure on a glanceable screen) | High |
| 5 | **Memory consolidation + confidence model** (confirmed 1.0 / inferred 0.5 / contradicted flagged; nightly cluster→merge→promote) | High |
| 6 | Research notebook persistence + retrieval hardening | High |
| 7 | Track B at ~20% allocation (shrink, don't kill) | Moderate |
| 8 | Lean / formal-verification expansion | Low for next 90 days |

**Where GPT says we're wrong:**
1. *"Novel-phrasing misses are the biggest remaining problem"* → GPT disagrees: it's now diminishing-returns; the **next ceiling is knowledge LINKING**, not routing. "Remind me to pay the thing Sara mentioned" fails on linking, not parsing.
2. *Lean is the next major investment* → resist; the order is **memory ≫ retrieval ≫ linking ≫ reasoning ≫ formal verification**.

**GPT's one-build pick for tomorrow:** "Entity Graph Build-1" — deterministic links between people, bills, tasks, notes, memories.

---

## Grok — (pending)
## Gemini — (pending)
## Manus — (pending)

---

## Claude (build agent) — synthesis + correction
- **Agree** with the architectural framing and the top cluster (linking + router + career).
- **Correction:** M8 already has an entity-graph foundation (`lib/entity-graph.js`, `m8_entities`, `getEntityCard`, B-83c/85b). So "Entity Graph Build-1" is **extend, not build from scratch** — cheaper than assumed. Constraint: **Vercel 12-function cap is FULL** → do it inside existing modules + new Supabase tables, no new `api/*.js`.
- **GPT moved my ranking:** I under-weighted **Career OS**. Given Muhammad's #1 goal (market-rate job ~July 2026), it's the build that most compounds toward what actually matters — and it *rides on* the entity-linking layer (companies/contacts/follow-ups are entities). So sequence: **entity-linking foundation → Career OS on top.**
- **Hold both** on the routing debate: GPT is right that linking is the bigger capability jump, but the miss-logger is *cheap* telemetry (no authority, low risk) — run it in parallel, not instead.
- **Track B:** keep as the free nightly sidecar (Muhammad's standing instruction); GPT's "shrink not kill / ~20%" is compatible. Do not re-litigate park/kill.
