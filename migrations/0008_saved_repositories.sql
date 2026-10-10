CREATE TABLE saved_repositories (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  github_user TEXT NOT NULL DEFAULT '',
  token_cipher TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,repository)
);
INSERT INTO saved_repositories SELECT user_id,lower(owner||'/'||repo),owner,repo,repository_url,github_user,token_cipher,updated_at FROM github_connections;
