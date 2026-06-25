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

## Grok — ranked
1. **Routing self-widening + miss logger (Build 150, 1–2 days)** — single point of fragility; fixing it amplifies everything. Log misses (no PII/money) → weekly consolidation → human approves new patterns.
2. **Job Search Module (151–153)** — career context store + LinkedIn drafts + application tracker + interview Q&A from ops experience + tailored CVs. Reuses companies/playbooks libs. Measure apps/week + response rate.
3. **Gated tasks↔wallet enrichment (154)** — parser + confirm; bill link as FK; no money in LLM.
4. **Memory consolidation batch (155)** — dedup/contradiction proposals on profile facts; pgvector on profile facts only.
5. **Proactive brief + opt-in nudges (156)** — email for wallet; push only for non-financial; aggregated, no raw figures.
> "Track A 80/20 until job landed. Job search is the forcing function. Every new cross-domain link increases leak surface — measure it."

## Gemini — ranked (brutally pragmatic)
1. **Track A focus → Career CRM — BUILD.** Repurpose the entity-memory ("Sara is my wife") logic for Network & Interview memory (recruiters, target companies, application statuses). "What did I discuss with Ahmed at Company X?"
2. **Proactive nudges — BUILD (email only).** Deterministic SQL thresholds inject a *pre-computed static string* into the 7am email; the LLM stays blind. No push (needs PWA SW / paid SMS).
3. **Routing gap — BUILD (async log).** Low-confidence → log raw msg + category → weekly cluster → you paste approved regex. AI suggests, owner commits.
4. **Memory evolution — DEFER.** Semantic dedup is an infra black hole; let the manual flag-and-ask ride.
5. **Cross-domain writes — KILL.** Task↔transaction = rollback/state-corruption trap; keep domains fiercely decoupled.
> Open question back to you: how do you want to define the static thresholds for the email alerts so they don't become daily noise?

## Manus — full spec (one item, deep): Self-Widening Intent Router
A human-in-the-loop spec: an **Intent Miss Logger** fires when `classifyIntent()` returns `unknown` or `confidence < ~0.4` AND Phase-0 safety net didn't handle it → logs to a misses store → weekly review → **Knowledge Integration** converts your feedback into new keyword rules / few-shot examples. AI proposes, owner commits. (Spec was cut off mid-document but the design is unambiguous.)

---

## COUNCIL CONSENSUS MATRIX

| Initiative | GPT | Grok | Gemini | Manus | Verdict |
|---|---|---|---|---|---|
| **Self-widening router / miss-logger** | #2 | **#1** | #3 | **full spec** | ✅ **UNANIMOUS — build FIRST** |
| **Career OS / job module** | #3 | #2 | **#1** | — | ✅ **STRONG — serves the #1 goal** |
| **Proactive email-only nudges** | #4 | #3 | #2 | — | ✅ yes; email-only; signals not amounts |
| Cross-domain task↔wallet **writes** | #1 (gated) | gated #3 | **KILL** | — | ❌ **SPLIT — park; if ever, read-only FK links, never shared mutable state** |
| Memory consolidation | #5 | #4 (light) | DEFER | — | ⚠️ split → lean DEFER (light pgvector on profile facts only, if any) |
| Track B (Collatz/Lean) | 20% | 20% | frozen | — | ✅ minimal free sidecar |
| Lean / formal verification | defer | defer | defer | — | ✅ defer 90 days |

## Claude (build agent) — synthesis (the council corrected my first pick)
- I led with **entity-linking first**; the council **out-voted that**. The consensus first build is the **miss-logger** (unanimous, ~1–2 days, Manus has the spec, lowest risk).
- **Gemini's KILL on cross-domain *writes* is the key risk signal** — and it reconciles with GPT/Grok: cross-domain **read-only references** (a task that *links* a bill by id, confirm-gated) are fine; **shared mutable state** (task that creates/rolls-back a transaction) is the trap. So: park the write-coupling; the value (relationship context) is mostly read-side anyway.
- **Career OS is the clear #2** and the one that serves Muhammad's actual #1 goal (job ~July 2026). It reuses the existing entity-memory + companies/registry libs.
- **Constraint reminders for whoever builds:** Vercel 12-function cap is FULL (reuse `api/ops?fn=`); privacy wall absolute; AI proposes/owner commits; PS-5.1 test mirror per build.
- **Recommended sequence:** Build-150 miss-logger → Build-151+ Career OS → email nudges (define thresholds w/ Muhammad) → (later, if at all) read-only cross-domain links. Track B stays the free sidecar; Lean deferred.
