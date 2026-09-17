const PROFILE_ID = /^[a-z][a-z0-9-]{2,47}$/;
const TOOL_NAME = /^cloudpress_[a-z0-9_]{2,80}$/;
const RISK = new Set(["read", "reversible", "sensitive"]);
const CLASSIFICATIONS = ["public", "internal", "restricted"];
const TASK_STATES = new Set(["queued", "running", "paused", "waiting_approval", "completed", "failed", "cancelled"]);
const STEP_STATES = new Set(["planned", "running", "waiting_approval", "completed", "failed", "skipped", "cancelled"]);
const now = () => new Date().toISOString();
const validObject = (value, max = 12000) => value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= max;
const validPlan = (value) => Array.isArray(value) && value.length <= 200 && value.every((item) => validObject(item, 4000));
const parse = (row) => ({ ...row, ...(row.plan_json ? { plan: JSON.parse(row.plan_json) } : {}), ...(row.context_json ? { context: JSON.parse(row.context_json) } : {}), ...(row.expected_json ? { expected: JSON.parse(row.expected_json) } : {}), ...(row.data_policy_json ? { dataPolicy: JSON.parse(row.data_policy_json) } : {}) });

function profileInput(body) {
  const id = String(body?.id || "").trim().toLowerCase(), label = String(body?.label || "").trim(), purpose = String(body?.purpose || "").trim();
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const maxActiveRuns = Number(body?.maxActiveRuns ?? 1), maxStepsPerRun = Number(body?.maxStepsPerRun ?? 25), dataPolicy = body?.dataPolicy ?? {};
  const maximumClassification = String(dataPolicy?.maximumClassification || "");
  if (!PROFILE_ID.test(id) || !label || label.length > 80 || !purpose || purpose.length > 500 || !Number.isInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 20 || !Number.isInteger(maxStepsPerRun) || maxStepsPerRun < 1 || maxStepsPerRun > 200 || !validObject(dataPolicy, 4000) || !CLASSIFICATIONS.includes(maximumClassification) || typeof dataPolicy.allowSensitive !== "boolean" || tools.length > 100 || tools.some((tool) => !tool || !TOOL_NAME.test(String(tool.name || "")) || !RISK.has(tool.risk)) || (tools.some((tool) => tool.risk === "sensitive") && !dataPolicy.allowSensitive)) return null;
  const unique = new Map(tools.map((tool) => [tool.name, tool.risk])); if (unique.size !== tools.length) return null;
  return { id, label, purpose, maxActiveRuns, maxStepsPerRun, dataPolicy: { maximumClassification, allowSensitive: dataPolicy.allowSensitive }, tools };
}

async function trace(env, { traceId, taskId = null, runId = null, stepId = null, actorId = null, event, details = {} }) {
  await env.DB.prepare("INSERT INTO agent_trace_events(trace_id,task_id,run_id,step_id,actor_id,event,details_json) VALUES(?,?,?,?,?,?,?)").bind(traceId, taskId, runId, stepId, actorId, event, JSON.stringify(details)).run();
}

async function getProfile(env, id) {
  const profile = await env.DB.prepare("SELECT id,owner_id,label,purpose,status,max_active_runs,max_steps_per_run,data_policy_json,created_at,updated_at FROM agent_profiles WHERE id=?").bind(id).first();
  if (!profile) return null;
  const tools = await env.DB.prepare("SELECT tool_name,risk FROM agent_profile_tools WHERE profile_id=? ORDER BY tool_name").bind(id).all();
  return { ...parse(profile), ownerId: profile.owner_id, maxActiveRuns: profile.max_active_runs, maxStepsPerRun: profile.max_steps_per_run, tools: tools.results.map((tool) => ({ name: tool.tool_name, risk: tool.risk })) };
}

