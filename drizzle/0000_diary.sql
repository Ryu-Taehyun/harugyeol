CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  start_day TEXT
);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expires_at);
--> statement-breakpoint
CREATE TABLE diaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  plan TEXT NOT NULL,
  action TEXT NOT NULL,
  reflection TEXT NOT NULL,
  mood TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, day)
);
--> statement-breakpoint
CREATE TABLE rules (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  original TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revised TEXT,
  reason TEXT,
  revised_at TEXT
);
--> statement-breakpoint
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX rate_limits_bucket ON rate_limits(bucket);
