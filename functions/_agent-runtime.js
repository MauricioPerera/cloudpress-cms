import { createTask, getProfile, trace } from "./_agent-os.js";

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

function classificationAllowed(classification, profile) {
  return CLASSIFICATIONS.includes(classification) && CLASSIFICATIONS.indexOf(classification) <= CLASSIFICATIONS.indexOf(String(profile?.dataPolicy?.maximumClassification || ""));
}

async function ownedActiveProfile(env, agent, profileId = agent.agent_profile_id) {
  const profile = await getProfile(env, profileId);
  if (!profile || profile.ownerId !== agent.id || profile.status !== "active") throw new Error("El perfil de agente no está disponible.");
  return profile;
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

async function materializeContext(env, job, agent) {
  const task = await env.DB.prepare("SELECT objective,plan_json,context_json,expected_json FROM agent_tasks WHERE id=?").bind(job.task_id).first();
  if (!task) throw new Error("La tarea del runtime no existe.");
  const steps = await env.DB.prepare("SELECT ordinal,tool_name,risk,state,result_json,verification_json FROM agent_steps WHERE run_id=? AND state='completed' ORDER BY ordinal").bind(job.run_id).all();
  let plan = [], context = {}, expected = {};
  try { plan = JSON.parse(task.plan_json); context = JSON.parse(task.context_json); expected = JSON.parse(task.expected_json); } catch { throw new Error("La tarea contiene JSON inválido."); }
  const memories = await recallEpisodicMemories(env, agent, { limit: 20 });
  const messages = await listAgentMessages(env, agent, { limit: 20, acknowledge: false });
  const payload = safe({ objective: task.objective, plan, context, expected, completedSteps: steps.results.map((step) => ({ ordinal: step.ordinal, tool: step.tool_name, risk: step.risk, result: step.result_json ? JSON.parse(step.result_json) : null, verification: step.verification_json ? JSON.parse(step.verification_json) : null })), memories, messages });
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
  const context = await materializeContext(env, candidate, agent);
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
  const catalog = await env.DB.prepare("SELECT id,input_cost_microunits,output_cost_microunits FROM agent_model_catalog WHERE owner_id=? AND provider_id=? AND model_id=? AND status='enabled'").bind(agent.id, usage.providerId, usage.modelId).first();
  const serverCost = catalog ? inputTokens * Number(catalog.input_cost_microunits) + outputTokens * Number(catalog.output_cost_microunits) : costMicrounits;
  const evidenceLevel = catalog ? "server-verified" : "agent-attested";
  await env.DB.prepare("INSERT INTO agent_model_usage(id,task_id,run_id,model_catalog_id,provider_id,model_id,input_tokens,output_tokens,cost_microunits,evidence_level,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), job.task_id, job.run_id, catalog?.id || null, usage.providerId, usage.modelId, inputTokens, outputTokens, serverCost, evidenceLevel, stamp).run();
  await runtimeTrace(env, job, "model_usage_recorded", { provider: usage.providerId, model: usage.modelId, inputTokens, outputTokens, costMicrounits: serverCost, evidenceLevel });
  return { recorded: true, costMicrounits: serverCost, evidenceLevel };
}

function modelInput(body) {
  const providerId = String(body?.providerId || ""), modelId = String(body?.modelId || ""), label = String(body?.label || "").trim(), dataResidency = String(body?.dataResidency || "").trim();
  const maxInputTokens = Number(body?.maxInputTokens), maxOutputTokens = Number(body?.maxOutputTokens), inputCostMicrounits = Number(body?.inputCostMicrounits || 0), outputCostMicrounits = Number(body?.outputCostMicrounits || 0), status = String(body?.status || "disabled");
  if (!PROVIDERS.has(providerId) || !/^[A-Za-z0-9@._/-]{1,120}$/.test(modelId) || !label || label.length > 120 || !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(dataResidency) || ![maxInputTokens, maxOutputTokens].every((value) => Number.isInteger(value) && value >= 1 && value <= 10000000) || ![inputCostMicrounits, outputCostMicrounits].every((value) => Number.isInteger(value) && value >= 0 && value <= 100000000) || !["enabled", "disabled"].includes(status)) return null;
  return { providerId, modelId, label, dataResidency, maxInputTokens, maxOutputTokens, inputCostMicrounits, outputCostMicrounits, status };
}

export async function upsertAgentModel(env, actor, body) {
  const model = modelInput(body); if (!model) throw new Error("Modelo de agente inválido.");
  const stamp = now(), id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO agent_model_catalog(id,owner_id,provider_id,model_id,label,data_residency,max_input_tokens,max_output_tokens,input_cost_microunits,output_cost_microunits,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,provider_id,model_id) DO UPDATE SET label=excluded.label,data_residency=excluded.data_residency,max_input_tokens=excluded.max_input_tokens,max_output_tokens=excluded.max_output_tokens,input_cost_microunits=excluded.input_cost_microunits,output_cost_microunits=excluded.output_cost_microunits,status=excluded.status,updated_at=excluded.updated_at").bind(id, actor.id, model.providerId, model.modelId, model.label, model.dataResidency, model.maxInputTokens, model.maxOutputTokens, model.inputCostMicrounits, model.outputCostMicrounits, model.status, stamp, stamp).run();
  return env.DB.prepare("SELECT id,provider_id,model_id,label,data_residency,max_input_tokens,max_output_tokens,input_cost_microunits,output_cost_microunits,status,created_at,updated_at FROM agent_model_catalog WHERE owner_id=? AND provider_id=? AND model_id=?").bind(actor.id, model.providerId, model.modelId).first();
}

export async function listAgentModels(env, actor) {
  return (await env.DB.prepare("SELECT id,provider_id,model_id,label,data_residency,max_input_tokens,max_output_tokens,input_cost_microunits,output_cost_microunits,status,created_at,updated_at FROM agent_model_catalog WHERE owner_id=? ORDER BY provider_id,model_id").bind(actor.id).all()).results;
}

export async function routeAgentModel(env, agent, jobId, leaseId, request) {
  const job = await leasedJob(env, agent, jobId, leaseId), profile = await ownedActiveProfile(env, agent);
  const estimatedInputTokens = Number(request?.estimatedInputTokens), estimatedOutputTokens = Number(request?.estimatedOutputTokens), preferredModelId = request?.modelId ? String(request.modelId) : null;
  if (![estimatedInputTokens, estimatedOutputTokens].every((value) => Number.isInteger(value) && value >= 0 && value <= 10000000)) throw new Error("Estimación de tokens inválida.");
  const candidates = await env.DB.prepare("SELECT id,provider_id,model_id,label,data_residency,max_input_tokens,max_output_tokens,input_cost_microunits,output_cost_microunits FROM agent_model_catalog WHERE owner_id=? AND status='enabled' ORDER BY input_cost_microunits+output_cost_microunits,model_id").bind(agent.id).all();
  const budget = Number(profile.dataPolicy?.governance?.budget?.maxModelCostMicrounits ?? 0);
  const model = candidates.results.find((item) => (!preferredModelId || item.model_id === preferredModelId) && (profile.dataPolicy?.modelResidency === "any" || item.data_residency === profile.dataPolicy?.modelResidency) && estimatedInputTokens <= item.max_input_tokens && estimatedOutputTokens <= item.max_output_tokens && estimatedInputTokens * item.input_cost_microunits + estimatedOutputTokens * item.output_cost_microunits <= budget);
  if (!model) throw new Error("No hay un modelo habilitado que cumpla residencia, tokens y presupuesto del perfil.");
  const estimatedCostMicrounits = estimatedInputTokens * model.input_cost_microunits + estimatedOutputTokens * model.output_cost_microunits;
  await runtimeTrace(env, job, "model_routed", { modelCatalogId: model.id, provider: model.provider_id, model: model.model_id, dataResidency: model.data_residency, estimatedInputTokens, estimatedOutputTokens, estimatedCostMicrounits, budgetMicrounits: budget });
  return { id: model.id, providerId: model.provider_id, modelId: model.model_id, label: model.label, dataResidency: model.data_residency, estimatedCostMicrounits, budgetMicrounits: budget };
}

export async function writeEpisodicMemory(env, agent, jobId, leaseId, body) {
  const summary = body?.summary, provenance = body?.provenance ?? {}, classification = String(body?.classification || "internal");
  if (!validObject(summary, 4000) || !validObject(provenance, 4000)) throw new Error("Memoria episódica inválida.");
  const job = await leasedJob(env, agent, jobId, leaseId), profile = await ownedActiveProfile(env, agent);
  if (!classificationAllowed(classification, profile)) throw new Error("La clasificación de memoria excede la política del perfil.");
  const normalizedSummary = safe(summary), normalizedProvenance = safe(provenance), payloadSha256 = await digest({ summary: normalizedSummary, provenance: normalizedProvenance }), stamp = now(), memoryId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_memories(id,owner_id,profile_id,classification,kind,summary_json,provenance_json,payload_sha256,expires_at,created_at) VALUES(?,?,?,?, 'episodic',?,?,?,?,?)").bind(memoryId, agent.id, agent.agent_profile_id, classification, canonicalJson(normalizedSummary), canonicalJson(normalizedProvenance), payloadSha256, body?.expiresAt || null, stamp),
    env.DB.prepare("INSERT INTO agent_context_entries(id,task_id,run_id,classification,kind,source_type,source_ref,payload_json,payload_sha256,token_estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), job.task_id, job.run_id, classification, "episodic_memory", "agent-runtime", memoryId, canonicalJson({ summary: normalizedSummary, provenance: normalizedProvenance }), payloadSha256, tokenEstimate(normalizedSummary), stamp),
  ]);
  await runtimeTrace(env, job, "episodic_memory_written", { memoryId, classification, payloadSha256 });
  return { id: memoryId, payloadSha256 };
}

export async function recallEpisodicMemories(env, agent, { limit = 20 } = {}) {
  const profile = await ownedActiveProfile(env, agent), size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await env.DB.prepare("SELECT id,classification,summary_json,provenance_json,payload_sha256,expires_at,created_at FROM agent_memories WHERE owner_id=? AND profile_id=? AND kind='episodic' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT ?").bind(agent.id, agent.agent_profile_id, now(), size).all();
  return rows.results.filter((row) => classificationAllowed(row.classification, profile)).map((row) => ({ id: row.id, classification: row.classification, summary: safe(JSON.parse(row.summary_json)), provenance: safe(JSON.parse(row.provenance_json)), payloadSha256: row.payload_sha256, createdAt: row.created_at }));
}

export async function sendAgentMessage(env, agent, jobId, leaseId, body) {
  const recipientProfileId = String(body?.recipientProfileId || ""), classification = String(body?.classification || "internal"), message = body?.message;
  if (!/^[a-z][a-z0-9-]{2,47}$/.test(recipientProfileId) || !validObject(message, 4000)) throw new Error("Mensaje entre agentes inválido.");
  const job = await leasedJob(env, agent, jobId, leaseId), sender = await ownedActiveProfile(env, agent), recipient = await ownedActiveProfile(env, agent, recipientProfileId);
  if (!classificationAllowed(classification, sender) || !classificationAllowed(classification, recipient)) throw new Error("La clasificación del mensaje excede la política de un perfil.");
  const normalized = safe(message), provenanceSha256 = await digest({ taskId: job.task_id, runId: job.run_id, senderProfileId: agent.agent_profile_id, message: normalized }), stamp = now(), messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_messages(id,task_id,run_id,sender_profile_id,recipient_profile_id,classification,body_json,provenance_sha256,state,created_at) VALUES(?,?,?,?,?,?,?,?, 'queued',?)").bind(messageId, job.task_id, job.run_id, agent.agent_profile_id, recipientProfileId, classification, canonicalJson(normalized), provenanceSha256, stamp),
    env.DB.prepare("INSERT INTO agent_context_entries(id,task_id,run_id,classification,kind,source_type,source_ref,payload_json,payload_sha256,token_estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), job.task_id, job.run_id, classification, "message", "agent-runtime", messageId, canonicalJson(normalized), provenanceSha256, tokenEstimate(normalized), stamp),
  ]);
  await runtimeTrace(env, job, "agent_message_sent", { messageId, recipientProfileId, classification, provenanceSha256 });
  return { id: messageId, provenanceSha256 };
}

