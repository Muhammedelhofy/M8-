# M8 End-to-End Test Scenarios

Defines expected behavior across the full pipeline:
**Query → Intent → Tools → Response Quality**

`classifier-test.js` proves routing is correct.  
This document proves the *output* is correct.  
Run manually on the live deployment at https://m8-alpha.vercel.app

---

## How to evaluate

For each scenario:
- [ ] Intent routed correctly (check via console logs or behavior)
- [ ] Correct tools fired (search / memory / both / neither)
- [ ] Response is specific — contains real data, not generic advice
- [ ] Response does NOT say "try Google" / "use Skyscanner" / "search for..."

---

## LOOKUP scenarios — M8 should FETCH, not advise

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| L1 | "cheap flights from riyadh to alexandria" | LOOKUP | Search (Tavily basic) | Lists actual airlines (flynas, Air Arabia, Saudia) and approximate price range — NOT "use Google Flights" |
| L2 | "best school near munsiyah riyadh" | LOOKUP | Search (Tavily basic) | Names specific schools with location context |
| L3 | "restaurants open near me right now" | LOOKUP | Search (Tavily basic) | Lists actual restaurant names and addresses (or notes location access needed) |
| L4 | "price of iphone 16 in saudi arabia" | LOOKUP | Search (Tavily basic) | Gives actual SAR price range from results |
| L5 | "exchange rate sar to egp" | LOOKUP | Search (Tavily basic) | States the rate with source — NOT "check XE.com" |
| L6 | "how much to ship a package from riyadh to jeddah" | LOOKUP | Search (Tavily basic) | Gives actual courier price ranges (Aramex, DHL, SMSA) |
| L7 | "nearest hospital to al malqa district" | LOOKUP | Search (Tavily basic) | Names specific hospitals (King Fahd, Dr. Sulaiman Al Habib, etc.) |
| L8 | "find me a good gym in north riyadh" | LOOKUP | Search (Tavily basic) | Lists actual gym names with neighborhoods |

---

## NEWS scenarios — M8 should report current events

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| N1 | "latest keeta news" | NEWS | Search (Tavily news, 7 days) | Reports actual recent Keeta news with date context |
| N2 | "what happened in the saudi delivery sector this week" | NEWS | Search (Tavily news) | Summarizes real recent events — not generic market overview |
| N3 | "recent updates from bolt ksa" | NEWS | Search (Tavily news) | Returns real Bolt KSA updates if available |

---

## FACT_CHECK scenarios — M8 should confirm or deny with evidence

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| F1 | "did keeta launch in bahrain" | FACT_CHECK | Search (Tavily advanced + answer) | Direct yes/no answer with source citation |
| F2 | "has noon food expanded to north riyadh" | FACT_CHECK | Search (Tavily advanced) | Confirmed or denied with evidence |
| F3 | "was uber eats available in riyadh before" | FACT_CHECK | Search (Tavily advanced) | Historical answer with source |

---

## RESEARCH scenarios — M8 should explain with depth

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| R1 | "explain rider utilization metrics" | RESEARCH | Search (Tavily advanced) | Clear explanation of the concept with real-world framing |
| R2 | "summarize atomic habits book" | RESEARCH | Search (Tavily advanced) | Actual summary of the book's core ideas |
| R3 | "what is last mile delivery optimization" | RESEARCH | Search (Tavily advanced) | Concise explanation with logistics context |
| R4 | "best logistics books to read" | RESEARCH | Search (Tavily advanced) | Named books with brief descriptions — not "check Amazon" |

---

## NONE scenarios — Memory only, no search

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| M1 | "who am i" | NONE | Memory only | Recalls Muhammad's profile — name, role, fleet size, location |
| M2 | "what did we discuss about keeta last month" | NONE | Memory only | Retrieves actual past conversation content about Keeta |
| M3 | "remind me what we agreed on for the drivers" | NONE | Memory only | Recalls specific agreements from past sessions |
| M4 | "thanks" | NONE | Neither | Short, natural acknowledgment |

---

## HYBRID scenarios — Memory + Search together

These are the hardest cases. M8 must combine past context with live data.

| # | Query | Expected Intent | Expected Tools | Pass Criteria |
|---|-------|----------------|----------------|---------------|
| H1 | "compare latest keeta news with what we discussed" | NEWS | Memory + Search | Response explicitly references BOTH past discussion AND new search results |
| H2 | "is what we said about bolt ksa expansion still accurate?" | FACT_CHECK | Memory + Search | Recalls the past statement, then checks it against current web results |
| H3 | "what did we decide about courier supply and what's the latest?" | NEWS | Memory + Search | Recalls decision, adds current market context from Tavily |

---

## Known Limitations (document, don't fix yet)

- **Real-time prices**: Tavily returns web pages, not live booking APIs. L1 flight prices may be approximate or from articles rather than live booking engines.
- **Location queries**: L3/L7 rely on query context — M8 doesn't have GPS access.
- **Memory keyword limits**: M2/M3 only work if the past sessions contain the right keywords. Semantic recall (Milestone 4 / pgvector) will fix this.
- **Arabic routing**: All patterns above tested in English. Run Arabic equivalents manually.

---

## Test log

| Date | Scenario | Pass/Fail | Notes |
|------|----------|-----------|-------|
| 2026-06-06 | L1 (flights) | — | First real-world test that exposed the LOOKUP gap |