async function listProfiles(env) {
  const profiles = await env.DB.prepare("SELECT id,owner_id,label,purpose,status,max_active_runs,max_steps_per_run,data_policy_json,created_at,updated_at FROM agent_profiles ORDER BY label COLLATE NOCASE").all();
  return Promise.all(profiles.results.map((profile) => getProfile(env, profile.id)));
}

async function createProfile(env, actorId, body) {
  const profile = profileInput(body); if (!profile) throw new Error("Perfil de agente inválido.");
  const stamp = now();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO agent_profiles(id,owner_id,label,purpose,status,max_active_runs,max_steps_per_run,data_policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(profile.id, actorId, profile.label, profile.purpose, "active", profile.maxActiveRuns, profile.maxStepsPerRun, JSON.stringify(profile.dataPolicy), stamp, stamp),
      ...profile.tools.map((tool) => env.DB.prepare("INSERT INTO agent_profile_tools(profile_id,tool_name,risk) VALUES(?,?,?)").bind(profile.id, tool.name, tool.risk)),
    ]);
  } catch { throw new Error("Ese identificador de perfil ya existe."); }
  return getProfile(env, profile.id);
}

async function createTask(env, actor, body) {
  const profileId = String(body?.profileId || ""), objective = String(body?.objective || "").trim();
  const plan = body?.plan ?? [], context = body?.context ?? {}, expected = body?.expected ?? {};
  if (!PROFILE_ID.test(profileId) || !objective || objective.length > 2000 || !validPlan(plan) || !validObject(context) || !validObject(expected)) throw new Error("Tarea de agente inválida.");
  const profile = await getProfile(env, profileId); if (!profile || profile.ownerId !== actor.id || profile.status !== "active") throw new Error("El perfil de agente no está disponible para este usuario.");
  const classification = String(context?.classification || "");
  if (!CLASSIFICATIONS.includes(classification) || CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(profile.dataPolicy.maximumClassification)) throw new Error("La clasificación de datos de la tarea excede la política del perfil.");
  const active = await env.DB.prepare("SELECT COUNT(*) AS total FROM agent_tasks WHERE profile_id=? AND state IN ('queued','running','waiting_approval')").bind(profileId).first();
  if (Number(active?.total || 0) >= profile.max_active_runs) throw new Error("El perfil alcanzó su límite de tareas activas.");
  if (plan.length > profile.max_steps_per_run) throw new Error("El plan excede el límite de pasos del perfil.");
  const taskId = crypto.randomUUID(), runId = crypto.randomUUID(), traceId = crypto.randomUUID(), stamp = now();
  const statements = [
    env.DB.prepare("INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(taskId, traceId, profileId, actor.id, objective, JSON.stringify(plan), JSON.stringify(context), JSON.stringify(expected), "queued", stamp, stamp),
    env.DB.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId, taskId, 1, "queued", profile.maxStepsPerRun, stamp, stamp),
  ];
  for (const [index, step] of plan.entries()) {
    const toolName = String(step.tool || ""), risk = String(step.risk || "read");
    if (!TOOL_NAME.test(toolName) || !RISK.has(risk) || !profile.tools.some((tool) => tool.name === toolName && tool.risk === risk)) throw new Error("El plan solicita una herramienta no permitida por el perfil.");
    if (risk === "sensitive" && !/^[a-z_]{3,80}$/.test(String(step?.preconditions?.approvalOperation || ""))) throw new Error("Un paso sensible debe declarar la operación irreversible aprobada.");
    statements.push(env.DB.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,created_at,updated_at) VALUES(?,?,?,?,?,'planned',?,?,?,?,?)").bind(crypto.randomUUID(), runId, index + 1, toolName, risk, JSON.stringify(step.preconditions || {}), JSON.stringify(step.input || {}), JSON.stringify(step.expected || {}), stamp, stamp));
  }
  await env.DB.batch(statements);
  await trace(env, { traceId, taskId, runId, actorId: actor.id, event: "task_created", details: { profileId, plannedSteps: plan.length, objective } });
  return { id: taskId, runId, traceId, state: "queued", profileId, objective };
}

