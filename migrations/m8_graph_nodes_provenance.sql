-- ============================================================================
-- M8 · Build-38 — Universal provenance + trust_state on graph nodes
-- (Supabase / Postgres — apply AFTER m8_knowledge_nodes_columns.sql)
-- ============================================================================
-- "Trust before taxonomy" (Team Round 5, crew-unanimous Q2): EVERY m8_graph_nodes
-- row — code/research nodes (conjecture/theorem/evidence/…) AND ingested
-- claim/document nodes — carries a uniform provenance set BEFORE graph expansion
-- scales. source + created_at already exist (Build-10); this adds the three
-- genuinely-missing universal axes (Option A — see BUILD_38_SPEC.md §6):
--
--   evidence_kind       epistemic ROLE of the content (orthogonal to `kind` type)
--   confidence          single numeric 0..1 for ALL nodes (subsumes the categorical
--                       intake-only extraction_confidence at recall time)
--   verification_state  single epistemic-truth axis for ALL nodes (distinct from
--                       mastery_state, which stays as the M8 pipeline-stage detail)
--
-- HONESTY CONTRACT (carried from Build-27):
--   verification_state advances FORWARD only (unverified→heuristic→empirical→proven),
--   except a falsifier may set 'refuted'. lean_verified is STILL the ONLY path to
--   'proven' — extraction/ingestion can NEVER set proven or refuted.
--
-- Idempotent + conservative: every existing row keeps its meaning; backfills derive
-- from columns already present, and leave nothing NULL it can classify.
-- ----------------------------------------------------------------------------

-- 1) New universal provenance columns -----------------------------------------
alter table public.m8_graph_nodes
  add column if not exists evidence_kind text
    check (evidence_kind in ('hypothesis','experiment','result','failed_path','reference')),
  add column if not exists confidence real
    check (confidence >= 0 and confidence <= 1),
  add column if not exists verification_state text
    check (verification_state in ('unverified','heuristic','empirical','proven','refuted'));

-- 2) Indexes ------------------------------------------------------------------
create index if not exists m8_graph_nodes_evidence_kind_idx
  on public.m8_graph_nodes (evidence_kind);
create index if not exists m8_graph_nodes_verification_idx
  on public.m8_graph_nodes (verification_state);

-- 3) Backfill: evidence_kind from kind (structural type → epistemic role) ------
update public.m8_graph_nodes set evidence_kind = case kind
    when 'conjecture'     then 'hypothesis'
    when 'theorem'        then 'result'
    when 'evidence'       then 'result'
    when 'counterexample' then 'result'
    when 'failed_attempt' then 'failed_path'
    when 'sequence'       then 'experiment'
    when 'document'       then 'reference'
    when 'entity'         then 'reference'
    when 'technique'      then 'reference'
    when 'claim'          then 'hypothesis'
    else evidence_kind end
where evidence_kind is null;

-- 4) Backfill: confidence from lean status / extraction_confidence / source ----
-- NOTE: extraction_confidence is checked BEFORE the source='external' blanket,
-- because Build-27 ingested claims carry source='external' too — they must keep
-- their per-claim extraction confidence, not the 0.9 curated-literature default.
-- M2 seed nodes have a NULL extraction_confidence, so they fall through to the
-- source='external' → 0.9 case. (Mirrors deriveConfidence in lib/memory-graph.js.)
update public.m8_graph_nodes set confidence = case
    when status = 'lean_verified' or mastery_state = 'lean_verified' then 1.0
    when source = 'code'                  then 1.0
    when extraction_confidence = 'high'   then 0.8
    when extraction_confidence = 'medium' then 0.6
    when extraction_confidence = 'low'    then 0.4
    when source = 'external'              then 0.9
    when source = 'extraction'            then 0.6
    else 0.6 end
where confidence is null;

-- 5) Backfill: verification_state from lean status / mastery_state / kind -------
-- proven only via lean; refuted only via a counterexample.
-- IMPORTANT: a Build-27 INGESTED node (source='external' AND source_doc_id IS NOT
-- NULL) is NEVER pre-verified by us — it stays 'unverified' regardless of its
-- source_class (established/speculative/fringe is a SEPARATE axis). Only the
-- curated M2 literature seeds (source='external', NO source_doc_id) are 'empirical'.
-- This MUST come before the blanket source='external' → empirical, and it mirrors
-- the write-path (populateGraph hardcodes verification_state='unverified').
update public.m8_graph_nodes set verification_state = case
    when status = 'lean_verified' or mastery_state = 'lean_verified' then 'proven'
    when kind = 'counterexample'                                     then 'refuted'
    when source = 'external' and source_doc_id is not null          then 'unverified'  -- ingested claim
    when kind = 'evidence' or mastery_state = 'tested'              then 'empirical'
    when source = 'external'                                         then 'empirical'   -- curated literature seed
    else 'unverified' end
where verification_state is null;

-- 5b) CORRECTIVE re-backfill for an already-applied earlier version of this file:
-- if ingested claims were set 'empirical' by the prior §5, demote them to
-- 'unverified' (idempotent — a no-op once correct). Does NOT touch curated seeds.
update public.m8_graph_nodes
set verification_state = 'unverified'
where source = 'external'
  and source_doc_id is not null
  and verification_state = 'empirical';

-- 6) Extend the cosine-match RPC to RETURN the new provenance fields, so recall
-- (lib/memory-graph.js renderGraphPacket) can narrate trust per node. Additive
-- for callers (they ignore extra columns), but the RETURN signature changes, so
-- the old function must be dropped first (CREATE OR REPLACE can't alter columns).
drop function if exists public.m8_graph_match(extensions.vector, int, float);
create or replace function public.m8_graph_match(
  query_embedding extensions.vector(768),
  match_count     int   default 8,
  min_similarity  float default 0.25
)
returns table (
  id bigint, kind text, label text, content text, thread text,
  status text, source text, note_id bigint, similarity float,
  source_class text, evidence_kind text, confidence real, verification_state text
)
language sql stable
set search_path = public, extensions
as $$
  select n.id, n.kind, n.label, n.content, n.thread,
         n.status, n.source, n.note_id,
         (1 - (n.embedding <=> query_embedding))::float as similarity,
         n.source_class, n.evidence_kind, n.confidence, n.verification_state
  from public.m8_graph_nodes n
  where n.embedding is not null
    and (1 - (n.embedding <=> query_embedding)) >= min_similarity
  order by n.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
