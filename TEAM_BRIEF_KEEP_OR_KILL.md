# Team Brief — Keep, Narrow, or Kill M8?

**To:** GPT-5, Gemini, Manus, Grok (independent second opinions)
**From:** Muhammad (operations manager, aspiring business owner) + his Claude Code partner
**Date:** 2026-06-20
**Decision needed:** Should M8 continue to exist? If yes, doing exactly what — and what should we kill?

This is a **kill-or-keep** review, not a "how do we improve it" review. Be blunt. Muhammad is not convinced M8 earns its place. Do not flatter the project. If the right answer is "park it and use off-the-shelf tools," say that.

---

## 1. Who Muhammad is

- **Operations manager** at a Bolt ride-hailing fleet in Saudi Arabia. Good at running operations.
- **Ambition:** build his own business. Currently exploring an **ecommerce project** (being built in Claude "cowork").
- **Not an engineer.** Needs click-by-click steps. Every build costs HIS time and attention — his scarcest resource.
- **Pain point in his words:** "I'm tired of chasing something that won't make a difference. If I can trust M8 to keep me safe, I can depend on it. I'm totally messed out and need a clear goal to chase."
- **Wants from M8:** a thinking partner that knows him, challenges his ideas before he commits money/time, remembers past decisions, and keeps running without him. He also does NOT want to abandon a long-term side-goal: an engine that works on unsolved math problems.

## 2. Tools Muhammad already has (paid/free, no extra cost)

- **Claude** (this, + "cowork" Projects) — thinking, code, can hold per-project context/memory.
- **Gemini API** — free tier; currently powers M8's LLM calls at zero cost.
- **NotebookLM** — summarizing PDFs/books.

The strategic worry: **M8 may be duplicating tools he already has, and losing on quality.**

## 3. What M8 actually is today

A self-hosted personal AI system (Node serverless on Vercel + Supabase Postgres). 104 builds. Components:

- **Live fleet sync (real, working):** cron pulls Bolt Fleet API nightly → stores per-driver orders/earnings/hours in Supabase. No manual CSV. Just shipped.
- **Morning brief (real, working):** emails Muhammad a daily fleet summary + Bolt bonus-tier pace (Resend → his Gmail).
- **Chat box:** routes questions to a cascade of free LLMs (Gemini/Groq/Cerebras/etc.) with his fleet + finance context injected.
- **Driver cost profiles:** per-driver rental/salary/fuel in Supabase → real per-driver P&L.
- **Unsolved-problem engine:** nightly autonomous loop that generates math conjectures (Collatz, Lychrel) and machine-verifies small Lean proof leaves. Runs on its own, costs nothing, banks results. (Long-game / passion project.)
- **Owned memory:** structured facts in his own Supabase — unbounded, queryable, portable, exportable.

### What's weak / dead weight
- 0 books ever successfully ingested (knowledge-graph ambition never materialized — NotebookLM does this better anyway).
- ~6 dormant DB migrations, several half-used features.
- The chat box loses to Claude on answer quality.

## 4. The core strategic hypothesis we want you to judge

> **M8 should STOP trying to be a smarter chat box (it loses to Claude), and instead be the LAYER UNDERNEATH the tools Muhammad already uses** — holding his persistent context, running autonomously, pulling live data — then feeding Claude/Gemini better context on demand.

The argument is that a Claude Project CANNOT do three things M8 can:
1. **Run without him** (cron: 7am email, midnight fleet sync) — Claude Projects can't fire scheduled jobs.
2. **Pull live data unprompted** (Bolt API → today's numbers) — Claude Projects only know what's pasted in.
3. **Own the memory** (his Supabase: unbounded, structured, portable across any future business, exportable) — vs a walled-garden Project memory he doesn't own.

Everything else M8 does is arguably better done by Claude/NotebookLM.

## 5. The live test case: the ecommerce project

Muhammad is starting an ecommerce business in Claude cowork. We want to use it as the **first real test of M8's value**:
- Heavy lifting (research, build, copy) stays in Claude cowork.
- M8 holds the **decision context**: capital available, risk appetite, time-vs-fleet tradeoff, what he decided and WHY — so it survives across sessions and informs the next call.
- Question: is this a genuinely useful division of labor, or just overhead?

## 6. Constraints

- **No new paid APIs.** Must run on free Gemini + existing infra. (He pays for Claude already.)
- **Minimal maintenance.** Builds cost his time; he wants few, high-leverage ones.
- **Must survive a business pivot.** If he leaves the fleet for ecommerce, M8 must not become dead weight. (This killed the "fleet-autopilot-only" idea — too tied to current job.)

---

## What we need from each of you

Answer these four. Be specific and blunt.

1. **Keep, narrow, or kill?** Given he already has Claude (+Projects), Gemini, and NotebookLM — does M8 earn its place, or is it redundant? If kill/park, say so plainly.

2. **The ONE thing M8 should own** that nothing else can. (Force-rank: if M8 could only keep one capability, what is it?)

3. **What to kill immediately** — which M8 features are wasted motion competing with off-the-shelf tools?

4. **Is the "persistent memory + autonomous + live-data layer under existing tools" framing correct?** If not, what's the right framing? And does the ecommerce-project test case prove or disprove M8's value?

Optional 5. If you'd keep M8, what's the smallest first build that would make Muhammad *trust and depend* on it within a week — without exhausting him?

---

*Reply as a standalone assessment. We will synthesize all four opinions before committing any build time.*
