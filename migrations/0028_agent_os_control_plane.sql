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
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','waiting_approval','completed','failed','cancelled')),
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
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','waiting_approval','completed','failed','cancelled')),
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
  state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','running','waiting_approval','completed','failed','skipped','cancelled')),
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
