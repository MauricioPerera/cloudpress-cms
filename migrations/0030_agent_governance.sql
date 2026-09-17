-- Add an explicit non-secret human-input state and immutable governance
-- snapshots.  SQLite CHECK constraints require table replacement here.
DROP INDEX IF EXISTS idx_agent_tasks_profile_state;
ALTER TABLE agent_trace_events RENAME TO agent_trace_events_legacy;
ALTER TABLE agent_steps RENAME TO agent_steps_legacy;
ALTER TABLE agent_runs RENAME TO agent_runs_legacy;
ALTER TABLE agent_tasks RENAME TO agent_tasks_legacy;

CREATE TABLE agent_tasks (
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
CREATE TABLE agent_runs (
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
CREATE TABLE agent_steps (
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
CREATE TABLE agent_trace_events (
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
INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,started_at,completed_at,updated_at)
  SELECT id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,started_at,completed_at,updated_at FROM agent_tasks_legacy;
INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,steps_used,started_at,completed_at,created_at,updated_at)
  SELECT id,task_id,attempt,state,step_limit,steps_used,started_at,completed_at,created_at,updated_at FROM agent_runs_legacy;
INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,result_json,verification_json,error_text,approval_request_id,started_at,completed_at,created_at,updated_at)
  SELECT id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,result_json,verification_json,error_text,approval_request_id,started_at,completed_at,created_at,updated_at FROM agent_steps_legacy;
INSERT INTO agent_trace_events(id,trace_id,task_id,run_id,step_id,actor_id,event,details_json,created_at)
  SELECT id,trace_id,task_id,run_id,step_id,actor_id,event,details_json,created_at FROM agent_trace_events_legacy;
DROP TABLE agent_trace_events_legacy;
DROP TABLE agent_steps_legacy;
DROP TABLE agent_runs_legacy;
DROP TABLE agent_tasks_legacy;
CREATE INDEX idx_agent_tasks_profile_state ON agent_tasks(profile_id,state,updated_at DESC);
CREATE INDEX idx_agent_trace_events_trace ON agent_trace_events(trace_id,id);

CREATE TABLE agent_execution_snapshots (
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
CREATE INDEX idx_agent_execution_snapshots_task ON agent_execution_snapshots(task_id,created_at DESC);
CREATE TABLE agent_task_inputs (
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
CREATE INDEX idx_agent_task_inputs_task_state ON agent_task_inputs(task_id,state,requested_at DESC);
