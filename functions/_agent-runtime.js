const TASK_ID = /^[A-Za-z0-9-]{36}$/;
const CLASSIFICATIONS = ["public", "internal", "restricted"];
const PROVIDERS = new Set(["external-webmcp", "cloudflare-workers-ai"]);
const now = () => new Date().toISOString();
const sensitiveKey = /(?:pass(?:word)?|secret|token|authorization|cookie|pin|otp|recovery|credential|bearer|private.?key)/i;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safe(value, key = "", depth = 0) {
  if (sensitiveKey.test(key)) return "[redacted]";
  if (typeof value === "string") return value.slice(0, 4000);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safe(item, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([name, item]) => [name, safe(item, name, depth + 1)]));
  return String(value).slice(0, 4000);
}

function validObject(value, max = 12000) {
  return value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= max;
}

function tokenEstimate(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

async function runtimeTrace(env, job, event, details = {}) {
  await env.DB.prepare("INSERT INTO agent_trace_events(trace_id,task_id,run_id,actor_id,event,details_json) SELECT trace_id,id,?,actor_id,?,? FROM agent_tasks WHERE id=?")
    .bind(job.run_id, event, JSON.stringify(safe(details)), job.task_id).run();
}

async function enqueueAgentRuntime(env, { taskId, runId, profileId, providerId = "external-webmcp", stamp = now() }) {
  if (!TASK_ID.test(String(taskId)) || !TASK_ID.test(String(runId)) || !/^[a-z][a-z0-9-]{2,47}$/.test(String(profileId)) || !PROVIDERS.has(providerId)) throw new Error("Trabajo de runtime inválido.");
  await env.DB.prepare("INSERT INTO agent_runtime_jobs(id,task_id,run_id,profile_id,provider_id,state,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)")
    .bind(crypto.randomUUID(), taskId, runId, profileId, providerId, stamp, stamp).run();
}

async function materializeContext(env, job) {
  const task = await env.DB.prepare("SELECT objective,plan_json,context_json,expected_json FROM agent_tasks WHERE id=?").bind(job.task_id).first();
  if (!task) throw new Error("La tarea del runtime no existe.");
  const steps = await env.DB.prepare("SELECT ordinal,tool_name,risk,state,result_json,verification_json FROM agent_steps WHERE run_id=? AND state='completed' ORDER BY ordinal").bind(job.run_id).all();
  let plan = [], context = {}, expected = {};
  try { plan = JSON.parse(task.plan_json); context = JSON.parse(task.context_json); expected = JSON.parse(task.expected_json); } catch { throw new Error("La tarea contiene JSON inválido."); }
  const payload = safe({ objective: task.objective, plan, context, expected, completedSteps: steps.results.map((step) => ({ ordinal: step.ordinal, tool: step.tool_name, risk: step.risk, result: step.result_json ? JSON.parse(step.result_json) : null, verification: step.verification_json ? JSON.parse(step.verification_json) : null })) });
  const payloadSha256 = await digest(payload), stamp = now();
  await env.DB.prepare("INSERT INTO agent_context_entries(id,task_id,run_id,classification,kind,source_type,source_ref,payload_json,payload_sha256,token_estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), job.task_id, job.run_id, String(context.classification || "internal"), "task", "cloudpress-task", job.task_id, canonicalJson(payload), payloadSha256, tokenEstimate(payload), stamp).run();
  await env.DB.prepare("UPDATE agent_runtime_jobs SET context_sha256=?,updated_at=? WHERE id=?").bind(payloadSha256, stamp, job.id).run();
  return { payload, payloadSha256 };
}

export async function dispatchDueAgentTasks(env, { now: stamp = now(), limit = 25, leaseTimeoutMs = 20 * 60 * 1000 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const recovered = await env.DB.prepare("UPDATE agent_runtime_jobs SET state='queued',lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE state='leased' AND lease_expires_at<=?").bind(stamp, stamp).run();
  const terminal = await env.DB.prepare("UPDATE agent_runtime_jobs SET state=(SELECT state FROM agent_tasks WHERE agent_tasks.id=agent_runtime_jobs.task_id),lease_id=NULL,lease_expires_at=NULL,completed_at=?,updated_at=? WHERE state IN ('queued','leased','waiting_input','waiting_approval') AND task_id IN (SELECT id FROM agent_tasks WHERE state IN ('completed','failed','cancelled'))").bind(stamp, stamp).run();
  const waitingInput = await env.DB.prepare("UPDATE agent_runtime_jobs SET state='waiting_input',lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE state='leased' AND task_id IN (SELECT id FROM agent_tasks WHERE state='waiting_input')").bind(stamp).run();
  const waitingApproval = await env.DB.prepare("UPDATE agent_runtime_jobs SET state='waiting_approval',lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE state='leased' AND task_id IN (SELECT id FROM agent_tasks WHERE state='waiting_approval')").bind(stamp).run();
  const ready = await env.DB.prepare("SELECT id,task_id,run_id FROM agent_runtime_jobs WHERE state='queued' AND task_id IN (SELECT id FROM agent_tasks WHERE state='queued') AND run_id IN (SELECT id FROM agent_runs WHERE state='queued') ORDER BY created_at LIMIT ?").bind(size).all();
  for (const job of ready.results) await runtimeTrace(env, job, "runtime_dispatched", { provider: "external-webmcp" });
  return { queued: ready.results.length, recovered: Number(recovered?.meta?.changes || 0), terminal: Number(terminal?.meta?.changes || 0), waitingInput: Number(waitingInput?.meta?.changes || 0), waitingApproval: Number(waitingApproval?.meta?.changes || 0) };
}

export async function claimAgentRuntimeJob(env, agent, { now: stamp = now(), leaseMs = 5 * 60 * 1000 } = {}) {
  const candidate = await env.DB.prepare("SELECT id,task_id,run_id,profile_id,provider_id FROM agent_runtime_jobs WHERE profile_id=? AND state='queued' AND task_id IN (SELECT id FROM agent_tasks WHERE actor_id=? AND profile_id=? AND state IN ('queued','running')) AND run_id IN (SELECT id FROM agent_runs WHERE state IN ('queued','running')) ORDER BY created_at LIMIT 1").bind(agent.agent_profile_id, agent.id, agent.agent_profile_id).first();
  if (!candidate) return null;
  const leaseId = crypto.randomUUID(), expires = new Date(new Date(stamp).getTime() + Math.min(Math.max(Number(leaseMs) || 300000, 30000), 900000)).toISOString();
  const claimed = await env.DB.prepare("UPDATE agent_runtime_jobs SET state='leased',lease_id=?,lease_expires_at=?,dispatch_count=dispatch_count+1,dispatched_at=?,updated_at=? WHERE id=? AND state='queued'").bind(leaseId, expires, stamp, stamp, candidate.id).run();
  if (!claimed?.meta?.changes) return null;
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_tasks SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND state IN ('queued','running')").bind(stamp, stamp, candidate.task_id),
    env.DB.prepare("UPDATE agent_runs SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND state IN ('queued','running')").bind(stamp, stamp, candidate.run_id),
  ]);
  const job = { ...candidate, leaseId, leaseExpiresAt: expires };
  const context = await materializeContext(env, candidate);
  await runtimeTrace(env, candidate, "runtime_leased", { leaseExpiresAt: expires, provider: candidate.provider_id, contextSha256: context.payloadSha256 });
  return { job: { id: candidate.id, taskId: candidate.task_id, runId: candidate.run_id, profileId: candidate.profile_id, providerId: candidate.provider_id, leaseId, leaseExpiresAt: expires }, context: context.payload };
}

async function leasedJob(env, agent, jobId, leaseId) {
  if (!TASK_ID.test(String(jobId)) || !TASK_ID.test(String(leaseId))) throw new Error("Lease de runtime inválido.");
  const job = await env.DB.prepare("SELECT id,task_id,run_id,profile_id,lease_id,lease_expires_at,state FROM agent_runtime_jobs WHERE id=? AND profile_id=? AND state='leased'").bind(jobId, agent.agent_profile_id).first();
  if (!job || job.lease_id !== leaseId || new Date(job.lease_expires_at).getTime() <= Date.now()) throw new Error("El lease del runtime no está activo.");
  return job;
}

export async function heartbeatAgentRuntimeJob(env, agent, jobId, leaseId, { now: stamp = now(), leaseMs = 5 * 60 * 1000 } = {}) {
  const job = await leasedJob(env, agent, jobId, leaseId);
  const expires = new Date(new Date(stamp).getTime() + Math.min(Math.max(Number(leaseMs) || 300000, 30000), 900000)).toISOString();
  await env.DB.prepare("UPDATE agent_runtime_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_id=? AND state='leased'").bind(expires, stamp, job.id, leaseId).run();
  return { id: job.id, leaseExpiresAt: expires };
}

export async function checkpointAgentRuntimeJob(env, agent, jobId, leaseId, checkpoint) {
  if (!validObject(checkpoint, 8000)) throw new Error("Checkpoint de runtime inválido.");
  const job = await leasedJob(env, agent, jobId, leaseId), payload = safe(checkpoint), payloadSha256 = await digest(payload), stamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_runtime_jobs SET checkpoint_json=?,updated_at=? WHERE id=? AND lease_id=? AND state='leased'").bind(canonicalJson(payload), stamp, job.id, leaseId),
    env.DB.prepare("INSERT INTO agent_context_entries(id,task_id,run_id,classification,kind,source_type,source_ref,payload_json,payload_sha256,token_estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), job.task_id, job.run_id, "internal", "checkpoint", "agent-runtime", job.id, canonicalJson(payload), payloadSha256, tokenEstimate(payload), stamp),
  ]);
  await runtimeTrace(env, job, "runtime_checkpointed", { checkpointSha256: payloadSha256 });
  return { id: job.id, checkpointSha256: payloadSha256 };
}

