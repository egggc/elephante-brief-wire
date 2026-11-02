-- The stories a triage pass picked, by the report chosen to stand for each: only these are scored and written up.
-- coverage counts the distinct sources reporting the story (members), a heat signal that costs nothing.
CREATE TABLE IF NOT EXISTS triage_picks (
  article_id text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  pass_id    bigint NOT NULL,
  score      integer,
  reason     text,
  coverage   integer NOT NULL,
  members    text[] NOT NULL,
  receipt_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
