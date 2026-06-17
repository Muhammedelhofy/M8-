-- M8 Command Center v1 — initial ledger seed + Council decision log (Decision 2026-0617-CC)
-- Run ONCE in the Supabase SQL editor AFTER m8_command_center.sql.
-- Idempotent: the DO block no-ops if m8_cc_projects already has rows.
--
-- HONESTY: only FACTUAL fields are seeded (titles, tracks, states, deps, gate_status).
-- The score inputs (impact/urgency/risk/strategic_value/effort) are LEFT AT TABLE DEFAULTS
-- (3 = neutral). strategic_value is a HUMAN JUDGMENT (spec D1) — Muhammad sets these later;
-- M8 never invents them. So the first ranking is driven by dependency-blockage + state only.

do $$
declare
  p_gate  bigint; p_cc bigint; p_depth bigint; p_track bigint;
  t_ccengine bigint; t_logging bigint; t_snapshot bigint;
  t_warm bigint;
begin
  if (select count(*) from m8_cc_projects) > 0 then
    raise notice 'm8_cc already seeded; skipping seed.';
    return;
  end if;

  -- ── projects ──────────────────────────────────────────────────────────────
  insert into m8_cc_projects(title, track, state) values
    ('L5 honesty gate', 'infra', 'active')              returning id into p_gate;
  insert into m8_cc_projects(title, track, state) values
    ('Command Center v1', 'infra', 'active')            returning id into p_cc;
  insert into m8_cc_projects(title, track, state) values
    ('Problem-solving engine depth', 'B_research', 'planned') returning id into p_depth;
  insert into m8_cc_projects(title, track, state) values
    ('Track-A daily usefulness', 'A_ops', 'planned')    returning id into p_track;

  -- ── L5 honesty gate tasks ───────────────────────────────────────────────────
  insert into m8_cc_tasks(project_id, title, state) values
    (p_gate, 'Grader negation guards (Build 48-49)', 'done');
  insert into m8_cc_tasks(project_id, title, state, gate_status) values
    (p_gate, 'Bank 3 consecutive clean nightly gate runs', 'active', 'L5 gate');
  insert into m8_cc_tasks(project_id, title, state) values
    (p_gate, 'S4U elevation so the nightly runs logged-off', 'planned');

  -- ── Command Center v1 tasks ─────────────────────────────────────────────────
  insert into m8_cc_tasks(project_id, title, state) values
    (p_cc, 'CC engine + offline verify (step 1)', 'done')        returning id into t_ccengine;
  insert into m8_cc_tasks(project_id, title, state) values
    (p_cc, 'CC priority chat-route (step 3)', 'done');
  insert into m8_cc_tasks(project_id, title, state) values
    (p_cc, 'CC migration applied (step 2)', 'done');
  insert into m8_cc_tasks(project_id, title, state) values
    (p_cc, 'CC proactive logging + staleness alarm (step 4)', 'planned') returning id into t_logging;
  insert into m8_cc_tasks(project_id, title, state, deps) values
    (p_cc, 'CC snapshot JSON + HTML view (step 6)', 'planned', array[t_ccengine]) returning id into t_snapshot;
  insert into m8_cc_tasks(project_id, title, state, deps) values
    (p_cc, 'CC ship as Build-50 (step 7)', 'planned', array[t_logging, t_snapshot]);

  -- ── engine depth tasks ──────────────────────────────────────────────────────
  insert into m8_cc_tasks(project_id, title, state) values
    (p_depth, 'Warm-checker strategy for interactive M4', 'planned') returning id into t_warm;
  insert into m8_cc_tasks(project_id, title, state, deps) values
    (p_depth, 'M4 discharge a real non-degenerate decomposition', 'planned', array[t_warm]);
  insert into m8_cc_tasks(project_id, title, state) values
    (p_depth, 'Multi-level DAG decompositions', 'planned');

  -- ── Track-A tasks ─────────────────────────────────────────────────────────--
  insert into m8_cc_tasks(project_id, title, state) values
    (p_track, 'Business loop / multi-platform ingestion', 'planned');

  -- ── Council decision log (factual: the round happened on 2026-06-17) ─────────
  insert into m8_cc_decisions(decided_on, title, proposal, critiques, resolution, rationale)
  values (
    '2026-06-17',
    'Command Center v1 spec locked (2026-0617-CC)',
    'Build a deterministic Command Ledger + code-computed Priority Engine that M8 narrates and Muhammad approves (executive function, not authority).',
    '{"gpt":"value-weight dependency-blockage, not raw count; bands not 1..N ranks; approval becomes the bottleneck (tiers later)","grok":"single source of truth = the ledger; degraded mode required; do one thing well","gemini":"degraded-mode snapshot; render committed snapshot, no anon-key in browser","manus":"single source of truth; surface constraints, do not auto-solve; max depth guard","claude":"code computes truth, the model narrates; strategic_value is a human judgment"}'::jsonb,
    'Locked: value-weighted blockage, priority bands, degraded-mode snapshot, render the committed snapshot, max-depth-8 + cycle guards in code, decision log first-class. Approval tiers deferred.',
    'Single source of truth in Supabase prevents the two-systems drift; value-weighted blockage stops bureaucracy outranking high-value work; code computes the score so the model cannot re-rank — keeping the honesty spine intact.'
  );

  raise notice 'm8_cc seed complete.';
end $$;
