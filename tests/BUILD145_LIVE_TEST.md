# Build-145 — web-search vs memory routing for known people — LIVE TEST

Sequence item #6. Fixes "who is Sara?" → right answer ("your wife") but padded with a
useless web search for a generic "SARA" acronym.

## What shipped
- In `orchestrate` (the only path that web-searches), a "who is X" / "tell me about X"
  ask now sets `knownPersonCard` when X is a household wallet member OR a recalled
  PROFILE fact (e.g. "Muhammad's wife is Sara"). That **suppresses the web search** and
  injects a directive: answer from HOUSEHOLD + MEMORY only, don't list unrelated
  same-named entities.
- The streaming path never web-searches, so it already answered from injected context.

## Offline (passed)
- `M8/tests/build145-known-person-test.ps1` → **6/6** (member / profile-fact / unknown).
  Regressions 135–144 green.

## Live chat questions
| # | Type this | Expect |
|---|-----------|--------|
| 1 | `who is Sara?` | "Sara is your wife…" — NO Malaysian-aid-program web noise |
| 2 | `who is Muhammad?` | answers as you (owner) from context |
| 3 | `who is <a real public figure>?` | still web-searches normally (not a known person) |

**Pass bar:** 1–2 answer cleanly from memory with no irrelevant same-named results; 3
proves general lookups still work (fail-open).
