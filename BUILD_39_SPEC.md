# BUILD_39 SPEC — Read-path trust tiers (act on Build-38 provenance)

**Status:** SPEC → implementing this session
**Session:** Session-35 / 2026-06-15
**Origin:** user's Build-39 recommendation (Round-5 follow-on to Build-38, "trust before
taxonomy" item #1 of the post-window backlog).

## 1. Goal

Build-38 made `verification_state`/`confidence` *legible* — every node line in the graph
recall packet already carries a `trust: <state>, confidence X.XX` tag. But all matched
nodes are still rendered as one flat, cosine-ordered `NODES:` list, so an `unverified`
hypothesis sits next to a `proven` result with no structural distinction beyond a
parenthetical the model can skim past.

Build-39 makes the read path **act** on that provenance: group the packet's nodes into
**trust tiers** (most-trusted first), each with an explicit framing header, plus a
closing TRUST TIERS instruction. No nodes are dropped and no new columns/migration are
needed — this is purely a `renderGraphPacket` rendering change in `lib/memory-graph.js`.

## 2. Design

```
const TRUST_TIERS = [
  { state: "proven",     header: "VERIFIED (machine-checked, e.g. Lean — established within our own work):" },
  { state: "empirical",  header: "EMPIRICAL (tested/observed, not proven):" },
  { state: "heuristic",  header: "HEURISTIC (partially checked, not fully verified):" },
  { state: "unverified", header: "UNVERIFIED (recorded hypotheses -- NOT verified; do not present as findings):" },
  { state: "refuted",    header: "REFUTED (counterexamples on record -- known FALSE; never cite as support):" },
];
```

- Each of `matches.slice(0, 8)` is bucketed by `verification_state` (missing/unrecognized
  -> `unverified`, conservative default). Cosine order is preserved *within* each tier.
- Non-empty tiers render in the fixed `TRUST_TIERS` order, each under its header. Global
  numbering (1..N) continues across tiers so existing edge-name lookups are unaffected
  (they key off node id/label, not the displayed number).
- Per-node `bits` keep the existing `trust: <state>, confidence X.XX` tag (Build-38) —
  the header gives the category, the per-node tag still gives the exact confidence.
- **New:** a node with `confidence < 0.5` and `verification_state !== "proven"` gets an
  extra `low confidence` bit, regardless of tier (e.g. an `unverified` extraction-sourced
  node at 0.4 vs a curated-seed `unverified` node at 0.9 are not the same bet).
- **New closing line** (after the NODES section, before the existing
  MACHINE-GENERATED/LITERATURE/SPECULATIVE warning lines):
  > `TRUST TIERS: nodes above are grouped by verification_state, most-trusted first. Lead
  > with VERIFIED/EMPIRICAL findings; treat HEURISTIC/UNVERIFIED nodes as recorded
  > hypotheses and flag them as such if you mention them; REFUTED nodes are known FALSE
  > on this record -- never cite as support.`

## 3. Out of scope (deferred)

- **Selection/ranking** (which nodes win cosine top-k) is unchanged — that's the
  "broaden search routing" backlog item (#2), a separate concern (intent classification,
  not provenance framing).
- **Filtering/dropping** low-trust nodes entirely was considered and rejected: the team's
  established pattern (Build-15 edge-summary) is "say so, don't silently hide" — an
  `unverified` node is still real information (a recorded hypothesis), just framed
  correctly. v1 = framing, not exclusion.
- The full multi-bucket epistemic axis (backlog #3) stays parked; this only sharpens how
  the *existing* `verification_state`/`source_class` axes are presented.

## 4. Tests

`tests/trust-tier-verify.ps1` — PS mirror of the tiering/grouping + low-confidence-flag
logic (no Node available offline), covering:
- tier order is fixed (VERIFIED, EMPIRICAL, HEURISTIC, UNVERIFIED, REFUTED) regardless of
  input order;
- cosine order preserved within a tier;
- missing/unrecognized `verification_state` defaults to UNVERIFIED;
- `low confidence` flag fires only for `confidence < 0.5` AND `verification_state !==
  "proven"`;
- a `proven` node at confidence 1.0 never gets `low confidence`;
- empty tiers produce no header (no "EMPIRICAL:" with zero rows under it).

## 5. Live verify (after offline pass — needs explicit authorization, Gemini quota)

Ask a recall question that surfaces a mix of `proven`/`unverified`/`empirical` nodes
(e.g. a Collatz topic with both M2 seed nodes and code conjectures) and confirm the
narration leads with verified/empirical content and flags unverified hypotheses as such.
