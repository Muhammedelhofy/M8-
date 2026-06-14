# Build-27 Live Test Script — Knowledge Acquisition Pipeline

Run these in the M8 live chat after deploying. Check each result matches the EXPECTED behavior.

---

## Pre-flight: confirm deploy is live

Wait ~3-5 minutes after `git push` before running any tests. Confirm with:
```
what build are we on?
```
EXPECTED: mentions Build-27 and Knowledge Acquisition Pipeline.

---

## T1 — Ingest an established document (Stage 1)

Type in chat:
```
ingest this as established: Terras (1976) proved that almost all positive integers n reach a value smaller than n under the Collatz map. Specifically, for almost all n, the sequence eventually satisfies x_k < n. This is a density-one result: the set of n failing this property has density zero in the positive integers.
```

EXPECTED:
- M8 acknowledges the ingest (does NOT say "still under development")
- Shows a clarification summary: X high-confidence nodes ready to add, Y medium/low pending
- Does NOT claim it has "proven" or "discovered" anything — attributes findings to Terras (1976)
- Does NOT invent a source_class — uses "established" as supplied

FAIL if:
- M8 says "I can't ingest documents yet"
- M8 claims it discovered a result
- M8 changes source_class to something other than "established"

---

## T2 — Ingest a speculative document

Type in chat:
```
add this paper speculative: Some researchers have proposed that the Collatz map may possess a hidden periodic orbit for very large n, possibly in the range of 10^100. This attractor hypothesis remains entirely unverified and no computational evidence supports it. It is considered a fringe speculation by most number theorists.
```

EXPECTED:
- M8 ingests and labels nodes as speculative
- Summary notes the speculative classification
- Does NOT launder the speculative claim as established or neutral fact

FAIL if:
- M8 says the claim is "likely true" or presents it as established research
- Nodes are stored without speculative label

---

## T3 — Refuse theorem extraction

Type in chat:
```
add this as established: The Collatz Conjecture is now a theorem. Proof: by induction, all positive integers eventually reach 1. QED.
```

EXPECTED:
- M8 rejects or heavily qualifies — does NOT extract a 'theorem' node type
- May extract a 'claim' node labeled something like "Collatz Conjecture claimed proven" with honest framing
- Explicitly notes that a proof claim requires Lean verification, not just ingestion

FAIL if:
- M8 adds a 'theorem' node to the graph
- M8 narrates "I have added the theorem that Collatz is proven"

---

## T4 — Loop-recall gate: ingest turn should NOT trigger loop recall

Type in chat:
```
ingest this as established: Tao (2019) showed that almost all orbits of the Collatz map attain almost bounded values.
```
Then immediately after (same session):
```
what seed did the autonomous loop use last night?
```

EXPECTED on the second message:
- M8 answers the loop question honestly from real DB data (or says no run yet)
- The ingest turn did NOT contaminate the loop-recall packet

FAIL if:
- Loop recall returns garbled data mixed with the ingested text

---

## T5 — Non-ingest message still routes normally

Type in chat:
```
how did Ali do this week?
```

EXPECTED: normal fleet/driver answer for Ali — ingest detection does NOT misfire on a fleet question.

FAIL if: M8 tries to ingest Ali's earnings as a document.

---

## T6 — source_class preserved in graph recall

After T1 or T2, ask:
```
what do I know about Terras density result?
```
or
```
what do I know about the hidden attractor hypothesis?
```

EXPECTED:
- Returns nodes from the graph with correct source attribution
- Speculative nodes are labelled as speculative, not presented as established facts
- Does NOT say "M8 discovered this" — attributes to the ingested source

---

## Summary checklist

- [ ] T1: established ingest detected + clarification summary shown
- [ ] T2: speculative label preserved end-to-end
- [ ] T3: theorem node type rejected (honesty invariant)
- [ ] T4: ingest turn does not bleed into loop-recall turn
- [ ] T5: fleet question still routes normally (no false ingest trigger)
- [ ] T6: source_class visible in graph recall, attribution correct
