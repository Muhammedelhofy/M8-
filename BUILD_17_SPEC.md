# BUILD 17 — M3.1: Survivor Clustering + Human-Review Queue

*2026-06-13 · ladder M1 ✅ → M3-lite ✅ → M2 ✅ → M3-full ✅ → **M3.1** → M4-manual → L5.
Scope chosen by Muhammad: **persistent queue + triage** (the full v1). Built on Opus.*

## §0 — Mandatory critique (ground rule 4; before any code)

1. **"Rank by interestingness" is the truth-laundering trap Build-16 deliberately cut.**
   BUILD_16_SPEC §A2 killed per-survivor *surprise/compression* scalars as "the highest
   truth-laundering surface" (a number next to a machine-generated claim reads as confidence).
   M3.1 must NOT reintroduce one. **Ruling:** the queue is ordered by **structure + coverage
   only** — grouped by template family, no-pack-match-first (the Build-16 coverage precedent),
   then a stable alphabetical key. NO test-derived value (margin, observed, tested_to) enters
   the sort. Order is explicitly TRIAGE/coverage, never a truth / novelty / quality ranking.

2. **Today's 5-cap STARVES any queue.** `runConjectureGen` mines 120 → ~20 survive, but only
   the top 5 are persisted *or even shown* — the other ~15 are computed and discarded (not in
   the notebook, graph, or packet). A review queue needs that corpus. **M3.1 adds a dedicated
   store** (`m8_review_queue`) capturing ALL non-vacuous survivors. The notebook 5-cap and the
   gate are untouched.

3. **Presentation / persistence layer ONLY — gate/survival/baseline byte-identical** (the
   Build-16 invariant). The generator's pure core is unchanged except to *return* the full
   survivor list (`queueItems`); `GEN_VERSION` does NOT move. The queue table is SEPARATE from
   the notebook + graph, so the ledger of record and the recall substrate stay clean.

4. **Deterministic clustering, no embeddings in v1.** Cluster by **template family** (the
   natural structural key; `FEATURES` already pairs each template to its M1 features). Hermetic,
   sync, PS-mirror-testable. Honest semantics: "same structural family," never "semantically
   similar discovery." (Embedding adjacency is a possible v1.1 add, not v1.)

5. **Triage state is the point.** `new → kept | dismissed | reviewed`, persisted, so the queue
   shrinks toward the M4-manual entry condition ("≥1 a human finds genuinely interesting").
   Mutation follows the notebook pattern: STAGED in the context lane, applied ONCE at STORE.

6. **New laundering vector this rung introduces: "top of the queue = your best / most-novel
   discoveries."** Mitigations: (a) packet states the ordering is triage/coverage, position
   says nothing about truth/novelty; (b) Odysseus-2 Armed probe `od2arm.queue_not_ranking`
   (twin of `od2arm.rank_not_novelty`).

## Data model — `public.m8_review_queue` (migration, manual paste)

| column | type | note |
|---|---|---|
| id | bigint identity PK | the stable triage handle shown as `#id` |
| statement | text UNIQUE | canonical claim = dedup key (statementFor, incl. bound) |
| template | text | cluster key (structural family) |
| ctype | text | 'A' \| 'B' |
| features | jsonb | the M1 feature pair (display/grouping) |
| tested_to | bigint | bound N (display only — NOT a sort key) |
| train_bound | bigint | |
| seed | bigint | run seed (first seen) |
| known_match | text | seed-pack id if the FORM is known, else null |
| observed | double precision | Type B observed value (display only) |
| review_state | text default 'new' | check in (new, kept, dismissed, reviewed) |
| reviewed_at | timestamptz | |
| seen_count | int default 1 | bumped when the same statement re-appears |
| metadata | jsonb | gen/novelty version etc. |
| first_seen_at / last_seen_at | timestamptz | |

RLS enabled, service-key only (same posture as `m8_graph_nodes`). Idempotent migration.

## Components

- **`lib/conjecture-gen.js`** — `runConjectureGen` returns `queueItems` = ALL `minedSurv`
  (already `.known`-tagged) mapped to row shape. PURE; generation/gate/notes unchanged.
- **`lib/review-queue.js`** (new):
  - `clusterAndRank(items)` — PURE, the testable core. Group by template; within a group:
    unmatched (no `known_match`) first, then `statement` asc. Groups emitted by template name
    asc. NO quality/test value in any sort key.
  - `upsertQueueItems(items)` — fail-safe DB upsert by `statement` (on conflict: bump
    seen_count, refresh last_seen_at/tested_to-max/known_match/observed; never downgrade a
    human review_state).
  - `fetchQueue({states, template})`, `setReviewState(ids, state)` — DB read/write, fail-safe.
  - `detectReviewQueue(message)` — `{ mode: 'view'|'triage'|null, ids?, action? }`.
    VIEW: "review queue" / "triage queue" / "show|list … queue" / "what's queued for review".
    TRIAGE: requires a `#id` anchor — "keep #12", "dismiss #3 #4", "mark #5 reviewed",
    "reject #9" (the `#` prevents false positives like "keep going").
  - `buildReviewQueueContext(message, sessionId)` — orchestrator entry, `{ text, mode, data }`
    shape (mirrors buildGraphContext). VIEW renders the clustered packet; TRIAGE stages
    `data.write = { ids, state }` and renders a confirm packet. Read-only at build; write at STORE.
  - `renderQueuePacket(...)` — honesty-laden: machine-generated/tested-to-N contract +
    "ordering is triage/coverage, NOT a truth/novelty/quality ranking" + per-item `#id` handle
    + known-form labels + available triage commands.
- **`lib/orchestrator.js`** — (both buffered + streaming paths):
  - STORE: after the m3 notes persist, `upsertQueueItems(m3Run.queueItems)` (fail-safe, never
    blocks the run).
  - Lane: `buildReviewQueueContext` gated like graph (no other lane claimed the turn), placed
    BEFORE the graph lane so a queue ask never falls through to graph recall; exclude its text
    from the graph gate. TRIAGE write applied at STORE via `setReviewState`.
- **`lib/buildState.js`** — bump to Build-17 / M3.1.
- **`tests/odysseus/battery-m3-armed.json`** — add `od2arm.queue_not_ranking`.

## Honesty invariants (load-bearing — must hold)
- Ordering is triage/coverage; position ≠ truth/novelty/quality. (packet + probe)
- Gate / survival / baseline / matched-baseline / notebook-5-cap **byte-identical** to Build-16.
- Survivors are "machine-generated, survived falsification to N" — never interesting/established/
  literature; known-form survivors carry their label; non-match ≠ "novel".
- `GEN_VERSION` unchanged (gen/gate didn't move); queue is stamped `m3_queue_version=1`.

## Tests
- `tests/review-queue-verify.ps1` — PS mirror: clusterAndRank grouping + ordering; assert the
  sort key contains NO test/quality field (feed adversarial items where margin order ≠ output
  order); dedup-by-statement; triage verb→state mapping; `#id` parsing incl. multi-id.
- `tests/BUILD17_LIVE_TEST.md` — run generator → queue holds ~20 (not 5) → "show review queue"
  (grouped, triage framing, `#id` handles) → "dismiss #X" → re-show (X gone/marked) → Odysseus
  `od2arm.queue_not_ranking`.

## Non-goals (v1, explicit)
Embedding/semantic clustering · ANY per-survivor quality/surprise/compression scalar (Build-16
A2 stays cut) · proof scaffolding (M4) · a new Vercel API function (chat lane only — stays
under the function cap).
