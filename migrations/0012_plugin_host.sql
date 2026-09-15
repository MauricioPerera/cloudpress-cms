CREATE TABLE IF NOT EXISTS plugin_audit_log_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO plugin_audit_log_v2(id,plugin_id,action,actor_id,details_json,created_at) SELECT id,plugin_id,action,actor_id,details_json,created_at FROM plugin_audit_log;
DROP TABLE plugin_audit_log;
ALTER TABLE plugin_audit_log_v2 RENAME TO plugin_audit_log;
CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created ON plugin_audit_log(plugin_id, created_at DESC);
CREATE TABLE IF NOT EXISTS plugin_taxonomies (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  taxonomy_id TEXT NOT NULL,
  label TEXT NOT NULL,
  hierarchical INTEGER NOT NULL DEFAULT 0,
  object_types_json TEXT NOT NULL,
  PRIMARY KEY(plugin_id, taxonomy_id)
);
CREATE TABLE IF NOT EXISTS plugin_admin_menus (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  menu_id TEXT NOT NULL,
  label TEXT NOT NULL,
  view_id TEXT NOT NULL,
  capability TEXT NOT NULL DEFAULT 'admin',
  PRIMARY KEY(plugin_id, menu_id)
);
CREATE TABLE IF NOT EXISTS plugin_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  taxonomy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_id INTEGER REFERENCES plugin_terms(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plugin_id, taxonomy_id, slug)
);
CREATE TABLE IF NOT EXISTS plugin_content_terms (
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  term_id INTEGER NOT NULL REFERENCES plugin_terms(id) ON DELETE CASCADE,
  PRIMARY KEY(content_id, term_id)
);
CREATE TABLE IF NOT EXISTS plugin_records (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plugin_id, collection_id, record_key)
);
CREATE INDEX IF NOT EXISTS idx_plugin_records_subject ON plugin_records(plugin_id, subject_user_id);
CREATE TABLE IF NOT EXISTS plugin_migrations (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  migration_id TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plugin_id, migration_id)
);
CREATE TABLE IF NOT EXISTS plugin_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  run_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plugin_id, task_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_plugin_jobs_ready ON plugin_jobs(status, run_after, id);
