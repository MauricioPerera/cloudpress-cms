import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { bytesToBase64, requireAdmin, requireAuthor, sha256 } from "../functions/_shared.js";
import { onRequestPost } from "../functions/api/admin/agent-execution.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const wrap = (sql, values = []) => ({
  async first(column) { const row = database.prepare(sql).get(...values) ?? null; return column && row ? row[column] : row; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
});
const DB = { prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; }, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } };
await database.prepare("INSERT INTO users(id,username,password_hash,password_salt,role) VALUES(?,?,?,?,?)").run(1, "admin", "hash", "salt", "admin");
await database.prepare("INSERT INTO agent_profiles(id,owner_id,label,purpose,status,max_active_runs,max_steps_per_run,data_policy_json) VALUES(?,?,?,?,?,?,?,?)").run("reader-agent", 1, "Lector", "Lectura trazable", "active", 1, 3, JSON.stringify({ maximumClassification: "public", allowSensitive: true }));
await database.prepare("INSERT INTO agent_profile_tools(profile_id,tool_name,risk) VALUES(?,?,?)").run("reader-agent", "cloudpress_create_draft", "reversible");
await database.prepare("INSERT INTO agent_profile_tools(profile_id,tool_name,risk) VALUES(?,?,?)").run("reader-agent", "cloudpress_sensitive_action", "sensitive");
const raw = "e".repeat(44), hash = bytesToBase64(await sha256(raw)), stamp = new Date().toISOString();
await database.prepare("INSERT INTO agent_capabilities(id,actor_id,profile_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)").run("execution-capability", 1, "reader-agent", hash, new Date(Date.now() + 60_000).toISOString(), stamp);
const taskId = crypto.randomUUID(), runId = crypto.randomUUID(), traceId = crypto.randomUUID();
await database.prepare("INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(taskId, traceId, "reader-agent", 1, "Leer estado", "[]", JSON.stringify({ classification: "public" }), "{}", "running", stamp, stamp);
await database.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(runId, taskId, 1, "running", 3, stamp, stamp);
await database.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), runId, 1, "cloudpress_create_draft", "reversible", "planned", stamp, stamp);
const headers = { Authorization: `Bearer ${raw}`, "content-type": "application/json" }, request = (body) => new Request("https://cms.example/api/admin/agent-execution", { method: "POST", headers, body: JSON.stringify(body) });
const started = await onRequestPost({ request: request({ action: "start_step", taskId, ordinal: 1 }), env: { DB } });
assert.equal(started.status, 200, "La credencial puede iniciar únicamente un paso de su tarea.");
const resumed = await onRequestPost({ request: request({ action: "start_step", taskId, ordinal: 1 }), env: { DB } });
assert.equal((await resumed.clone().json()).step.resumed, true, "Un agente puede reanudar el enlace de un paso tras recargar sin duplicar cuota.");
assert.equal(database.prepare("SELECT steps_used FROM agent_runs WHERE id=?").get(runId).steps_used, 1, "La reanudación no consume una cuota adicional.");
const businessHeaders = { ...headers, "x-cloudpress-task-id": taskId, "x-cloudpress-step-ordinal": "1" };
assert.equal((await requireAuthor(new Request("https://cms.example/api/admin/entries", { method: "POST", headers: businessHeaders, body: JSON.stringify({ status: "draft" }) }), { DB }))?.id, 1, "La herramienta del agente exige un paso activo que coincida con su contrato.");
assert.equal(await requireAuthor(new Request("https://cms.example/api/admin/entries", { method: "POST", headers, body: JSON.stringify({ status: "draft" }) }), { DB }), null, "Una capacidad no puede usar una herramienta fuera de un paso de tarea.");
const unverified = await onRequestPost({ request: request({ action: "finish_step", taskId, ordinal: 1, outcome: { result: { id: 999 }, verification: { verified: true } } }), env: { DB } });
assert.equal(unverified.status, 422, "Una postcondición de borrador inexistente no se acepta por declaración del agente.");
await database.prepare("INSERT INTO content_items(id,kind,content_type,title,slug,status,author_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(41, "post", "post", "Borrador del agente", "borrador-del-agente", "draft", 1, stamp, stamp);
const completed = await onRequestPost({ request: request({ action: "finish_step", taskId, ordinal: 1, outcome: { result: { id: 41 }, verification: { verified: true, check: "borrador creado" } } }), env: { DB } });
assert.equal(completed.status, 200, "La credencial puede persistir un resultado verificado.");
assert.equal((await completed.clone().json()).step.verified, true, "La postcondición se acepta sólo tras comprobar el estado persistido.");
const foreign = await onRequestPost({ request: request({ action: "start_step", taskId: crypto.randomUUID(), ordinal: 1 }), env: { DB } });
assert.equal(foreign.status, 422, "La credencial no puede operar tareas de otro perfil o actor.");
const sensitiveTaskId = crypto.randomUUID(), sensitiveRunId = crypto.randomUUID(), approvalId = crypto.randomUUID();
await database.prepare("INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(sensitiveTaskId, crypto.randomUUID(), "reader-agent", 1, "Purgar aprobado", "[]", JSON.stringify({ classification: "public" }), "{}", "running", stamp, stamp);
await database.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(sensitiveRunId, sensitiveTaskId, 1, "running", 3, stamp, stamp);
await database.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), sensitiveRunId, 1, "cloudpress_sensitive_action", "sensitive", "planned", JSON.stringify({ approvalOperation: "purge_content" }), stamp, stamp);
const waiting = await onRequestPost({ request: request({ action: "start_step", taskId: sensitiveTaskId, ordinal: 1 }), env: { DB } });
assert.equal(waiting.status, 200, "El canal de agente pausa el paso sensible antes de ejecutarlo.");
const sensitiveHeaders = { ...headers, "x-cloudpress-task-id": sensitiveTaskId, "x-cloudpress-step-ordinal": "1" };
assert.equal((await requireAdmin(new Request("https://cms.example/api/admin/approvals", { method: "POST", headers: sensitiveHeaders, body: JSON.stringify({ operation: "purge_content", contentId: 41 }) }), { DB }, "sensitive:approve"))?.id, 1, "La preparación sensible sólo se autoriza durante el paso A2F que la declaró.");
await database.prepare("INSERT INTO approval_requests(id,actor_id,operation,payload_json,summary_json,token_hash,expires_at,state,prepared_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(approvalId, 1, "purge_content", JSON.stringify({ operation: "purge_content", contentId: 41 }), "{}", "hash", stamp, "accepted", stamp, stamp);
const sensitiveMismatch = await onRequestPost({ request: request({ action: "finish_sensitive_step", taskId: sensitiveTaskId, ordinal: 1, approvalRequestId: approvalId, outcome: { result: { deleted: "content", id: 999 }, verification: { verified: true, check: "resultado falso" } } }), env: { DB } });
assert.equal(sensitiveMismatch.status, 422, "Un resultado sensible que contradice la aprobación aceptada se rechaza.");
const sensitiveDone = await onRequestPost({ request: request({ action: "finish_sensitive_step", taskId: sensitiveTaskId, ordinal: 1, approvalRequestId: approvalId, outcome: { result: { deleted: "content", id: 41 }, verification: { verified: true, check: "A2F aceptado" } } }), env: { DB } });
assert.equal(sensitiveDone.status, 200, "El agente sólo puede concluir su paso sensible con A2F aceptado.");
const sensitiveStep = database.prepare("SELECT result_json,verification_json FROM agent_steps WHERE run_id=? AND ordinal=1").get(sensitiveRunId);
assert.deepEqual(JSON.parse(sensitiveStep.result_json), { deleted: "content", id: 41 }, "El resultado sensible persistido procede de la aprobación, no de la declaración del agente.");
assert.equal(JSON.parse(sensitiveStep.verification_json).source, "server-approved-action", "La evidencia sensible identifica la ejecución A2F en el servidor.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["profile-bound-execution", "task-step-resume-without-extra-quota", "task-scoped-business-tool", "sensitive-task-scoped-approval", "server-postcondition-verification", "sensitive-a2f-execution-binding", "sensitive-server-outcome-verification", "persisted-agent-step", "foreign-task-denied"] }));
