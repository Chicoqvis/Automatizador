ALTER TABLE account_memory ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE account_memory ADD COLUMN outdated INTEGER NOT NULL DEFAULT 0;
CREATE TABLE notification_cursors(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,repository TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(user_id,repository));
CREATE TABLE account_notifications(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,repository TEXT NOT NULL,comment_id INTEGER NOT NULL,entry TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,repository,comment_id));
CREATE INDEX notifications_recent ON account_notifications(user_id,created_at DESC);
