CREATE TABLE IF NOT EXISTS plugin_installations (
  plugin_id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('enabled','disabled')),
  installed_by INTEGER NOT NULL REFERENCES users(id),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plugin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('installed','enabled','disabled','validation_failed')),
  actor_id INTEGER REFERENCES users(id),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created ON plugin_audit_log(plugin_id, created_at DESC);
