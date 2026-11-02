-- One row per triage pass: what it saw and picked, and what it cost (estimated where the provider gave no price).
CREATE TABLE IF NOT EXISTS triage_passes (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary     jsonb NOT NULL DEFAULT '{}',
  cost_usd    numeric(12, 6)
);
