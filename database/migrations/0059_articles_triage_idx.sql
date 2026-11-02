CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_triage_idx ON articles (discovered_at) WHERE processing_state = 'triage';
