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

-- 4) Backfill: confidence from source / lean status / extraction_confidence ----
update public.m8_graph_nodes set confidence = case
    when status = 'lean_verified' or mastery_state = 'lean_verified' then 1.0
    when source = 'code'                  then 1.0
    when source = 'external'              then 0.9
    when extraction_confidence = 'high'   then 0.8
    when extraction_confidence = 'medium' then 0.6
    when extraction_confidence = 'low'    then 0.4
    when source = 'extraction'            then 0.6
    else 0.6 end
where confidence is null;

-- 5) Backfill: verification_state from lean status / mastery_state / kind -------
-- proven only via lean; refuted only via a counterexample.
update public.m8_graph_nodes set verification_state = case
    when status = 'lean_verified' or mastery_state = 'lean_verified' then 'proven'
    when kind = 'counterexample'                                     then 'refuted'
    when kind = 'evidence' or mastery_state = 'tested'              then 'empirical'
    when source = 'external'                                         then 'empirical'
    else 'unverified' end
where verification_state is null;
