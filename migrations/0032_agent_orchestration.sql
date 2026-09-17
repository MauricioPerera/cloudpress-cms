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
