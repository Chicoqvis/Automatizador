CREATE TABLE account_pending_mentions(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,repository TEXT NOT NULL,comment_id INTEGER NOT NULL,entry TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,repository,comment_id));
CREATE INDEX pending_mentions_recent ON account_pending_mentions(user_id,resolved,created_at DESC);
