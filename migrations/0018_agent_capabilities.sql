CREATE TABLE IF NOT EXISTS agent_capabilities (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_token ON agent_capabilities(token_hash);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_actor ON agent_capabilities(actor_id, expires_at);
