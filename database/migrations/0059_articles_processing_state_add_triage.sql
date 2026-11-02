-- Batch triage (editorial/triage.ts): editorial items wait in 'triage' for the next pass instead of being
-- analysed one by one. The new check replaces the old one (dropped next, validated after).
ALTER TABLE articles ADD CONSTRAINT articles_processing_state_valid
  CHECK (processing_state IN ('new', 'triage', 'analyzed', 'skipped', 'failed', 'blocked')) NOT VALID;
