# LIGHT UP THE BRIDGE — live chat test (run on PREVIEW/PROD)

Session-2 follow-up. Offline proof: `tests/bridge-edges-verify.ps1` (25/25) +
`tests/brain-surface-verify.ps1` (48/48 regression).
Branch `feat/bridge-edges` — NOT deployed until merged.

**What changed:** a bridged entity node used to be created ISOLATED (no edges), so
the `ENTITY <-> GRAPH LINKS` block never appeared. Now, when the write flag is on,
a bridged person/company node is ANCHORED with `related_to` edges to the research
nodes it's semantically closest to — so the bridge becomes visible in chat.

**Precondition:** `M8_ENTITY_GRAPH_BRIDGE_WRITE=1` (already ON in prod).

## Step 1 — trigger anchoring
1. In M8 chat, type:  `what did Terras prove?`  (or `who is Terras?`)
   - This finds the Terras person node (id 199 from the earlier session), then
     anchors it to the Collatz research nodes it matches.

## Step 2 — verify the edges landed (read-only SQL, project ltqpoupferwituusxwal)
```sql
select e.id, e.rel, e.src_id, n.kind as dst_kind, n.label as dst_label,
       e.metadata->>'bridged_anchor' as anchored
from m8_graph_edges e
join m8_graph_nodes n on n.id = e.dst_id
where e.src_id = (select id from m8_graph_nodes where kind='person' and norm_label='terras')
order by e.id desc;
```
- ✅ EXPECT: 1-2 `related_to` rows from Terras → Collatz-related nodes, `anchored=true`.
- (Or just tell me "done" and I'll run it for you.)

## Step 3 — the bridge now shows in chat
2. Ask again, e.g.:  `tell me about Terras`
   - ✅ EXPECT: the answer can now weave in the connection ("Terras, who relates to
     your Collatz work…") because the `ENTITY <-> GRAPH LINKS` block is populated.
   - In the Vercel runtime log for that turn you'll see `entity_graph_bridge`.

## Bounds / safety to confirm
- **Self-limiting:** once Terras has >= 2 edges, later turns SKIP the embedding/match
  entirely (no repeated cost). Re-running step 1 should add no new edges.
- **Honesty:** edges are `related_to` only (a non-evidence relation) — never
  `supports`/`formalizes`, so this can't fabricate proof/evidence structure.
- **Opt-in:** with `M8_ENTITY_GRAPH_BRIDGE_WRITE` unset, anchoring is a no-op
  (read-only) — no edges created.

## Regression
3. A graph recall (`what do I know about Collatz?`) still renders its normal packet;
   the new Terras→Collatz `related_to` edge may now appear as one more CONNECTION
   line, correctly attributed.
