import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
database.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id INTEGER PRIMARY KEY);
  CREATE TABLE agent_profiles(id TEXT PRIMARY KEY, owner_id INTEGER REFERENCES users(id));
  CREATE TABLE agent_tasks(id TEXT PRIMARY KEY);
  CREATE TABLE agent_runs(id TEXT PRIMARY KEY);
  INSERT INTO users(id) VALUES(1);
  INSERT INTO agent_profiles(id,owner_id) VALUES('runtime-agent',1);
  INSERT INTO agent_tasks(id) VALUES('00000000-0000-0000-0000-000000000001');
  INSERT INTO agent_runs(id) VALUES('00000000-0000-0000-0000-000000000002');
`);
database.exec(await readFile("migrations/0031_agent_runtime.sql", "utf8"));
database.exec(await readFile("migrations/0032_agent_orchestration.sql", "utf8"));
for (const table of ["agent_runtime_jobs", "agent_context_entries", "agent_memories", "agent_messages", "agent_model_catalog", "agent_model_usage", "agent_task_delegations"]) {
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), `La migración crea ${table}.`);
}
database.prepare("INSERT INTO agent_runtime_jobs(id,task_id,run_id,profile_id,provider_id,state) VALUES(?,?,?,?,?,?)").run("00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "runtime-agent", "external-webmcp", "queued");
database.prepare("INSERT INTO agent_task_delegations(id,parent_task_id,child_task_id,parent_profile_id,child_profile_id,state) VALUES(?,?,?,?,?,?)").run("00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000001", "runtime-agent", "runtime-agent", "active");
assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0, "El runtime conserva la integridad de sus referencias.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["runtime-tables", "runtime-job-insert", "orchestration-delegation-table", "foreign-key-integrity"] }));
