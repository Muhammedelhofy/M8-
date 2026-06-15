# BUILD_38 SPEC — Provenance + trust_state at ingestion (graph nodes)

**Status:** SPEC — design fork pending Muhammad (see §6)
**Session:** Session-34 / 2026-06-15 (Opus)
**Origin:** Team Round 5, crew-unanimous Q2 — "trust before taxonomy." Provenance must be
universal on graph nodes *before* graph expansion scales (the enabler for the deferred
epistemic axis and L6).
**Prereqs:** Build-30 (`m8_conversations` provenance, `source_type`/`trust_level`, shipped
`migrations/m8_conversations_provenance.sql`) · Build-27 (knowledge intake + the partial
node-provenance columns) · Build-10 (the graph itself).

---

## 1. Goal

Every `m8_graph_nodes` row carries a complete, uniform provenance set **at write time** —
not just ingested `claim`/`document` nodes (Build-27 already partly did those), but ALSO the
code/extraction research nodes (`conjecture`/`theorem`/`evidence`/`failed_attempt`/…) written
by `upsertNode()`. The plan's five fields: **`source · timestamp · evidence_kind · confidence
· verification_state`.**

So that recall can say *where a fact came from, how sure we are, and whether it's been
checked* — for any node, uniformly — instead of provenance being present on intake nodes and
absent on research nodes.

## 2. What ALREADY exists (do NOT duplicate)

`m8_graph_nodes` after Build-10 + Build-27:

| Existing column | Covers plan field | Verdict |
|---|---|---|
| `source` (`code`/`extraction`/`external`) | **source** | ✅ KEEP — already the origin axis |
| `created_at` (timestamptz) | **timestamp** | ✅ KEEP — already the write time |
| `kind` (conjecture/theorem/evidence/counterexample/failed_attempt/technique/sequence/research_thread/claim/entity/document) | node *type* | overlaps `evidence_kind` but is the structural type, not the epistemic role |
| `extraction_confidence` (high/med/low, intake only) | partial **confidence** | categorical, intake-only — does NOT cover code nodes |
| `mastery_state` (ingested→compared→tested→lean_stated→lean_verified) | partial **verification_state** | M8-*pipeline-stage* axis, intake-only default |
| `status` (lean_verified/lean_stated/…) | partial **verification_state** | lean-only, free-text |
| `source_class` (established/speculative/fringe) | epistemic class (intake) | KEEP — orthogonal (Build-28 honesty axis) |
| `source_doc_id`, `note_id` | provenance pointers | ✅ KEEP |

**Conclusion:** `source` and `timestamp` are done. The three genuinely-missing *universal*
axes are **`evidence_kind`**, a unified numeric **`confidence`**, and a unified
**`verification_state`** — but two of those overlap existing intake-only columns, which is the
design fork in §6.

## 3. The three new columns (recommended)

```sql
ALTER TABLE public.m8_graph_nodes
  ADD COLUMN IF NOT EXISTS evidence_kind text
    CHECK (evidence_kind IN ('hypothesis','experiment','result','failed_path','reference')),
  ADD COLUMN IF NOT EXISTS confidence real
    CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS verification_state text
    CHECK (verification_state IN ('unverified','heuristic','empirical','proven','refuted'));
```

- **`evidence_kind`** — epistemic *role* of the content, orthogonal to `kind` (structural type).
  `reference` added for `document`/`entity`/external literature nodes (they're neither a
  hypothesis nor an experiment — they're cited source material).
- **`confidence`** — single numeric 0–1 for ALL nodes (subsumes the categorical
  `extraction_confidence` going forward; that column stays for back-compat but `confidence` is
  the one recall reads).
- **`verification_state`** — single epistemic-status axis for ALL nodes. Distinct from
  `mastery_state` (which is the *M8 pipeline progression*): `verification_state` answers "is
  this true?" while `mastery_state` answers "how far through our pipeline is it?".

### Backfill (idempotent, conservative)

```sql
-- evidence_kind from kind
UPDATE public.m8_graph_nodes SET evidence_kind = CASE kind
  WHEN 'conjecture' THEN 'hypothesis'
  WHEN 'theorem' THEN 'result'
  WHEN 'evidence' THEN 'result'
  WHEN 'counterexample' THEN 'result'
  WHEN 'failed_attempt' THEN 'failed_path'
  WHEN 'sequence' THEN 'experiment'
  WHEN 'document' THEN 'reference'
  WHEN 'entity' THEN 'reference'
  ELSE evidence_kind END
WHERE evidence_kind IS NULL;

