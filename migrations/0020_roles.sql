CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('management','external')),
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission IN ('admin:access','roles:manage','content:own')),
  PRIMARY KEY(role_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission, role_id);
INSERT OR IGNORE INTO roles(id,label,scope,system) VALUES
  ('admin','Administrador','management',1),
  ('author','Autor','management',1),
  ('user','Usuario','external',1);
INSERT OR IGNORE INTO role_permissions(role_id,permission) VALUES
  ('admin','admin:access'), ('admin','roles:manage'),
  ('admin','content:own'), ('author','content:own');

-- La versión anterior tenía un CHECK fijo para tres roles. Se recrea sin él
-- para que las capacidades de un plugin puedan asignarse a roles definidos por
-- el administrador.
CREATE TABLE plugin_role_capabilities_next (
  plugin_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(plugin_id, capability_id, role),
  FOREIGN KEY(plugin_id, capability_id) REFERENCES plugin_capabilities(plugin_id, capability_id) ON DELETE CASCADE
);
INSERT INTO plugin_role_capabilities_next(plugin_id,capability_id,role)
  SELECT plugin_id,capability_id,role FROM plugin_role_capabilities;
DROP TABLE plugin_role_capabilities;
ALTER TABLE plugin_role_capabilities_next RENAME TO plugin_role_capabilities;
