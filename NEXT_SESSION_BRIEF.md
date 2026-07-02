# M8 Next Session Brief — Session 61 close (2026-07-02, Fable 5)

## TL;DR
Strategy H2-2026 LOCKED (`STRATEGY_2026H2.md`). **B-168 telemetry LIVE** exposed the packet
(24–38k chars/turn). Muhammad's live screenshots + the `m8_router_misses` logs then pinpointed
his #1 pain in code: **the wallet/fleet context lean (0.60) hijacked full novel questions**
(Senegal→"No expenses this month"; weather→fleet, which also SUPPRESSED web search).
**B-169a shipped the fix**: a follow-up gate — the lean fires only on bare follow-ups.

## What's LIVE (m8-alpha, nodejs:12)
| Build | What | State |
|-------|------|-------|
| Strategy | Goal + Track B bar (obstruction-driven) + STOP + E1–E8 | `f80b59d`/`9105b94` |
| B-168 | Context telemetry — sizes → Vercel logs + `m8_router_misses` lane `ctx:packet` (kill: `M8_CTX_TELEMETRY=off`) | LIVE + prod-verified |
| **B-169a** | Follow-up gate on the context lean (kill: `M8_LEAN_GATE=off`); `why=lean_gated` logged | ✅ LIVE + prod-replay-verified |
| **B-169b** | Sub-lanes respect the gate: wallet `lean_gated` veto + fleet date-leg bare-follow-up gate + wallet-SAR decontamination | ✅ LIVE `44ece47` — replay: Senegal→web ✓, weather→live forecast ✓, fleet paths intact ✓ |

Observed (not a bug, note it): after a weather turn, "and in EGP?" now gets a clarifying question
instead of silently converting the OLD wallet total — the money chain broke at the topic change.
Defensible; revisit only if it annoys in real use.

Baseline packet evidence (fleet turn, no history): `TOT:38201 COMPANY:11469 FLEET:10626 SYS:8581 MEM:6190`
Every turn of the screenshot conversation carried FLEET ~9.6k + SYS 8581 + MEM ~6000 regardless of topic.

## NEXT — B-169b+ (context diet continues) · Fable 5 · High effort
1. **COMPANY 11.5k on fleet turns** — why is the full company packet on every fleet question?
2. **SYS 8581 audit** — incl. the "Note: additional context may exist in knowledge base" line
   that LEAKED into a World-Cup answer (screenshot 04:21) and confused him.
3. **MEM ~6k floor on trivial asks** — recall cap/threshold.
4. **Double routing per turn** (~2s apart in logs) — the streaming path evaluates, then delegates
   to the buffered path which re-runs the router + LLM calls. Latency tax on every message.
5. Then **E1 turn integrity** (the stale-state races).

## New backlog from the 2026-07-02 live screenshots
- **B-170 Reminder lane**: "Remind me … at 11 am" gets saved as task TEXT (time swallowed), no
  scheduled push — Web Push plumbing EXISTS (`lib/handlers/push-cron.js`), intent never wired.
  Also: the chat lane PARROTED his notify questions back verbatim (echo loop) — find + kill.
- **B-171 Task ordinals**: M8 prints a numbered task list, then can't resolve "mark the 1st task
  as complete". Resolve ordinals/indices against the last-listed tasks.
- **Wallet coverage**: "credit card amount I have to pay" → generic "no access to your accounts"
  hallucinated-capability decline, though bills/budgets shipped in B-143. Route + honest answer.
- Clarifier loop: reminder clarifier repeated the same question, ignoring his answers.

## Constraints (unchanged)
Free-LLM default · privacy wall absolute · Vercel 12-fn cap FULL · confirm-before-write ·
PS-5.1 mirrors (Node ABSENT; save .ps1 with UTF-8 BOM for Arabic literals) · never push main
without explicit OK · shell cwd resets between tool calls → always `git -C <path>`.
