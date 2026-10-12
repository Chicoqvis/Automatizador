CREATE TABLE IF NOT EXISTS github_my_issue_cache (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  entry TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  github_updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, repository, number)
);
CREATE INDEX IF NOT EXISTS github_my_issue_cache_user_date_idx
  ON github_my_issue_cache(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS github_my_issue_sync (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  last_synced_at INTEGER NOT NULL DEFAULT 0,
  initial_scan_done INTEGER NOT NULL DEFAULT 0
);