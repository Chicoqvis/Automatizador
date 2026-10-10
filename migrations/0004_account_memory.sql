CREATE TABLE IF NOT EXISTS account_memory (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 repository TEXT NOT NULL,
 number INTEGER NOT NULL,
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,repository,number)
);
CREATE INDEX IF NOT EXISTS account_memory_user_date_idx ON account_memory(user_id,created_at);
