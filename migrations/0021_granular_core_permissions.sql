CREATE TABLE role_permissions_next (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission IN ('admin:access','dashboard:access','content:manage','content:own','media:manage','comments:moderate','taxonomies:manage','navigation:manage','settings:manage','plugins:manage','users:manage','roles:manage','import-export:manage','scheduler:manage')),
  PRIMARY KEY(role_id, permission)
);
INSERT INTO role_permissions_next(role_id,permission) SELECT role_id,permission FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_next RENAME TO role_permissions;
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission, role_id);
INSERT OR IGNORE INTO role_permissions(role_id,permission) VALUES
  ('admin','dashboard:access'), ('admin','content:manage'), ('admin','content:own'),
  ('admin','media:manage'), ('admin','comments:moderate'), ('admin','taxonomies:manage'),
  ('admin','navigation:manage'), ('admin','settings:manage'), ('admin','plugins:manage'),
  ('admin','users:manage'), ('admin','roles:manage'), ('admin','import-export:manage'),
  ('admin','scheduler:manage');
