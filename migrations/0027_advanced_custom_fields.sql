CREATE TABLE IF NOT EXISTS custom_field_groups (
  group_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_custom_field_groups_type ON custom_field_groups(content_type,active);
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  group_id TEXT NOT NULL REFERENCES custom_field_groups(group_id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('text','textarea','number','boolean','date','email','url','select','reference')),
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  relation_type TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,field_id),
  CHECK((value_type='reference' AND relation_type IS NOT NULL) OR (value_type<>'reference' AND relation_type IS NULL))
);
