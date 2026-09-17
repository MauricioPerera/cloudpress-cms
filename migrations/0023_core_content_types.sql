CREATE TABLE IF NOT EXISTS core_content_types (
  type_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  supports_json TEXT NOT NULL DEFAULT '["title","body","excerpt"]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