async function taskDetail(env, id) {
  const task = await env.DB.prepare("SELECT id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,state,created_at,started_at,completed_at,updated_at FROM agent_tasks WHERE id=?").bind(id).first();
  if (!task) return null;
  const runs = await env.DB.prepare("SELECT id,attempt,state,step_limit,steps_used,started_at,completed_at,created_at,updated_at FROM agent_runs WHERE task_id=? ORDER BY attempt DESC").bind(id).all();
  const hydratedRuns = await Promise.all(runs.results.map(async (run) => ({ ...run, steps: (await env.DB.prepare("SELECT id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,result_json,verification_json,error_text,approval_request_id,started_at,completed_at,created_at,updated_at FROM agent_steps WHERE run_id=? ORDER BY ordinal").bind(run.id).all()).results.map((step) => ({ ...step, preconditions: JSON.parse(step.preconditions_json), input: JSON.parse(step.input_json), expected: JSON.parse(step.expected_json), result: step.result_json ? JSON.parse(step.result_json) : null, verification: step.verification_json ? JSON.parse(step.verification_json) : null })) })));
  const events = await env.DB.prepare("SELECT id,run_id,step_id,actor_id,event,details_json,created_at FROM agent_trace_events WHERE task_id=? ORDER BY id DESC LIMIT 200").bind(id).all();
  return { ...parse(task), runs: hydratedRuns, trace: events.results.map((event) => ({ ...event, details: JSON.parse(event.details_json) })) };
}

const taskTransitions = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["paused", "waiting_approval", "completed", "failed", "cancelled"])],
  ["paused", new Set(["queued", "cancelled"])],
  ["waiting_approval", new Set(["cancelled"])],
  ["failed", new Set(["cancelled"])],
]);

async function currentTaskRun(env, taskId) {
  const task = await env.DB.prepare("SELECT id,trace_id,profile_id,actor_id,plan_json,state FROM agent_tasks WHERE id=?").bind(taskId).first();
  if (!task) throw new Error("Tarea no encontrada.");
  const run = await env.DB.prepare("SELECT id,attempt,state,step_limit,steps_used FROM agent_runs WHERE task_id=? ORDER BY attempt DESC LIMIT 1").bind(taskId).first();
  if (!run) throw new Error("La tarea no tiene ejecución.");
  return { task, run };
}

// A capability may invoke a business tool only while it owns the exact step
// declared for that tool.  This is deliberately separate from authentication:
// a valid capability is not a standing delegation to act outside a task.
async function activeAgentStep(env, agent, taskId, ordinal, toolName, risk) {
  if (!/^[A-Za-z0-9-]{36}$/.test(String(taskId || "")) || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 200 || !TOOL_NAME.test(String(toolName || "")) || !RISK.has(risk)) return null;
  const expectedState = risk === "sensitive" ? "waiting_approval" : "running";
  return env.DB.prepare("SELECT agent_steps.id,agent_runs.id AS run_id,agent_tasks.trace_id FROM agent_tasks JOIN agent_runs ON agent_runs.task_id=agent_tasks.id JOIN agent_steps ON agent_steps.run_id=agent_runs.id WHERE agent_tasks.id=? AND agent_tasks.actor_id=? AND agent_tasks.profile_id=? AND agent_tasks.state=? AND agent_runs.state=? AND agent_runs.attempt=(SELECT MAX(attempt) FROM agent_runs WHERE task_id=agent_tasks.id) AND agent_steps.ordinal=? AND agent_steps.tool_name=? AND agent_steps.risk=? AND agent_steps.state=?")
    .bind(taskId, agent.id, agent.agent_profile_id, expectedState, expectedState, ordinal, toolName, risk, expectedState).first();
}