export async function listAgentMessages(env, agent, { limit = 20, acknowledge = true } = {}) {
  const profile = await ownedActiveProfile(env, agent), size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await env.DB.prepare("SELECT m.id,m.task_id,m.run_id,m.sender_profile_id,m.classification,m.body_json,m.provenance_sha256,m.state,m.created_at FROM agent_messages m JOIN agent_profiles sender ON sender.id=m.sender_profile_id WHERE m.recipient_profile_id=? AND sender.owner_id=? AND m.state='queued' ORDER BY m.created_at LIMIT ?").bind(agent.agent_profile_id, agent.id, size).all();
  const visible = rows.results.filter((row) => classificationAllowed(row.classification, profile));
  if (acknowledge && visible.length) {
    const stamp = now(), placeholders = visible.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE agent_messages SET state='received',received_at=? WHERE recipient_profile_id=? AND state='queued' AND id IN (${placeholders})`).bind(stamp, agent.agent_profile_id, ...visible.map((row) => row.id)).run();
  }
  return visible.map((row) => ({ id: row.id, taskId: row.task_id, runId: row.run_id, senderProfileId: row.sender_profile_id, classification: row.classification, message: safe(JSON.parse(row.body_json)), provenanceSha256: row.provenance_sha256, createdAt: row.created_at }));
}

export async function delegateAgentTask(env, agent, parentTaskId, body) {
  if (!TASK_ID.test(String(parentTaskId))) throw new Error("Tarea padre inválida.");
  const parent = await env.DB.prepare("SELECT id,trace_id,profile_id,actor_id,state FROM agent_tasks WHERE id=?").bind(parentTaskId).first();
  if (!parent || parent.actor_id !== agent.id || parent.profile_id !== agent.agent_profile_id || !["queued", "running", "waiting_input", "waiting_approval"].includes(parent.state)) throw new Error("La tarea padre no pertenece al perfil activo.");
  const targetProfileId = String(body?.profileId || ""), parentProfile = await ownedActiveProfile(env, agent), targetProfile = await ownedActiveProfile(env, agent, targetProfileId);
  const context = body?.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
  const classification = String(context.classification || "");
  if (!classificationAllowed(classification, parentProfile) || !classificationAllowed(classification, targetProfile)) throw new Error("La delegación excede la clasificación permitida.");
  const child = await createTask(env, { id: agent.id }, { ...body, profileId: targetProfileId, context: { ...context, delegation: { parentTaskId, parentProfileId: parent.profile_id } } });
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_task_delegations(id,parent_task_id,child_task_id,parent_profile_id,child_profile_id,state,created_at) VALUES(?,?,?,?,?,'active',?)").bind(crypto.randomUUID(), parentTaskId, child.id, parent.profile_id, targetProfileId, stamp),
    env.DB.prepare("INSERT INTO agent_trace_events(trace_id,task_id,run_id,actor_id,event,details_json) VALUES(?,?,?,?,?,?)").bind(parent.trace_id, parentTaskId, null, agent.id, "task_delegated", JSON.stringify({ childTaskId: child.id, childProfileId: targetProfileId, classification })),
  ]);
  return child;
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
  if (["completed", "failed", "cancelled"].includes(state)) await env.DB.prepare("UPDATE agent_task_delegations SET state=?,completed_at=? WHERE child_task_id=? AND state='active'").bind(state, stamp, taskId).run();
  return state;
}
