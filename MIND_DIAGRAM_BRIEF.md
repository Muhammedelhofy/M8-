# M8 "Mind / Brain" Diagram + Tasks / Projects / Evolution — Agreed Brief

**Purpose of this file:** Muhammad is doing this work in a SEPARATE Claude session/account. This file is
the durable, in-repo record of what we agreed so it can't get lost across sessions. Pull the `M8-` repo
and read this + [`NEXT_SESSION_BRIEF.md`](NEXT_SESSION_BRIEF.md) + [`HONESTY_TRACK_PLAN.md`](HONESTY_TRACK_PLAN.md)
before starting. Written Session-38 (2026-06-16).

## The ask (Muhammad's words, paraphrased)
The current diagram (`m8_full_architecture_2026.html`) is hard to read: "a lot of things, I don't know how
they're connected or what they're serving," "what do A/B/C/D mean," and "'LIVE' just means good — where's
the *progress*?" He wants to reframe M8 as a **MIND/BRAIN we are building**, with:
- clear **components** and **arrows that say what connects to what and what each part SERVES**;
- **plain-language** names (no cryptic A/B/C/D or bare build numbers as the primary label);
- real **progress indicators** (a 0–100% bar or an L1–L6 maturity dot per component) instead of a binary
  green "LIVE";
- a prominent **"how far toward the unforbidden-knowledge / unsolved-problem goal"** gauge (honest +
  conservative — we are still early on that depth axis);
- **MEMORY shown as something that EVOLVES**, not a static box;
- room for **Tasks / Projects / Evolution** of the brain (the newer framing he added) — i.e. the diagram
  should show not just static architecture but what M8 is *working on* and how it *grows over time*.

## Draw FROM these canonical sources (don't invent status numbers)
- `NORTH_STAR.md` — dual North Star (Track A Personal AI OS + Track B Unsolved-Problem Engine), L1–L6 ladder.
- `HONESTY_TRACK_PLAN.md` — what's shipped / live / next.
- `lib/buildState.js` `live[]` — authoritative newest-first list of what shipped.
- Current diagram `m8_full_architecture_2026.html` (keep it working; add the new one as a separate file,
  e.g. `m8_mind_2026.html`, so they can be compared until the new one is approved).

## Honesty (non-negotiable, same as the engine)
"Live/proven" only where actually true; the unforbidden-knowledge gauge must be honest (we are early on
Track B depth — show that truthfully, not flatteringly). If a component's % is a judgement call, label it
as an estimate.

## Process
Propose 1–2 layout concepts in plain words FIRST and let Muhammad pick before building the full thing
(he is non-technical — describe in everyday language, render a preview, iterate). Single-file,
dependency-free HTML (inline CSS) so it renders by just opening it. **Commit + push to `M8-`** when he's
happy, so it isn't lost. This is a visualization/communication task — do NOT modify any `lib/` engine code.

## Where the engine stands (context for the "progress" parts of the diagram)
Problem-Solving Engine roadmap **D → B → A → C is COMPLETE + LIVE** (see NEXT_SESSION_BRIEF). The engine
now has two problem domains (Collatz + reverse-and-add) — "it generalizes" is proven. Per the locked
**depth-over-breadth** doctrine, future engine work is DEPTH (smarter), not more domains. The diagram
should reflect that the *breadth* milestone is done but the *depth* toward the unsolved-problem goal is
still early.
