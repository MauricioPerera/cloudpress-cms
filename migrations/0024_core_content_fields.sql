CREATE TABLE IF NOT EXISTS core_content_fields (
  type_id TEXT NOT NULL REFERENCES core_content_types(type_id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('string','number','boolean','date','reference')),
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  relation_type TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(type_id,field_id),
  CHECK((value_type='reference' AND relation_type IS NOT NULL) OR (value_type<>'reference' AND relation_type IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_core_content_fields_type ON core_content_fields(type_id,field_id);
