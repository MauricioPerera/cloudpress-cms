CREATE TABLE IF NOT EXISTS plugin_capabilities (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY(plugin_id, capability_id)
);
CREATE TABLE IF NOT EXISTS plugin_role_capabilities (
  plugin_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','author','user')),
  PRIMARY KEY(plugin_id, capability_id, role),
  FOREIGN KEY(plugin_id, capability_id) REFERENCES plugin_capabilities(plugin_id, capability_id) ON DELETE CASCADE
);
