-- Build-85d: Multi-hop Reasoning Chain — persistence for visible step-by-step reasoning.
-- One row per complex question that ran through the chain: the decomposed
-- sub-questions + their answers (steps) and the synthesized final answer.

CREATE TABLE m8_reasoning_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  question text,
  steps jsonb,
  final_answer text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON m8_reasoning_chains(session_id);
