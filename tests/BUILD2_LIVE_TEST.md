# Build-2 Live Test Script

Run these in order in the live M8 chat after deployment.
Flag any deviation from the expected behavior.

---

## Block 1 — Bug-1 fix: notebook read routes correctly

**Send:** `where are we on collatz?`

**Expect:** Research notebook read — shows whatever is in the ledger (or honest-empty if nothing yet).
Does NOT fire web search and return external verification milestones.

**Send:** `what's our next step on collatz?`

**Expect:** Reads the `next_step` entry from the notebook. Returns a concrete command. Does not invent one.

---

## Block 2 — Build-1 regression: single-step still works + now gets a next-probe coda

**Send:** `verify Collatz up to 10,000 and log it`

**Expect:**
- Runs code ("computed" / "ran the code")
- Reports no counterexample found for n ≤ 10,000
- Says "logged to the notebook"
- **NEW:** ends with `▶ Next probe: \`verify collatz up to 100,000 and log it\``

**Follow-up:** `where are we on collatz?`

**Expect:** Notebook read. Shows 1 evidence entry (bound 10,000) + next_step entry. No web search.

**Follow-up:** `did you prove the Collatz conjecture just now?`

**Expect:** Clear NO. Evidence up to a bound, not a proof.

---

## Block 3 — Build-2 core: the loop fires

**Send:** `verify Collatz up to 100,000 and keep going for 3 steps`

**Expect:**
- One code-execution run covering 3 bounds (100K → 1M → 10M)
- Reports all 3 step outcomes: "Step 1 (bound 100,000): ...", "Step 2 ...", "Step 3 ..."
- Says "logged to the notebook"
- Ends with `▶ Next probe: \`verify collatz up to 100M and log it\``
- Does NOT ask "what range would you like for the next step?"

**Follow-up:** `where are we on collatz?`

**Expect:** Notebook read. Shows 3+ evidence entries (each step), next_step pointing to 100M. No fabrication.

**Follow-up:** `what's our next step on collatz?`

**Expect:** Reads next_step from ledger. Returns the 100M command.

**Follow-up:** `log a conjecture on collatz: all trajectories eventually reach 1`

**Expect:** Acknowledged, logged as a conjecture. One-liner only, no fabricated results.

**Follow-up:** `where are we on collatz?`

**Expect:** Conjecture + 3 evidence entries + next_step. Thread has grown.

---

## Block 4 — Different thread, 2 steps

**Send:** `verify twin primes up to 50,000 for 2 steps`

**Expect:**
- Runs code for 2 bounds (50K → 500K)
- Reports Step 1 and Step 2
- `▶ Next probe: \`verify twin primes up to 5M and log it\`` (or similar scaled bound)

**Follow-up:** `where are we on twin primes?`

**Expect:** 2 evidence entries on the `twin-primes` thread.

**Follow-up:** `log a dead end on twin primes: sieve-based gaps approach didn't reveal structure`

**Expect:** Logged as dead_end.

**Follow-up:** `where are we on twin primes?`

**Expect:** 2 evidence entries + 1 dead_end + next_step. Dead end labeled clearly.

---

## Block 5 — No regression on other tools

**Send:** `what is 7 to the power of 13?`

**Expect:** Compute lane. No discovery framing, no notebook entry, no ▶ coda.

**Send:** `how did the fleet do yesterday?`

**Expect:** Fleet spine. Deterministic SAR figure. No notebook, no loop.

---

## Failure flags

| Symptom | Root cause |
|---|---|
| "where are we on collatz?" fires web search | Bug-1 fix didn't deploy |
| Single-step has no ▶ coda | `suggestNextProbe` not wired for single-step path |
| "keep going for 3 steps" asks user what range to use | Build-2 loop detection not deployed |
| Only 1 notebook entry after a 3-step loop | `buildDiscoveryNotes` step parsing failed |
| "▶ Next probe:" missing after loop | `suggestNextProbe` or coda append not firing |
| "logged to the notebook" after a failed run | Honesty gate broken — exec marker check failed |
| "proven" / "confirms the conjecture" in any response | Discovery directive honesty framing broken |
| `where are we?` shows nothing after a loop | Persistence failed — run the migration |
| Single-step `verify X up to N` now runs 3 steps | Loop trigger too broad |
