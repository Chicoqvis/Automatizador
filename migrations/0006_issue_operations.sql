CREATE TABLE IF NOT EXISTS issue_operations (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