-- confidence from source / extraction_confidence
-- extraction_confidence BEFORE the source='external' blanket: Build-27 ingested
-- claims carry source='external' too and must keep their per-claim confidence.
-- M2 seeds have NULL extraction_confidence → fall through to external → 0.9.
UPDATE public.m8_graph_nodes SET confidence = CASE
  WHEN status = 'lean_verified' OR mastery_state = 'lean_verified' THEN 1.0
  WHEN source = 'code' THEN 1.0
  WHEN extraction_confidence = 'high' THEN 0.8
  WHEN extraction_confidence = 'medium' THEN 0.6
  WHEN extraction_confidence = 'low' THEN 0.4
  WHEN source = 'external' THEN 0.9
  WHEN source = 'extraction' THEN 0.6
  ELSE confidence END
WHERE confidence IS NULL;

-- verification_state from status / mastery_state / kind
-- An INGESTED node (source='external' AND source_doc_id NOT NULL) is NEVER
-- pre-verified — 'unverified' regardless of source_class (that's a separate axis).
-- Only curated M2 seeds (external, NO source_doc_id) are 'empirical'.
UPDATE public.m8_graph_nodes SET verification_state = CASE
  WHEN status = 'lean_verified' OR mastery_state = 'lean_verified' THEN 'proven'
  WHEN kind = 'counterexample' THEN 'refuted'
  WHEN source = 'external' AND source_doc_id IS NOT NULL THEN 'unverified'  -- ingested claim
  WHEN kind = 'evidence' OR mastery_state = 'tested' THEN 'empirical'
  WHEN source = 'external' THEN 'empirical'      -- curated literature seed
  ELSE 'unverified' END
WHERE verification_state IS NULL;
```

`lean_verified` is STILL the only path to `verification_state='proven'` — ingestion/extraction
can never set `proven` (honesty contract carried from Build-27). `refuted` only via a
`counterexample`/falsifier.

## 4. Write-path changes

- **`lib/memory-graph.js · upsertNode(fields)`** — accept + persist `evidenceKind`,
  `confidence`, `verificationState`. Defaults when caller omits them, derived the same way as
  the backfill (so a code conjecture node always lands `hypothesis`/`1.0`/`unverified`, an
  evidence node `result`/`1.0`/`empirical`, etc.). On the existing-node UPDATE branch, only
  advance `verification_state` FORWARD (unverified→heuristic→empirical→proven), never downgrade
  except to `refuted` by a falsifier — mirrors `mastery_state` forward-only.
- **`lib/memory-graph.js · ingestNote()` + `extractFromNote()`** — pass the derived fields per
  node kind/source.
- **`lib/knowledge-intake.js`** — the intake path sets `evidence_kind='reference'` (documents)
  or per-claim role, `confidence` from `extraction_confidence`, `verification_state='unverified'`
  (ingested claims are never pre-verified). source_class stays as-is.
- **`lib/notebook.js · persistNote()`** caller (write-time) — no change needed if upsertNode
  derives defaults from kind.

## 5. Read-path changes

- **`buildGraphContext()` / the recall narration** — surface the provenance triple in the
  packet line per node, e.g. `(result · confidence 1.0 · proven)` / `(hypothesis · 0.6 ·
  unverified, from ingested doc)`. The existing `[SPECULATIVE]`/`[FRINGE]` source_class
  annotation (Build-28) stays. Recall already code-computes the packet; this just adds three
  fields to the per-node line — same "code computes, LLM narrates" doctrine.
- No new thresholds in v1 (that's a follow-on): just make provenance *legible*.

## 6. ⚠ DESIGN FORK (Muhammad to confirm)

`verification_state` and `confidence` overlap the intake-only `mastery_state` /
`extraction_confidence`. Two ways to go:

**Option A (recommended): add the two universal columns + keep the intake columns.**
`verification_state` = the epistemic-truth axis for ALL nodes; `mastery_state` = the M8
pipeline-stage detail (intake only). Both coexist; recall reads `verification_state`. Cleanest
semantics, no data loss, but the table carries two related status columns.

**Option B: reuse `mastery_state` as the single status axis; add only `evidence_kind` +
`confidence`.** Fewer columns, but conflates "where in our pipeline" with "is it true," and
forces code nodes (which never had a mastery_state) into the intake vocabulary.

## 7. Tests

- `tests/provenance-graph-verify.ps1` (PS mirror — no Node): the kind→evidence_kind map, the
  source→confidence map, the verification_state derivation, the forward-only advance rule, and
  the "extraction/ingestion can never reach proven/refuted" honesty invariant.
- Live (after migration): ingest a small doc + run a notebook sweep, then query a couple nodes
  and confirm the triple is populated; confirm recall narrates it.

## 8. Migration file

`migrations/m8_graph_nodes_provenance.sql` — §3 columns + indexes (`evidence_kind`,
`verification_state`) + §3 backfills. Idempotent. Applied via Supabase MCP after Muhammad
approves the fork.
