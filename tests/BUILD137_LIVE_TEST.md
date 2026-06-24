# Build-137 — M8 knows the family (memory layer) — LIVE TEST

**The "completely lost" fix.** Three parts, all privacy-wall-safe (names/relationships
only — no money figure ever reaches the LLM, and the wallet read path is unchanged):

- **A — household roster + seeded fact.** M8's memory now holds a profile fact
  *"Muhammad's wife is Sara…"* (the stale test fact *"accountant = Sara Mansour"* was
  retired), and every turn gets a tiny HOUSEHOLD roster (Family Wallet members, names
  + roles only). So M8 knows who Sara is.
- **B — de-greedy money net.** A sentence that *teaches* who someone is ("she's my
  wife… wallet… expense") no longer trips the canned "I can add/edit/total…" card —
  it reaches the LLM + fact extractor. Money *commands/queries* still route
  deterministically (verified: "how much…", "balance", "delete…" all still caught).
- **C — relationship capture.** "Sara is my wife" / "my brother Omar" is stored as a
  durable profile fact automatically (deterministic, free, pronoun-guarded).

## Offline (passed)
- `M8/tests/build137-family-memory-test.ps1` → **16/16** (B suppression + C capture,
  EN+AR, pronoun/filler rejection). Regressions 135 (15/15) + 136 (12/12) green.

## Live chat questions (run on m8-alpha after deploy)

| # | Type this | Expect |
|---|-----------|--------|
| 1 | `who is Sara?` | Knows Sara is your wife / a Family Wallet member — **not** "Who is Sara?" |
| 2 | `and sara` (after asking your last expense) | Sara's last expense (Build-136), no "who is Sara" |
| 3 | `my brother's name is Omar` | M8 acknowledges normally (no money card), and remembers it |
| 4 | later: `who is Omar?` | recalls "your brother" |
| 5 | `how much did I spend this month?` | still the real total (money lane intact) |
| 6 | `delete my last expense` | still the honest "I can't delete from chat" (no regression) |
| 7 | `what is my wallet` | the capability card still shows (vague, not teaching) |

**Pass bar:** 1–4 prove M8 now learns/knows people; 5–7 prove no money-lane regression.

## Security / privacy posture (explicit)
- The HOUSEHOLD roster sent to the LLM is **names + roles only** — never an amount,
  balance, or transaction. Kill switch: `M8_HOUSEHOLD_CONTEXT_DISABLED=1`.
- B routes only *non-command* identity text to the LLM; it never sends a money figure,
  and the wallet read path (code-computed, no `note`) is untouched.
- C stores relationships, never money — `isFleetFigureFact` still blocks financial facts.
- Memory edit done directly in M8's DB: retired `accountant_name`, seeded `spouse_name`
  (trust 4). Rollback of code = Vercel → previous deploy; rollback of fact = set
  `accountant_name` current again / `spouse_name` is_current=false.
