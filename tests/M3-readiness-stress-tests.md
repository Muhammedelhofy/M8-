# M8 — Pre-Milestone-3 Stress Tests

**Purpose:** Map where M8 actually stands *today* across many domains, and especially
measure two things before we build more:

1. **Search/answer quality per domain** — where does the Tavily pipeline give real,
   specific answers vs. vague/wrong ones? (Tells us where we need query rewriting or
   dedicated APIs.)
2. **Conversational intelligence** — does M8 *ask clarifying questions* when a request is
   underspecified, instead of blindly searching or guessing? (Today: it does NOT — there
   is no clarification path in the pipeline. These tests quantify the gap.)

Run each against the live deployment (`m8-alpha.vercel.app`). For each: note the response,
mark Pass / Weak / Fail, and jot what it implies for M3.

> **Key architectural finding driving this:** M8's pipeline is `classify → (search?) → answer`.
> There is no branch where M8 replies with a *question*. Adding a clarification/slot-filling
> gate is likely the highest-value M3 capability. Section A is designed to prove the need.

---

## Section A — Clarification behavior (THE priority)
These are deliberately **underspecified**. A great agent asks for the missing pieces
*before* acting. Pass = M8 asks the right follow-up question(s). Fail = M8 searches/answers
blindly.

| # | Query | Missing slots M8 should ask for | Pass criteria |
|---|-------|--------------------------------|---------------|
| A1 | "I want cheap flights" | destination, dates, origin (has Riyadh), one-way/return, pax | Asks at least destination + dates before searching |
| A2 | "Book me a hotel" | city, check-in/out dates, budget, guests | Asks city + dates + budget |
| A3 | "Find me a good restaurant" | city/area, cuisine, occasion, budget | Asks area + cuisine |
| A4 | "I need a car" | buy vs rent, city, budget, type | Asks buy-or-rent + city |
| A5 | "How much will it cost?" | cost of *what* | Asks what item/service |
| A6 | "What should I do this weekend?" | city, interests, with-whom, budget | Asks location + interest |
| A7 | "Help me with my fleet" | which aspect (performance, payments, scheduling…) | Asks which aspect |
| A8 | "Plan a trip for me" | destination, dates, budget, purpose | Asks the essentials, doesn't invent an itinerary |
| A9 | "Send a message to the supplier" | which supplier, what message, channel | Asks recipient + content |
| A10 | "أريد أحجز رحلة" (I want to book a trip) | same as A8, in Arabic | Asks in Arabic for the essentials |

**What this section reveals:** how often M8 *should* ask but doesn't. Every Fail here is a
data point for the clarification-gate milestone.

---

## Section B — Real-data reaction across domains
Each is **well-specified**. Tests whether the search pipeline returns *specific* answers.
Pass = concrete data (names/prices/figures). Weak = generic/partial. Fail = wrong domain,
"I couldn't find…", or "try Google".

| # | Domain | Query | Pass criteria |
|---|--------|-------|---------------|
| B1 | Flights | "cheapest flight from Riyadh to Alexandria on August 1, one way" | Names airlines + approx SAR/USD price, correct route |
| B2 | Hotels | "cheap hotel in Jeddah for 2 nights next week, near the corniche" | Names hotels + nightly price range |
| B3 | Restaurants | "best Egyptian restaurant in Riyadh" | Names actual restaurants + areas |
| B4 | Product price | "price of Samsung Galaxy S25 in Saudi Arabia" | Real SAR price range + retailer |
| B5 | Weather | "weather in Alexandria, Egypt next week" | Temp range + conditions |
| B6 | Currency | "SAR to EGP exchange rate today" | States a current rate + source |
| B7 | Stocks | "Aramco stock price today" | Current/last price (or honest "approx, as of") |
| B8 | Local service | "nearest car service center to Al Malqa, Riyadh" | Names specific centers/areas |
| B9 | Shipping | "cost to ship a 50kg package from Riyadh to Cairo" | Courier names + price ranges |
| B10 | News | "latest news on the Saudi food-delivery market" | Real recent items with dates |
| B11 | Fact check | "did Keeta launch in Bahrain?" | Direct yes/no + source |
| B12 | Research | "explain last-mile delivery cost drivers" | Clear, sourced explanation |
| B13 | Movies/events | "what movies are showing in Riyadh cinemas this week" | Real titles (or honest limitation) |
| B14 | Travel logistics | "do Egyptians need a visa to visit Saudi Arabia" | Accurate, current answer + source |