async function transitionTask(env, actor, taskId, nextState, reason = "") {
  if (!TASK_STATES.has(nextState)) throw new Error("Estado de tarea inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (!taskTransitions.get(task.state)?.has(nextState)) throw new Error("Transición de tarea no permitida.");
  if (nextState === "completed") {
    const pending = await env.DB.prepare("SELECT 1 FROM agent_steps WHERE run_id=? AND state NOT IN ('completed','skipped') LIMIT 1").bind(run.id).first();
    if (pending) throw new Error("No se puede completar una tarea con pasos no verificados.");
  }
  const stamp = now(), terminal = ["completed", "failed", "cancelled"].includes(nextState);
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_tasks SET state=?,started_at=CASE WHEN ?='running' AND started_at IS NULL THEN ? ELSE started_at END,completed_at=CASE WHEN ? THEN ? ELSE NULL END,updated_at=? WHERE id=?").bind(nextState, nextState, stamp, terminal ? 1 : 0, terminal ? stamp : null, stamp, taskId),
    env.DB.prepare("UPDATE agent_runs SET state=?,started_at=CASE WHEN ?='running' AND started_at IS NULL THEN ? ELSE started_at END,completed_at=CASE WHEN ? THEN ? ELSE NULL END,updated_at=? WHERE id=?").bind(nextState, nextState, stamp, terminal ? 1 : 0, terminal ? stamp : null, stamp, run.id),
  ]);
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, actorId: actor.id, event: "task_transition", details: { from: task.state, to: nextState, reason: String(reason || "").slice(0, 500) } });
  return { id: taskId, runId: run.id, state: nextState };
}

async function startStep(env, actor, taskId, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 200) throw new Error("Paso inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.state !== "running" || run.state !== "running") throw new Error("La tarea no está en ejecución.");
  const step = await env.DB.prepare("SELECT id,tool_name,risk,state FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step) throw new Error("El paso no está disponible.");
  // Re-attaching a companion after a browser reload must not consume another
  // quota unit or leave an already-running step permanently inaccessible.
  if (step.state === "running" && task.state === "running" && run.state === "running") return { id: step.id, state: "running", tool: step.tool_name, resumed: true };
  if (step.state === "waiting_approval" && step.risk === "sensitive" && task.state === "waiting_approval" && run.state === "waiting_approval") return { id: step.id, state: "waiting_approval", requiresApproval: true, resumed: true };
  if (step.state !== "planned") throw new Error("El paso no está disponible.");
  const previous = await env.DB.prepare("SELECT 1 FROM agent_steps WHERE run_id=? AND ordinal<? AND state NOT IN ('completed','skipped') LIMIT 1").bind(run.id, ordinal).first();
  if (previous) throw new Error("Los pasos anteriores deben verificarse primero.");
  if (step.risk === "sensitive") {
    const stamp = now();
    await env.DB.batch([
      env.DB.prepare("UPDATE agent_steps SET state='waiting_approval',updated_at=? WHERE id=? AND state='planned'").bind(stamp, step.id),
      env.DB.prepare("UPDATE agent_runs SET state='waiting_approval',updated_at=? WHERE id=?").bind(stamp, run.id),
      env.DB.prepare("UPDATE agent_tasks SET state='waiting_approval',updated_at=? WHERE id=?").bind(stamp, taskId),
    ]);
    await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "step_waiting_approval", details: { ordinal, tool: step.tool_name } });
    return { id: step.id, state: "waiting_approval", requiresApproval: true };
  }
  const claimed = await env.DB.prepare("UPDATE agent_runs SET steps_used=steps_used+1,updated_at=? WHERE id=? AND state='running' AND steps_used<step_limit").bind(now(), run.id).run();
  if (!claimed.meta?.changes) throw new Error("La ejecución alcanzó su límite de pasos.");
  const stamp = now();
  await env.DB.prepare("UPDATE agent_steps SET state='running',started_at=?,updated_at=? WHERE id=? AND state='planned'").bind(stamp, stamp, step.id).run();
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "step_started", details: { ordinal, tool: step.tool_name } });
  return { id: step.id, state: "running", tool: step.tool_name };
}

