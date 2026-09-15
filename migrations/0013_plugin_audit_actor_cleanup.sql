CREATE TABLE plugin_audit_log_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO plugin_audit_log_v3(id,plugin_id,action,actor_id,details_json,created_at) SELECT id,plugin_id,action,actor_id,details_json,created_at FROM plugin_audit_log;
DROP TABLE plugin_audit_log;
ALTER TABLE plugin_audit_log_v3 RENAME TO plugin_audit_log;
CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created ON plugin_audit_log(plugin_id, created_at DESC);
