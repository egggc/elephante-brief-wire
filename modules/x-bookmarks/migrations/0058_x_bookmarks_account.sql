-- The X account whose bookmarks are the editor's picks (modules/x-bookmarks): one row, written by
-- scripts/x-auth.ts and kept current by every token refresh (X rotates the refresh token each time).
CREATE TABLE IF NOT EXISTS x_bookmarks_account (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  user_id       text NOT NULL,
  username      text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