async function finishStep(env, actor, taskId, ordinal, outcome) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || !validObject(outcome?.result ?? {}) || !validObject(outcome?.verification ?? {})) throw new Error("Resultado de paso inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  const step = await env.DB.prepare("SELECT id,tool_name,state FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step || step.state !== "running") throw new Error("El paso no está en ejecución.");
  if (outcome.verification.verified !== true) throw new Error("El paso requiere una postcondición verificada.");
  const stamp = now();
  await env.DB.prepare("UPDATE agent_steps SET state='completed',result_json=?,verification_json=?,completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(JSON.stringify(outcome.result), JSON.stringify(outcome.verification), stamp, stamp, step.id).run();
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "step_verified", details: { ordinal, tool: step.tool_name, verification: outcome.verification } });
  return { id: step.id, state: "completed", verified: true };
}

async function failStep(env, actor, taskId, ordinal, errorText) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || !String(errorText || "").trim() || String(errorText).length > 1000) throw new Error("Fallo de paso inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.state !== "running" || run.state !== "running") throw new Error("La tarea no está en ejecución.");
  const step = await env.DB.prepare("SELECT id,tool_name,state FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step || step.state !== "running") throw new Error("El paso no está en ejecución.");
  const stamp = now(), message = String(errorText).trim();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_steps SET state='failed',error_text=?,completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(message, stamp, stamp, step.id),
    env.DB.prepare("UPDATE agent_runs SET state='failed',completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(stamp, stamp, run.id),
    env.DB.prepare("UPDATE agent_tasks SET state='failed',completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(stamp, stamp, taskId),
  ]);
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "step_failed", details: { ordinal, tool: step.tool_name, error: message } });
  return { id: step.id, state: "failed" };
}

// Sensitive operations are executed by the approval endpoint, never by this
// recorder. Persist only the canonical outcome of that accepted operation.
function approvedSensitiveResult(payload) {
  if (payload.operation === "purge_content") return { deleted: "content", id: payload.contentId };
  if (payload.operation === "delete_user") return { deleted: "user", id: payload.userId };
  if (payload.operation === "delete_media") return { deleted: "media", key: payload.key };
  if (payload.operation === "uninstall_plugin") return { deleted: "plugin", id: payload.pluginId, policy: payload.policy || "preserve-content-purge-plugin-storage" };
  if (payload.operation === "delete_metadata") return { deleted: "metadata", scope: payload.scope, entityId: payload.entityId, key: payload.key };
  if (payload.operation === "delete_core_term") return { deleted: "core_term", id: payload.termId };
  if (payload.operation === "delete_plugin_term") return { deleted: "plugin_term", id: payload.termId, pluginId: payload.pluginId, taxonomyId: payload.taxonomyId };
  return null;
}

function sameApprovedResult(actual, expected) {
  return validObject(actual) && Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
}

