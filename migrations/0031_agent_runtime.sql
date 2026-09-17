-- Runtime durable de CloudPress. No almacena credenciales de modelos: los
-- runners se autentican mediante la capacidad revocable ya vinculada al perfil.
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
