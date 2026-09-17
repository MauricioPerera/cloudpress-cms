import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { checkpointAgentRuntimeJob, claimAgentRuntimeJob, dispatchDueAgentTasks, heartbeatAgentRuntimeJob, recordAgentModelUsage, syncAgentRuntimeTask } from "../functions/_agent-runtime.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const wrap = (sql, values = []) => ({
  async first(column) { const row = database.prepare(sql).get(...values) ?? null; return column && row ? row[column] : row; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; },
});
const DB = { prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; }, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } };
const env = { DB }, stamp = new Date().toISOString();
const taskId = "00000000-0000-0000-0000-000000000001", runId = "00000000-0000-0000-0000-000000000002", jobId = "00000000-0000-0000-0000-000000000003";
database.prepare("INSERT INTO users(id,username,password_hash,password_salt,role) VALUES(?,?,?,?,?)").run(1, "admin", "hash", "salt", "admin");
database.prepare("INSERT INTO agent_profiles(id,owner_id,label,purpose,data_policy_json) VALUES(?,?,?,?,?)").run("runtime-agent", 1, "Runtime", "Ejecutar", JSON.stringify({ maximumClassification: "internal", allowSensitive: false }));
database.prepare("INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,admission_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(taskId, "runtime-trace", "runtime-agent", 1, "Preparar el estado", JSON.stringify([{ tool: "cloudpress_read_admin_state", risk: "read" }]), JSON.stringify({ classification: "internal", accessToken: "never-export" }), "{}", "{}", "queued", stamp, stamp);
database.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(runId, taskId, 1, "queued", 2, stamp, stamp);
database.prepare("INSERT INTO agent_runtime_jobs(id,task_id,run_id,profile_id,provider_id,state,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)").run(jobId, taskId, runId, "runtime-agent", "external-webmcp", stamp, stamp);
const agent = { id: 1, agent_profile_id: "runtime-agent" };

const dispatched = await dispatchDueAgentTasks(env, { now: stamp });
assert.equal(dispatched.queued, 1, "El cron descubre tareas de agente encoladas.");
const assignment = await claimAgentRuntimeJob(env, agent, { now: stamp });
assert.ok(assignment, "La capacidad del perfil reclama una única tarea.");
assert.equal(assignment.job.id, jobId);
assert.equal(database.prepare("SELECT state FROM agent_tasks WHERE id=?").get(taskId).state, "running", "El claim inicia tarea y ejecución de forma atómica.");
assert.equal(assignment.context.context.accessToken, "[redacted]", "El contexto del runtime no propaga secretos por nombre.");
assert.equal(await claimAgentRuntimeJob(env, agent, { now: stamp }), null, "Un lease vigente impide doble ejecución.");
const checkpoint = await checkpointAgentRuntimeJob(env, agent, jobId, assignment.job.leaseId, { phase: "lectura", secret: "nunca" });
assert.match(checkpoint.checkpointSha256, /^[a-f0-9]{64}$/);
assert.equal(JSON.parse(database.prepare("SELECT checkpoint_json FROM agent_runtime_jobs WHERE id=?").get(jobId).checkpoint_json).secret, "[redacted]", "Los checkpoints también redacted secretos.");
const heartbeatNow = new Date().toISOString();
const heartbeated = await heartbeatAgentRuntimeJob(env, agent, jobId, assignment.job.leaseId, { now: heartbeatNow });
assert.ok(heartbeated.leaseExpiresAt > heartbeatNow, "El heartbeat renueva el lease limitado.");
await recordAgentModelUsage(env, agent, jobId, assignment.job.leaseId, { providerId: "external-webmcp", modelId: "browser-agent", inputTokens: 12, outputTokens: 8, costMicrounits: 0 });
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM agent_model_usage WHERE run_id=?").get(runId).total, 1, "El uso de modelo queda correlacionado a la ejecución.");
database.prepare("UPDATE agent_tasks SET state='waiting_input' WHERE id=?").run(taskId);
await syncAgentRuntimeTask(env, taskId, { now: stamp });
assert.equal(database.prepare("SELECT state FROM agent_runtime_jobs WHERE id=?").get(jobId).state, "waiting_input", "La espera humana libera el lease sin simular A2F.");
database.prepare("UPDATE agent_tasks SET state='running' WHERE id=?").run(taskId);
await syncAgentRuntimeTask(env, taskId, { now: stamp });
assert.equal(database.prepare("SELECT state FROM agent_runtime_jobs WHERE id=?").get(jobId).state, "queued", "Al recibir el dato humano, el runtime puede reclamar de nuevo la misma ejecución.");
const resumed = await claimAgentRuntimeJob(env, agent, { now: stamp });
assert.ok(resumed, "Un runner puede recuperar una ejecución pausada sin crear otra tarea.");
database.prepare("UPDATE agent_tasks SET state='completed' WHERE id=?").run(taskId);
await syncAgentRuntimeTask(env, taskId, { now: stamp });
assert.equal(database.prepare("SELECT state FROM agent_runtime_jobs WHERE id=?").get(jobId).state, "completed", "El terminal de la tarea cierra el job y su lease.");
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM agent_context_entries WHERE task_id=?").get(taskId).total, 3, "Contexto inicial, recuperación y checkpoint conservan procedencia persistente.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["scheduled-agent-dispatch", "profile-scoped-atomic-lease", "secret-redacted-context", "idempotent-claim", "checkpoint-provenance", "bounded-heartbeat", "model-usage-observability", "waiting-input-release", "resume-claim", "terminal-close"] }));
