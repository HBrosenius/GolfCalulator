PRAGMA foreign_keys = ON;

ALTER TABLE sessions ADD COLUMN session_id TEXT;
ALTER TABLE sessions ADD COLUMN device_name TEXT;
ALTER TABLE sessions ADD COLUMN device_type TEXT;

CREATE UNIQUE INDEX sessions_public_id ON sessions(session_id);

CREATE TABLE account_security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  device_name TEXT,
  details TEXT
);

CREATE INDEX account_security_events_user ON account_security_events(user_id, created_at DESC);
