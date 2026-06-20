-- Build-92: Conjecture Outcome Memory — closes the learning loop.
-- One row per Lean-leaf-verified conjecture. A verified leaf is one machine-check,
-- NOT a proof of the conjecture — these are "verified leaf" outcomes, never "proven".
-- Read back by lib/conjecture-memory.js getSuccessPatterns to steer the proposer.

CREATE TABLE IF NOT EXISTS m8_conjecture_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id text NOT NULL,
  conjecture_text text NOT NULL,
  lean_proof_sketch text,
  structural_tags text[],
  verified_at timestamptz NOT NULL DEFAULT now(),
  loop_run_id uuid
);
CREATE INDEX IF NOT EXISTS m8_co_problem_idx ON m8_conjecture_outcomes(problem_id);