**What this reveals:** a heat-map of where Tavily is strong (research, facts, products) vs
weak (live prices: flights, stocks, FX). Weak rows → query-rewriting (2c) or a dedicated
structured API (post-M3).

---

## Section C — Memory & supersession
Tests the 2b memory system end-to-end.

| # | Test | Steps | Pass criteria |
|---|------|-------|---------------|
| C1 | Cross-session recall | Session A: "my warehouse is in Al-Kharj." → Session B: "where's my warehouse?" | B answers Al-Kharj (✅ already verified 2026-06-06) |
| C2 | Profile recall | "what platforms do I oversee?" | HungerStation, Noon, Keeta, Uber |
| C3 | Fact supersession | Have one session state "my fleet is now 110 bikes" across ≥5 turns (so it summarizes) → new session: "how many bikes do I run?" | Answers 110, NOT the old ~102 |
| C4 | In-session context | "I'm thinking about Jeddah." → "what's the weather there?" | Uses Jeddah from prior turn |
| C5 | Historical query | After C3: "how has my fleet size changed?" | Can reference both old and new (history preserved) |

**What this reveals:** whether summaries/facts actually form and supersede correctly.
(C3/C5 require the summarizer to fire — ≥~5 exchanges per session.)

---

## Section D — Reasoning, ambiguity & honesty
| # | Test | Query | Pass criteria |
|---|------|-------|---------------|
| D1 | Multi-intent | "what's the weather in Cairo and find me a flight there next Friday" | Handles both, or asks which first — doesn't drop one |
| D2 | Needs-unavailable-data | "how did my drivers perform yesterday?" | Says it has no fleet data connected yet — does NOT invent numbers |
| D3 | Math/calc | "if I have 102 bikes earning 30 SAR/day each, what's monthly revenue?" | Correct arithmetic (~91,800/month) |
| D4 | Impossible specificity | "what exact seat is cheapest on my flight tomorrow?" | Admits limit, doesn't fabricate |
| D5 | Hallucination guard | "what was the headline of Asharq Al-Awsat today?" | Only states if found; otherwise honest |

**What this reveals:** does M8 stay honest under pressure, and can it reason vs. only retrieve?

---

## Section E — Language & tone
| # | Test | Query | Pass criteria |
|---|------|-------|---------------|
| E1 | Arabic factual | "ما هو سعر صرف الريال مقابل الجنيه المصري؟" | Answers in Arabic with a rate |
| E2 | Arabic clarification | "عايز أسافر" (I want to travel) | Asks, in Arabic, where + when |
| E3 | Code-switch | "find me فطور near me in Riyadh" | Handles mixed input gracefully |
| E4 | Brevity | any factual query | Concise (voice-friendly), not a wall of text |

---

## Scoring sheet
| Section | Pass | Weak | Fail | Headline takeaway |
|---------|------|------|------|-------------------|
| A — Clarification | | | | |
| B — Real data | | | | |
| C — Memory | | | | |
| D — Reasoning | | | | |
| E — Language | | | | |

**Decision gates after running:**
- If Section A is mostly Fail → **clarification gate becomes the top M3 item.**
- Section B weak rows → prioritize query rewriting (2c) and identify which domains need a real API.
- Section C → confirms 2b is production-solid (or flags fixes).
- Section D fails → tighten honesty directives / add a calc tool.
