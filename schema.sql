CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_token ON agent_capabilities(token_hash);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_actor ON agent_capabilities(actor_id, expires_at);
CREATE TABLE IF NOT EXISTS agent_capability_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id TEXT NOT NULL REFERENCES agent_capabilities(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Los roles se almacenan como datos, no como una enumeración en el código.
-- `management` identifica cuentas que pueden recibir permisos internos del CMS;
-- `external` es para clientes, compradores, vendedores u otros actores de plugins.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('management','external')),
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission IN ('admin:access','dashboard:access','content:manage','content:own','media:manage','comments:moderate','taxonomies:manage','navigation:manage','settings:manage','plugins:manage','users:manage','roles:manage','import-export:manage','scheduler:manage','sensitive:approve')),
  PRIMARY KEY(role_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission, role_id);
INSERT OR IGNORE INTO roles(id,label,scope,system) VALUES
  ('admin','Administrador','management',1),
  ('author','Autor','management',1),
  ('user','Usuario','external',1);
INSERT OR IGNORE INTO role_permissions(role_id,permission) VALUES
  ('admin','dashboard:access'), ('admin','content:manage'), ('admin','content:own'),
  ('admin','media:manage'), ('admin','comments:moderate'), ('admin','taxonomies:manage'),
  ('admin','navigation:manage'), ('admin','settings:manage'), ('admin','plugins:manage'),
  ('admin','users:manage'), ('admin','roles:manage'), ('admin','import-export:manage'),
  ('admin','scheduler:manage'), ('admin','sensitive:approve'), ('author','content:own');