async function finishSensitiveStep(env, actor, taskId, ordinal, approvalRequestId, outcome) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || !/^[A-Za-z0-9-]{36}$/.test(String(approvalRequestId || "")) || !validObject(outcome?.result ?? {}) || !validObject(outcome?.verification ?? {})) throw new Error("Confirmación sensible inválida.");
  if (outcome.verification.verified !== true) throw new Error("El paso requiere una postcondición verificada.");
  const { task, run } = await currentTaskRun(env, taskId);
  const step = await env.DB.prepare("SELECT id,tool_name,state,preconditions_json FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step || step.state !== "waiting_approval" || task.state !== "waiting_approval" || run.state !== "waiting_approval") throw new Error("El paso no está esperando una aprobación.");
  const approval = await env.DB.prepare("SELECT id,payload_json FROM approval_requests WHERE id=? AND actor_id=? AND state='accepted'").bind(approvalRequestId, actor.id).first();
  if (!approval) throw new Error("La aprobación A2F no fue aceptada para este usuario.");
  const preconditions = JSON.parse(step.preconditions_json);
  let payload; try { payload = JSON.parse(approval.payload_json); } catch { throw new Error("La aprobación A2F no tiene un payload válido."); }
  if (payload.operation !== preconditions.approvalOperation) throw new Error("La aprobación A2F corresponde a otra operación.");
  const approvedResult = approvedSensitiveResult(payload);
  if (!approvedResult || !sameApprovedResult(outcome.result, approvedResult)) throw new Error("El resultado no coincide con la operación A2F ejecutada.");
  const alreadyLinked = await env.DB.prepare("SELECT 1 FROM agent_steps WHERE approval_request_id=? LIMIT 1").bind(approvalRequestId).first();
  if (alreadyLinked) throw new Error("Esta aprobación A2F ya está vinculada a otro paso.");
  const stamp = now();
  const claimed = await env.DB.prepare("UPDATE agent_runs SET steps_used=steps_used+1,state='running',updated_at=? WHERE id=? AND state='waiting_approval' AND steps_used<step_limit").bind(stamp, run.id).run();
  if (!claimed.meta?.changes) throw new Error("La ejecución alcanzó su límite de pasos.");
  const verification = { ...outcome.verification, verified: true, source: "server-approved-action", evidence: { type: "approval_execution", approvalRequestId, operation: payload.operation } };
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_steps SET state='completed',approval_request_id=?,result_json=?,verification_json=?,completed_at=?,updated_at=? WHERE id=? AND state='waiting_approval'").bind(approvalRequestId, JSON.stringify(approvedResult), JSON.stringify(verification), stamp, stamp, step.id),
    env.DB.prepare("UPDATE agent_tasks SET state='running',updated_at=? WHERE id=? AND state='waiting_approval'").bind(stamp, taskId),
  ]);
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "sensitive_step_verified", details: { ordinal, tool: step.tool_name, approvalRequestId, operation: payload.operation, verification } });
  return { id: step.id, state: "completed", verified: true, approvalRequestId };
}

async function retryTask(env, actor, taskId) {
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.state !== "failed" || run.state !== "failed") throw new Error("Sólo se puede reintentar una tarea fallida.");
  const profile = await getProfile(env, task.profile_id);
  if (!profile || profile.status !== "active") throw new Error("El perfil de agente no está disponible.");
  if (run.attempt >= 100) throw new Error("La tarea alcanzó el límite de reintentos.");
  const plan = JSON.parse(task.plan_json), runId = crypto.randomUUID(), stamp = now();
  const statements = [
    env.DB.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId, taskId, run.attempt + 1, "queued", profile.maxStepsPerRun, stamp, stamp),
    env.DB.prepare("UPDATE agent_tasks SET state='queued',completed_at=NULL,updated_at=? WHERE id=? AND state='failed'").bind(stamp, taskId),
  ];
  for (const [index, step] of plan.entries()) statements.push(env.DB.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,created_at,updated_at) VALUES(?,?,?,?,?,'planned',?,?,?,?,?)").bind(crypto.randomUUID(), runId, index + 1, step.tool, step.risk, JSON.stringify(step.preconditions || {}), JSON.stringify(step.input || {}), JSON.stringify(step.expected || {}), stamp, stamp));
  await env.DB.batch(statements);
  await trace(env, { traceId: task.trace_id, taskId, runId, actorId: actor.id, event: "task_retried", details: { fromAttempt: run.attempt, toAttempt: run.attempt + 1 } });
  return { id: taskId, runId, attempt: run.attempt + 1, state: "queued" };
}

export { activeAgentStep, createProfile, createTask, failStep, finishSensitiveStep, finishStep, getProfile, listProfiles, profileInput, retryTask, startStep, taskDetail, trace, transitionTask };
