CREATE TABLE IF NOT EXISTS account_repo_process (
 user_id TEXT NOT NULL,
 workspace TEXT NOT NULL,
 state TEXT NOT NULL,
 PRIMARY KEY (user_id, workspace)
);