CREATE INDEX IF NOT EXISTS idx_agent_capability_events_capability_created ON agent_capability_events(capability_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
  max_active_runs INTEGER NOT NULL DEFAULT 1 CHECK(max_active_runs BETWEEN 1 AND 20),
  max_steps_per_run INTEGER NOT NULL DEFAULT 25 CHECK(max_steps_per_run BETWEEN 1 AND 200),
  data_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agent_profile_tools (
  profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK(risk IN ('read','reversible','sensitive')),
  PRIMARY KEY(profile_id,tool_name)
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  objective TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '[]',
  context_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT NOT NULL DEFAULT '{}',
  admission_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','waiting_input','waiting_approval','completed','failed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_profile_state ON agent_tasks(profile_id,state,updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 100),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','waiting_input','waiting_approval','completed','failed','cancelled')),
  step_limit INTEGER NOT NULL CHECK(step_limit BETWEEN 1 AND 200),
  steps_used INTEGER NOT NULL DEFAULT 0 CHECK(steps_used >= 0),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id,attempt)
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 200),
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK(risk IN ('read','reversible','sensitive')),
  state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','running','waiting_input','waiting_approval','completed','failed','skipped','cancelled')),
  preconditions_json TEXT NOT NULL DEFAULT '{}',
  input_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  verification_json TEXT,
  error_text TEXT,
  approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id,ordinal)
);
CREATE TABLE IF NOT EXISTS agent_trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  task_id TEXT REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES agent_steps(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_trace ON agent_trace_events(trace_id,id);
CREATE TABLE IF NOT EXISTS agent_execution_snapshots (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  minimum_evidence TEXT NOT NULL CHECK(minimum_evidence IN ('unverifiable','agent-attested','server-verified','approval-verified')),
  profile_snapshot_json TEXT NOT NULL,
  plan_snapshot_json TEXT NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  tool_contract_snapshot_json TEXT NOT NULL,
  profile_sha256 TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  policy_sha256 TEXT NOT NULL,
  tool_contract_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_execution_snapshots_task ON agent_execution_snapshots(task_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_task_inputs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
  field_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('public','internal','restricted')),
  state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','provided','cancelled')),
  value_json TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provided_at TEXT,
  provided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(run_id,field_name)
);
CREATE INDEX IF NOT EXISTS idx_agent_task_inputs_task_state ON agent_task_inputs(task_id,state,requested_at DESC);

-- Runtime durable de agentes. Las credenciales siguen fuera de D1: el runner
-- usa una capacidad LSFA revocable vinculada al perfil.
CREATE TABLE IF NOT EXISTS agent_runtime_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL DEFAULT 'external-webmcp' CHECK(provider_id IN ('external-webmcp','cloudflare-workers-ai')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','waiting_input','waiting_approval','completed','failed','cancelled')),
  lease_id TEXT,
  lease_expires_at TEXT,
  dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_count >= 0),
  checkpoint_json TEXT,
  context_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_runtime_jobs_claim ON agent_runtime_jobs(profile_id,state,updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runtime_jobs_lease ON agent_runtime_jobs(state,lease_expires_at);
CREATE TABLE IF NOT EXISTS agent_context_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK(classification IN ('public','internal','restricted')),
  kind TEXT NOT NULL CHECK(kind IN ('task','checkpoint','episodic_memory','message')),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK(token_estimate >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_context_entries_task ON agent_context_entries(task_id,run_id,created_at);
CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  classification TEXT NOT NULL CHECK(classification IN ('public','internal','restricted')),
  kind TEXT NOT NULL CHECK(kind IN ('episodic','semantic')),
  summary_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_memories_owner ON agent_memories(owner_id,profile_id,classification,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  recipient_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL CHECK(classification IN ('public','internal','restricted')),
  body_json TEXT NOT NULL,
  provenance_sha256 TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','received','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(recipient_profile_id,state,created_at);
CREATE TABLE IF NOT EXISTS agent_model_catalog (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL CHECK(provider_id IN ('external-webmcp','cloudflare-workers-ai')),
  model_id TEXT NOT NULL,
  label TEXT NOT NULL,
  data_residency TEXT NOT NULL,
  max_input_tokens INTEGER NOT NULL CHECK(max_input_tokens BETWEEN 1 AND 10000000),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 10000000),
  input_cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK(input_cost_microunits >= 0),
  output_cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK(output_cost_microunits >= 0),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('enabled','disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id,provider_id,model_id)
);
CREATE TABLE IF NOT EXISTS agent_model_usage (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  model_catalog_id TEXT REFERENCES agent_model_catalog(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
  cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK(cost_microunits >= 0),
  evidence_level TEXT NOT NULL CHECK(evidence_level IN ('agent-attested','server-verified')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_model_usage_run ON agent_model_usage(run_id,created_at);

CREATE TABLE IF NOT EXISTS agent_task_delegations (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  child_task_id TEXT NOT NULL UNIQUE REFERENCES agent_tasks(id) ON DELETE CASCADE,
  parent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  child_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','completed','failed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_task_delegations_parent ON agent_task_delegations(parent_task_id,state,created_at);

-- Registro operacional de las migraciones de CloudPress aplicadas mediante
-- scripts/d1-migrate.mjs. No almacena secretos ni estado de la aplicación.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('post', 'page')),
  content_type TEXT NOT NULL DEFAULT 'post',
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'trash')),
  trashed_from_status TEXT CHECK(trashed_from_status IS NULL OR trashed_from_status IN ('draft', 'published')),
  trashed_at TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_kind_status ON content_items(kind, status);
CREATE INDEX IF NOT EXISTS idx_content_author ON content_items(author_id);
CREATE INDEX IF NOT EXISTS idx_content_type_status ON content_items(content_type, status);

CREATE TABLE IF NOT EXISTS core_content_types (
  type_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  supports_json TEXT NOT NULL DEFAULT '["title","body","excerpt"]',
  public_api INTEGER NOT NULL DEFAULT 0 CHECK(public_api IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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

CREATE TABLE IF NOT EXISTS login_lockouts (
  fingerprint TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_lookup ON password_reset_tokens(token_hash, expires_at);

CREATE TABLE IF NOT EXISTS totp_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','active')),
  last_used_counter INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT
);
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_codes_user_unused ON totp_recovery_codes(user_id, used_at);
CREATE TABLE IF NOT EXISTS totp_recovery_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','verified','executing','used','expired','unknown')),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_requests_token_state ON totp_recovery_requests(token_hash, state, expires_at);

CREATE TABLE IF NOT EXISTS taxonomy_terms (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('category','tag')), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS content_terms (content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE, term_id INTEGER NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE, PRIMARY KEY(content_id, term_id));
CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, url TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comments_content_status ON comments(content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at);
CREATE TABLE IF NOT EXISTS comment_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('approved','deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comment_moderation_events_comment ON comment_moderation_events(comment_id, created_at DESC);
CREATE TABLE IF NOT EXISTS comment_rate_limits (fingerprint TEXT PRIMARY KEY, last_created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS action_rate_limits (
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  last_created_at TEXT NOT NULL,
  PRIMARY KEY(action, fingerprint)
);

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('post', 'page')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft', 'published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_content_revisions_content_created ON content_revisions(content_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_documents (
  content_id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  blocks_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS content_document_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  blocks_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_content_document_revisions_content_created ON content_document_revisions(content_id, created_at DESC);

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
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created ON plugin_audit_log(plugin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_releases (
  plugin_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  version TEXT NOT NULL,
  installed_by INTEGER,
  installed_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(plugin_id, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_plugin_releases_current ON plugin_releases(plugin_id, is_current, installed_at DESC);

CREATE TABLE IF NOT EXISTS plugin_active_releases (
  plugin_id TEXT PRIMARY KEY REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  activated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_content_types (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  type_id TEXT NOT NULL,
  label TEXT NOT NULL,
  supports_json TEXT NOT NULL,
  public_api INTEGER NOT NULL DEFAULT 0 CHECK(public_api IN (0,1)),
  PRIMARY KEY(plugin_id,type_id)
);
CREATE TABLE IF NOT EXISTS plugin_meta_definitions (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('content','user')),
  meta_key TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('string','number','boolean','json')),
  required INTEGER NOT NULL DEFAULT 0,
  schema_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(plugin_id,scope,meta_key)
);
CREATE TABLE IF NOT EXISTS content_meta (
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  meta_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(content_id,meta_key)
);
CREATE TABLE IF NOT EXISTS user_meta (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meta_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,meta_key)
);
CREATE TABLE IF NOT EXISTS plugin_actions (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  label TEXT NOT NULL,
  entity_scope TEXT NOT NULL CHECK(entity_scope IN ('content','user','site')),
  PRIMARY KEY(plugin_id,action_id)
);
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
CREATE TABLE IF NOT EXISTS plugin_capabilities (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY(plugin_id, capability_id)
);
CREATE TABLE IF NOT EXISTS plugin_role_capabilities (
  plugin_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(plugin_id, capability_id, role),
  FOREIGN KEY(plugin_id, capability_id) REFERENCES plugin_capabilities(plugin_id, capability_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plugin_webhooks (
  plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plugin_id, webhook_id)
);

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

CREATE TABLE IF NOT EXISTS media_metadata (
  media_key TEXT PRIMARY KEY CHECK(media_key LIKE 'media/%'),
  title TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
