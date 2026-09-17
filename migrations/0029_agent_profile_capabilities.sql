ALTER TABLE agent_capabilities ADD COLUMN profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_profile ON agent_capabilities(profile_id, expires_at);
