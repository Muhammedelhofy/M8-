# BRAIN-SURFACE — live chat test (run on the PREVIEW deploy)

Session-2 "Surface the live brain in chat". The host has no Node, so the offline
proof is `tests/brain-surface-verify.ps1` (48/48 static mirror). This file is the
LIVE proof — type these in M8 chat on the **preview** build and check the result.

Branch `feat/brain-surface` — **NOT deployed**. Muhammad deploys when ready.

> Live-data snapshot at build time (Bolt Supabase `ltqpoupferwituusxwal`, read-only):
> - `m8_entities` = 6 rows: **Terras [person]**, Collatz Conjecture / Bugs / Riemann
>   Hypothesis [problem], scaffold-1 / Lean [concept]. **0 company entities.**
> - `m8_graph_nodes` person/company kinds = **0** (people currently live under the
>   legacy generic `entity` kind, e.g. "Lagarias"). So the **read-only** bridge has
>   no entity↔graph overlap to surface YET — it is a correct no-op until the
>   write-back (Part C) or the nightly extraction creates matching nodes.

---

## Part A — entity CARD injection (works today, buffered path)
1. Type:  `who is Terras?`
   - ✅ EXPECT: M8 narrates the **tracked** entity, not a generic web bio — it
     should mention "proved parity prefix densities in 1976" (the stored summary)
     and that it's a tracked entity seen across sessions.
   - ❌ FAIL: a generic "I don't have info on Terras" or a web-searched person.

2. Type:  `tell me about the Collatz conjecture in our work`
   - ✅ EXPECT: M8 connects to the tracked problem entity (generator run to 100000)
     / research-graph context, not a textbook-only answer.

## Part B — entity roster recall now on the STREAM path (the gap-fill)
Voice / short conversational turns use the streaming path, which previously
injected **no** entity context. Use voice or a short personal phrasing:
3. Type:  `remind me where we landed on Terras`
   - ✅ EXPECT: M8 recalls the tracked summary (cross-session), proving
     `recallEntities` now fires on the stream path too.

## Part C — ENTITY ↔ GRAPH bridge convergence (opt-in write-back)
The bridge reinforces the entity card with the research graph's relations. Today
there is no overlap, so first let an entity flow INTO the graph:
4. In Vercel → preview env, set `M8_ENTITY_GRAPH_BRIDGE_WRITE=1` (redeploy preview).
5. Type any general turn naming the person, e.g.:  `what did Terras prove?`
6. Verify a typed node was seeded (Supabase SQL, read-only):
   ```sql
   select kind, label, norm_label, source, metadata->>'bridged_from' as bridged
   from m8_graph_nodes
   where kind in ('person','company') and norm_label = 'terras';
   ```
   - ✅ EXPECT: one `person` row `Terras`, source `code`, bridged = `m8_entities`.
7. Once the seeded node accrues edges (nightly sweep / further mentions), a later
   turn naming Terras injects an `ENTITY <-> GRAPH LINKS` block — visible in the
   Vercel runtime log as `entity_graph_bridge` (buffered path `log()` marker).

## Kill switches (env only, no redeploy of code)
- `ENTITY_GRAPH_BRIDGE_DISABLED=1` — turn the whole bridge off.
- `M8_ENTITY_GRAPH_BRIDGE_WRITE` unset / not `1` — read-only (default; no writes).

## Regression — nothing else moved
8. Type:  `what's June 7 net?` (or any fleet turn) → unchanged fleet packet
   (bridge is gated OFF for fleet/finance/compute/lean turns).
9. Type:  `what do I know about the Collatz attractor?` → the graph hard-route
   packet is unchanged (renderGraphPacket was NOT touched).