export async function recordAgentModelUsage(env, agent, jobId, leaseId, usage) {
  if (!validObject(usage, 2000) || !PROVIDERS.has(String(usage.providerId || "")) || !/^[A-Za-z0-9@._/-]{1,120}$/.test(String(usage.modelId || ""))) throw new Error("Uso de modelo inválido.");
  const inputTokens = Number(usage.inputTokens || 0), outputTokens = Number(usage.outputTokens || 0), costMicrounits = Number(usage.costMicrounits || 0);
  if (![inputTokens, outputTokens, costMicrounits].every((value) => Number.isInteger(value) && value >= 0 && value <= 100000000)) throw new Error("Métricas de uso inválidas.");
  const job = await leasedJob(env, agent, jobId, leaseId), stamp = now();
  await env.DB.prepare("INSERT INTO agent_model_usage(id,task_id,run_id,provider_id,model_id,input_tokens,output_tokens,cost_microunits,evidence_level,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), job.task_id, job.run_id, usage.providerId, usage.modelId, inputTokens, outputTokens, costMicrounits, "agent-attested", stamp).run();
  await runtimeTrace(env, job, "model_usage_recorded", { provider: usage.providerId, model: usage.modelId, inputTokens, outputTokens, costMicrounits, evidenceLevel: "agent-attested" });
  return { recorded: true };
}

export async function syncAgentRuntimeTask(env, taskId, { now: stamp = now() } = {}) {
  if (!TASK_ID.test(String(taskId))) return null;
  const task = await env.DB.prepare("SELECT state FROM agent_tasks WHERE id=?").bind(taskId).first();
  if (!task) return null;
  const state = task.state;
  if (["completed", "failed", "cancelled"].includes(state)) {
    await env.DB.prepare("UPDATE agent_runtime_jobs SET state=?,lease_id=NULL,lease_expires_at=NULL,completed_at=?,updated_at=? WHERE task_id=? AND state NOT IN ('completed','failed','cancelled')").bind(state, stamp, stamp, taskId).run();
  } else if (["waiting_input", "waiting_approval"].includes(state)) {
    await env.DB.prepare("UPDATE agent_runtime_jobs SET state=?,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND state='leased'").bind(state, stamp, taskId).run();
  } else if (state === "running") {
    await env.DB.prepare("UPDATE agent_runtime_jobs SET state='queued',lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE task_id=? AND state IN ('waiting_input','waiting_approval')").bind(stamp, taskId).run();
  }
  return state;
}
