# Build-65 Live Test — Phase B2 Parametric PPTX

**URL:** https://m8-alpha.vercel.app  
**Confirm deploy:** `/api/health` → `"build":"Build-65"`

## Test 1: Chips clarification (no type specified)
Type: `make me a fleet deck`

Expected:
- M8 responds with the clarification text: "Which deck format, Boss?"
- Three pill chip buttons appear below: `📊 Analysis`, `🎯 Board`, `⚙️ Operational`
- NO download button yet

## Test 2: Click Analysis chip
Click the `📊 Analysis` chip (it sends "make me an Analysis fleet deck")

Expected:
- M8 confirms the Analysis deck is coming
- Download button appears: `Download Fleet Analysis Deck (PowerPoint)`
- Download URL contains `?format=pptx&type=analysis`
- Clicking downloads a `.pptx` file named `fleet-deck-analysis-*.pptx`

## Test 3: Click Board chip
From a fresh "make me a fleet deck", click `🎯 Board`

Expected:
- Download button: `Download Fleet Board Deck (PowerPoint)`
- 5-slide board-style deck

## Test 4: Click Operational chip
From a fresh "make me a fleet deck", click `⚙️ Operational`

Expected:
- Download button: `Download Fleet Operational Deck (PowerPoint)`
- 6-slide ops-action deck

## Test 5: Type includes keyword directly (no chips shown)
Type: `give me an executive fleet deck`

Expected:
- NO chips clarification
- M8 goes straight to Board deck (exec → board keyword)
- Download button: `Download Fleet Board Deck (PowerPoint)`

## Test 6: Analysis deck content check
Open the downloaded Analysis deck and verify:
- Slide 1: "Fleet Performance Analysis" title
- Slide 2: Fleet Health Scorecard (4 KPI boxes + pace distribution)
- Slide 3: Driver Rankings table with Daily Avg column
- Slide 4: Pace Analysis (On Track / Close / Off Pace groups)
- Slide 5: Trend Analysis table (Early/Late avg, Change %, direction)
- Slide 6: Anomaly Detection (dark drivers, inconsistent, concentration risk)
- Slide 7: Key Findings (bullet findings with colored accent bars)

## Test 7: Operational deck content check
Open the Operational deck and verify:
- Slide 1: "Fleet Daily Ops Brief" in green
- Slide 2: Priority Actions (HIGH/PUSH labeled action items)
- Slide 3: Chase List (drivers in CLOSE/ON TRACK range, with gap + needed/day)
- Slide 4: Missing & Inconsistent flags
- Slide 5: Driver Status Overview (compact table)
- Slide 6: Tomorrow's Focus (icons + action items)

## Test 8: Regression — Excel export unaffected
Type: `give me the excel report`

Expected: Excel download button still works, no chips shown.
