CREATE TABLE IF NOT EXISTS action_rate_limits (
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  last_created_at TEXT NOT NULL,
  PRIMARY KEY(action, fingerprint)
);
