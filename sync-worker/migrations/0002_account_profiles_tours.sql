PRAGMA foreign_keys = ON;

CREATE TABLE account_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  handicap REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE account_tours (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_code TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'contributor')),
  member_id TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tour_code)
);

CREATE INDEX account_tours_code ON account_tours(tour_code);
