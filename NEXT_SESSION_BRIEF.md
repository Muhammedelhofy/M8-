# M8 Next Session Brief — Routing Session close (2026-06-29)

## TL;DR
The "end the keyword whack-a-mole" routing rebuild shipped **5 builds in one session**, all on
prod, all mirror-verified, all kill-switched. M8 now routes by MEANING through one registry, the
ask-my-docs door is open, and the live wallet⇄fleet bug Muhammad hit is fixed.

## What's LIVE on prod (m8-alpha.vercel.app, `25e747a`, nodejs:12)
| Build | What | State |
|-------|------|-------|
| **B-155** | `lib/capability-registry.js` (11-domain single source of truth) + `domain-arbiter.classifyAll()` | shadow only (logs `arbiter:reg:*`) |
| **B-156** | Lookup-boundary flip (memory/web/knowledge/chat) → **the ask-my-docs / CV door** | **ON** (`M8_REGISTRY_LOOKUP=1`) |
| **B-157** | Central wallet/fleet/finance **execution gate** in `handleWalletCommand` (the live-bug fix) | **LIVE (behaviour change)** |
| B-157 (V2) | Registry owns the wallet/fleet/finance routing | dormant (`M8_REGISTRY_CRUD` default OFF) |
| **B-158a** | Per-driver **date-range** fleet breakdown (`fleet.js`) | LIVE |
| **B-158b** | Semantic **embeddings** for CV/notes (33 nodes backfilled, free 768-dim) | LIVE |

## Flag matrix
- `M8_REGISTRY_ROUTER=1` — ON (B-155 shadow logging).
- `M8_REGISTRY_LOOKUP=1` — ON (B-156 lookup flip live; CV door).
- `M8_REGISTRY_CRUD` — **OFF** (B-157 V2 flip dormant; the unconditional gate fix is already live).

## 🔴 When you're back — live-test checklist (nothing breaks meanwhile)
1. **B-157 gate fix** (the bug you hit): "TOTAL NET EARNING PER DRIVER FROM 1ST TILL 28TH JUNE",
   "how many drivers exceeded 4000 sar this month", "net earning in all june" → must hit **fleet**,
   not your personal numbers. (`tests/BUILD157_LIVE_TEST.md`)
2. **B-158a**: that same per-driver question should now return a **ranked per-driver list** for the
   range, not a daily snapshot. (`tests/BUILD158_LIVE_TEST.md`)
3. **B-156 CV door**: "what does my CV say about leadership" → cites your CV (now semantic via B-158b).
4. **No regression**: your Sara/wallet queries (last expense, June total, breakdown) still answer wallet.
5. If 1–4 pass → **turn ON `M8_REGISTRY_CRUD=1`** + redeploy to activate the registry-owns-money flip,
   then re-test 1 + 4. (That's the last dormant piece going live.)

## NEXT build — B-159 (queued brief: `SESSION_BRIEFS/B159_FINISH_CRUD_FLIP.md`)
Finish the all-domain routing: flip the **last domains** (tasks / notes / driver_profile) onto the
registry, and fix the one real handler backlog item — the **currency-filtered breakdown**
("breakdown on 921 sar" currently leaks EGP). Router build (orchestrator.js) → sequential.

## Backlog (not routing)
- Currency-filtered breakdown leak (folded into B-159).
- (per-driver date-range breakdown — DONE in B-158a.)

## Shadow dataset (his "extend meaning-routing to all domains" direction)
`m8_router_misses` now logs `arbiter:reg:*` (B-155) + `lk:*` (B-156) on his real traffic. Let it
accumulate — that's the evidence base for whether the deterministic classifier is enough or whether
free embeddings-based routing is worth adding (the one open council question — see team note below).

## Constraints (unchanged)
Free-LLM default · privacy wall absolute · Vercel 12-fn cap FULL (reuse `api/ops?fn=` / `api/knowledge?fn=`)
· confirm-before-write · Node ABSENT → PS-5.1 mirrors + live phone test · never push main without OK.

## Parallel-session note
Most of what's left is router work (orchestrator.js = sequential). Run ONE router session at a time;
each session needs its own `git worktree` (see any SESSION_BRIEFS/* Step 0).
