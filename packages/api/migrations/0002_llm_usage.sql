CREATE TABLE IF NOT EXISTS llm_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  tag TEXT,
  PRIMARY KEY (user_id, day)
);
