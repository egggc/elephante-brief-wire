-- Every bookmarked post already taken in, and the article it became (null when it could not be taken in).
CREATE TABLE IF NOT EXISTS x_bookmarks_picks (
  tweet_id   text PRIMARY KEY,
  article_id text,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
