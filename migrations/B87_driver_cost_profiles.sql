-- migrations/B87_driver_cost_profiles.sql
-- Build-87: Driver Cost Profiles — real per-driver P&L.
-- Stores monthly costs per driver: rental, salary, fuel estimate, other.
-- Real net = gross_earnings (from Bolt) - sum of all cost columns.
-- All amounts in SAR/month. Idempotent (safe to re-apply).

CREATE TABLE IF NOT EXISTS driver_cost_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_name    text NOT NULL UNIQUE,
  rental_amount  numeric(10,2) NOT NULL DEFAULT 0,  -- monthly car rental (SAR)
  salary_amount  numeric(10,2) NOT NULL DEFAULT 0,  -- monthly salary/fleet-cut (SAR)
  fuel_estimate  numeric(10,2) NOT NULL DEFAULT 0,  -- monthly fuel estimate (SAR)
  other_costs    numeric(10,2) NOT NULL DEFAULT 0,  -- any other recurring cost (SAR)
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_driver_cost_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_cost_profiles_updated_at ON driver_cost_profiles;
CREATE TRIGGER driver_cost_profiles_updated_at
  BEFORE UPDATE ON driver_cost_profiles
  FOR EACH ROW EXECUTE PROCEDURE update_driver_cost_profiles_updated_at();

-- Index for case-insensitive name lookups (matches ilike queries in cost-profiles.js)
CREATE INDEX IF NOT EXISTS driver_cost_profiles_name_idx
  ON driver_cost_profiles (lower(driver_name));
