CREATE TABLE IF NOT EXISTS totp_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','active')),
  last_used_counter INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT
);
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_codes_user_unused ON totp_recovery_codes(user_id, used_at);
CREATE TABLE IF NOT EXISTS totp_recovery_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','verified','executing','used','expired','unknown')),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_requests_token_state ON totp_recovery_requests(token_hash, state, expires_at);
