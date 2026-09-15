CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK(operation IN ('purge_content','delete_user','delete_media','uninstall_plugin')),
  payload_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','executing','accepted','failed','expired','unknown')),
  prepared_at TEXT NOT NULL,
  executed_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_state_expires ON approval_requests(state, expires_at);
CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK(event IN ('prepared','executing','accepted','failed','unknown')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_approval_events_request_created ON approval_events(request_id, created_at);
