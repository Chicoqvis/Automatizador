CREATE TABLE IF NOT EXISTS issue_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  entry TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,repository,number)
);
CREATE INDEX IF NOT EXISTS issue_history_user_date_idx ON issue_history(user_id,created_at);
