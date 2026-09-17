import { toolContracts } from "./_agent-tool-contracts.js";

const PROFILE_ID = /^[a-z][a-z0-9-]{2,47}$/;
const TOOL_NAME = /^cloudpress_[a-z0-9_]{2,80}$/;
const RISK = new Set(["read", "reversible", "sensitive"]);
const CLASSIFICATIONS = ["public", "internal", "restricted"];
const TASK_STATES = new Set(["queued", "running", "paused", "waiting_input", "waiting_approval", "completed", "failed", "cancelled"]);
const STEP_STATES = new Set(["planned", "running", "waiting_input", "waiting_approval", "completed", "failed", "skipped", "cancelled"]);
const EVIDENCE_LEVELS = ["unverifiable", "agent-attested", "server-verified", "approval-verified"];
const evidenceRank = (level) => EVIDENCE_LEVELS.indexOf(level);
const now = () => new Date().toISOString();
const validObject = (value, max = 12000) => value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= max;
const validPlan = (value) => Array.isArray(value) && value.length <= 200 && value.every((item) => validObject(item, 4000));
const parse = (row) => ({ ...row, ...(row.plan_json ? { plan: JSON.parse(row.plan_json) } : {}), ...(row.context_json ? { context: JSON.parse(row.context_json) } : {}), ...(row.expected_json ? { expected: JSON.parse(row.expected_json) } : {}), ...(row.data_policy_json ? { dataPolicy: JSON.parse(row.data_policy_json) } : {}) });
const sensitiveTraceKey = /(?:pass(?:word)?|secret|token|authorization|cookie|pin|otp|recovery|credential|bearer|private.?key)/i;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function governancePolicy(dataPolicy, profile) {
  const value = dataPolicy?.governance ?? {};
  const version = String(value.version ?? "cloudpress-agent-policy/v1");
  const maxEstimatedCost = Number(value.maxEstimatedCost ?? value?.budget?.maxEstimatedCost ?? profile.maxStepsPerRun);
  const verificationReserve = Number(value.verificationReserve ?? value?.budget?.verificationReserve ?? 0);
  const maxModelCostMicrounits = Number(value.maxModelCostMicrounits ?? value?.budget?.maxModelCostMicrounits ?? 0);
  const minimumEvidence = String(value.minimumEvidence ?? "agent-attested");
  const requireCompletedDependencies = value.requireCompletedDependencies ?? true;
  if (!/^[a-z0-9][a-z0-9._/-]{2,79}$/i.test(version) || !Number.isInteger(maxEstimatedCost) || maxEstimatedCost < 1 || maxEstimatedCost > 10000 || !Number.isInteger(verificationReserve) || verificationReserve < 0 || verificationReserve > maxEstimatedCost || !Number.isInteger(maxModelCostMicrounits) || maxModelCostMicrounits < 0 || maxModelCostMicrounits > 1000000000 || evidenceRank(minimumEvidence) < 0 || typeof requireCompletedDependencies !== "boolean") return null;
  return { version, budget: { unit: "execution-steps", maxEstimatedCost, verificationReserve, maxModelCostMicrounits }, minimumEvidence, requireCompletedDependencies };
}

function admissionInput(value, plan) {
  const raw = value ?? {};
  const estimatedCost = Number(raw.estimatedCost ?? plan.length);
  const dependencies = Array.isArray(raw.dependencies) ? raw.dependencies.map(String) : [];
  const phase = String(raw.phase ?? "implementation");
  if (!validObject(raw, 4000) || !Number.isInteger(estimatedCost) || estimatedCost < 0 || estimatedCost > 10000 || !["implementation", "verification"].includes(phase) || dependencies.length > 50 || new Set(dependencies).size !== dependencies.length || dependencies.some((id) => !/^[A-Za-z0-9-]{36}$/.test(id))) return null;
  return { estimatedCost, dependencies, phase };
}

// `dependsOn` uses one-based plan ordinals.  Requiring a dependency to point
// backwards makes the submitted order a topological order: it is easy to
// audit, rejects cycles before persistence, and still permits parallel roots
// and branches.  Older plans remain sequential unless they opt in explicitly.
function normalizePlan(value) {
  if (!validPlan(value)) return null;
  return value.map((step, index) => {
    const ordinal = index + 1;
    const preconditions = step.preconditions && typeof step.preconditions === "object" && !Array.isArray(step.preconditions) ? { ...step.preconditions } : {};
    const rawDependencies = step.dependsOn ?? preconditions.dependsOn ?? (index ? [index] : []);
    if (!Array.isArray(rawDependencies) || rawDependencies.length > 100) return null;
    const dependsOn = rawDependencies.map(Number);
    if (dependsOn.some((dependency) => !Number.isInteger(dependency) || dependency < 1 || dependency >= ordinal) || new Set(dependsOn).size !== dependsOn.length) return null;
    return { ...step, preconditions: { ...preconditions, dependsOn } };
  });
}

function contractSnapshot(plan) {
  return plan.map((step) => ({ tool: step.tool, risk: step.risk, contracts: toolContracts.filter((contract) => contract.name === step.tool && contract.risk === step.risk).map((contract) => ({ method: contract.method, paths: contract.paths.map((path) => path.source), bodyBound: Boolean(contract.body) })) }));
}

function safeTraceValue(value, key = "", depth = 0) {
  if (sensitiveTraceKey.test(key)) return "[redacted]";
  if (typeof value === "string") return /\bBearer\s+|-----BEGIN|\b(?:otp|pin)\s*[:=]/i.test(value) ? "[redacted]" : value.slice(0, 1000);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeTraceValue(item, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([name, item]) => [name, safeTraceValue(item, name, depth + 1)]));
  return String(value).slice(0, 1000);
}

function profileInput(body) {
  const id = String(body?.id || "").trim().toLowerCase(), label = String(body?.label || "").trim(), purpose = String(body?.purpose || "").trim();
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const maxActiveRuns = Number(body?.maxActiveRuns ?? 1), maxStepsPerRun = Number(body?.maxStepsPerRun ?? 25), dataPolicy = body?.dataPolicy ?? {};
  const maximumClassification = String(dataPolicy?.maximumClassification || "");
  const modelResidency = String(dataPolicy?.modelResidency ?? "any").trim();
  const policy = governancePolicy(dataPolicy, { maxStepsPerRun });
  if (!PROFILE_ID.test(id) || !label || label.length > 80 || !purpose || purpose.length > 500 || !Number.isInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 20 || !Number.isInteger(maxStepsPerRun) || maxStepsPerRun < 1 || maxStepsPerRun > 200 || !validObject(dataPolicy, 4000) || !CLASSIFICATIONS.includes(maximumClassification) || !/^(any|[a-z0-9][a-z0-9._-]{1,79})$/i.test(modelResidency) || typeof dataPolicy.allowSensitive !== "boolean" || !policy || tools.length > 100 || tools.some((tool) => !tool || !TOOL_NAME.test(String(tool.name || "")) || !RISK.has(tool.risk)) || (tools.some((tool) => tool.risk === "sensitive") && !dataPolicy.allowSensitive)) return null;
  const unique = new Map(tools.map((tool) => [tool.name, tool.risk])); if (unique.size !== tools.length) return null;
  return { id, label, purpose, maxActiveRuns, maxStepsPerRun, dataPolicy: { maximumClassification, allowSensitive: dataPolicy.allowSensitive, modelResidency, governance: policy }, tools };
}

async function trace(env, { traceId, taskId = null, runId = null, stepId = null, actorId = null, event, details = {} }) {
  const serialized = JSON.stringify(safeTraceValue(details));
  const bounded = serialized.length <= 12000 ? serialized : JSON.stringify({ truncated: true, reason: "trace_details_too_large" });
  await env.DB.prepare("INSERT INTO agent_trace_events(trace_id,task_id,run_id,step_id,actor_id,event,details_json) VALUES(?,?,?,?,?,?,?)").bind(traceId, taskId, runId, stepId, actorId, event, bounded).run();
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

async function setProfileStatus(env, actorId, profileId, status) {
  if (!PROFILE_ID.test(String(profileId || "")) || !new Set(["active", "paused", "revoked"]).has(status)) throw new Error("Estado de perfil inválido.");
  const profile = await getProfile(env, profileId);
  if (!profile || profile.ownerId !== actorId) throw new Error("El perfil de agente no está disponible para este usuario.");
  if (profile.status === "revoked" && status !== "revoked") throw new Error("Un perfil revocado no puede reactivarse.");
  if (profile.status !== status) {
    const stamp = now();
    await env.DB.prepare("UPDATE agent_profiles SET status=?,updated_at=? WHERE id=? AND owner_id=?").bind(status, stamp, profileId, actorId).run();
    if (status === "revoked") await env.DB.prepare("UPDATE agent_capabilities SET revoked_at=? WHERE profile_id=? AND revoked_at IS NULL").bind(stamp, profileId).run();
    await trace(env, { traceId: crypto.randomUUID(), actorId, event: "profile_status_changed", details: { profileId, from: profile.status, to: status } });
  }
  return getProfile(env, profileId);
}

async function createTask(env, actor, body) {
  const profileId = String(body?.profileId || ""), objective = String(body?.objective || "").trim();
  const requestedPlan = body?.plan ?? [], context = body?.context ?? {}, expected = body?.expected ?? {};
  const plan = normalizePlan(requestedPlan);
  if (!PROFILE_ID.test(profileId) || !objective || objective.length > 2000 || !plan || !validObject(context) || !validObject(expected)) throw new Error("Tarea de agente inválida.");
  const profile = await getProfile(env, profileId); if (!profile || profile.ownerId !== actor.id || profile.status !== "active") throw new Error("El perfil de agente no está disponible para este usuario.");
  const policy = governancePolicy(profile.dataPolicy, profile); if (!policy) throw new Error("La política de gobierno del perfil no es válida.");
  const admission = admissionInput(context?.admission, plan); if (!admission) throw new Error("La admisión de la tarea no es válida.");
  const classification = String(context?.classification || "");
  if (!CLASSIFICATIONS.includes(classification) || CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(profile.dataPolicy.maximumClassification)) throw new Error("La clasificación de datos de la tarea excede la política del perfil.");
  const active = await env.DB.prepare("SELECT COUNT(*) AS total FROM agent_tasks WHERE profile_id=? AND state IN ('queued','running','waiting_input','waiting_approval')").bind(profileId).first();
  if (Number(active?.total || 0) >= profile.max_active_runs) throw new Error("El perfil alcanzó su límite de tareas activas.");
  if (plan.length > profile.max_steps_per_run) throw new Error("El plan excede el límite de pasos del perfil.");
  if (admission.estimatedCost + policy.budget.verificationReserve > policy.budget.maxEstimatedCost) throw new Error("El presupuesto estimado no reserva capacidad suficiente para verificar la tarea.");
  if (admission.dependencies.includes(String(body?.taskId || ""))) throw new Error("Una tarea no puede depender de sí misma.");
  if (policy.requireCompletedDependencies && admission.dependencies.length) {
    const placeholders = admission.dependencies.map(() => "?").join(",");
    const dependencies = await env.DB.prepare(`SELECT id,state,actor_id FROM agent_tasks WHERE id IN (${placeholders})`).bind(...admission.dependencies).all();
    if (dependencies.results.length !== admission.dependencies.length || dependencies.results.some((dependency) => dependency.actor_id !== actor.id || dependency.state !== "completed")) throw new Error("Las dependencias declaradas deben estar completadas por el mismo propietario.");
  }
  for (const step of plan) {
    const toolName = String(step.tool || ""), risk = String(step.risk || "read");
    if (!TOOL_NAME.test(toolName) || !RISK.has(risk) || !profile.tools.some((tool) => tool.name === toolName && tool.risk === risk) || !toolContracts.some((contract) => contract.name === toolName && contract.risk === risk)) throw new Error("El plan solicita una herramienta no permitida por el perfil.");
    if (risk === "sensitive" && !/^[a-z_]{3,80}$/.test(String(step?.preconditions?.approvalOperation || ""))) throw new Error("Un paso sensible debe declarar la operación irreversible aprobada.");
  }
  const taskId = crypto.randomUUID(), runId = crypto.randomUUID(), traceId = crypto.randomUUID(), stamp = now();
  const profileSnapshot = { id: profile.id, ownerId: profile.ownerId, label: profile.label, purpose: profile.purpose, maxActiveRuns: profile.maxActiveRuns, maxStepsPerRun: profile.maxStepsPerRun, dataPolicy: profile.dataPolicy, tools: profile.tools };
  const contracts = contractSnapshot(plan);
  const hashes = await Promise.all([sha256(profileSnapshot), sha256(plan), sha256(policy), sha256(contracts)]);
  const statements = [
    env.DB.prepare("INSERT INTO agent_tasks(id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,admission_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(taskId, traceId, profileId, actor.id, objective, JSON.stringify(plan), JSON.stringify(context), JSON.stringify(expected), JSON.stringify(admission), "queued", stamp, stamp),
    env.DB.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId, taskId, 1, "queued", profile.maxStepsPerRun, stamp, stamp),
    env.DB.prepare("INSERT INTO agent_execution_snapshots(id,task_id,run_id,policy_version,minimum_evidence,profile_snapshot_json,plan_snapshot_json,policy_snapshot_json,tool_contract_snapshot_json,profile_sha256,plan_sha256,policy_sha256,tool_contract_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), taskId, runId, policy.version, policy.minimumEvidence, canonicalJson(profileSnapshot), canonicalJson(plan), canonicalJson(policy), canonicalJson(contracts), ...hashes, stamp),
  ];
  for (const [index, step] of plan.entries()) {
    const toolName = String(step.tool || ""), risk = String(step.risk || "read");
    statements.push(env.DB.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,created_at,updated_at) VALUES(?,?,?,?,?,'planned',?,?,?,?,?)").bind(crypto.randomUUID(), runId, index + 1, toolName, risk, JSON.stringify(step.preconditions || {}), JSON.stringify(step.input || {}), JSON.stringify(step.expected || {}), stamp, stamp));
  }
  statements.push(env.DB.prepare("INSERT INTO agent_runtime_jobs(id,task_id,run_id,profile_id,provider_id,state,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)").bind(crypto.randomUUID(), taskId, runId, profileId, "external-webmcp", stamp, stamp));
  await env.DB.batch(statements);
  await trace(env, { traceId, taskId, runId, actorId: actor.id, event: "task_created", details: { profileId, plannedSteps: plan.length, objective, admission, policyVersion: policy.version, snapshotHashes: { profile: hashes[0], plan: hashes[1], policy: hashes[2], toolContract: hashes[3] } } });
  return { id: taskId, runId, traceId, state: "queued", profileId, objective };
}

async function taskDetail(env, id) {
  const task = await env.DB.prepare("SELECT id,trace_id,profile_id,actor_id,objective,plan_json,context_json,expected_json,admission_json,state,created_at,started_at,completed_at,updated_at FROM agent_tasks WHERE id=?").bind(id).first();
  if (!task) return null;
  const runs = await env.DB.prepare("SELECT id,attempt,state,step_limit,steps_used,started_at,completed_at,created_at,updated_at FROM agent_runs WHERE task_id=? ORDER BY attempt DESC").bind(id).all();
  const hydratedRuns = await Promise.all(runs.results.map(async (run) => ({ ...run, steps: (await env.DB.prepare("SELECT id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,result_json,verification_json,error_text,approval_request_id,started_at,completed_at,created_at,updated_at FROM agent_steps WHERE run_id=? ORDER BY ordinal").bind(run.id).all()).results.map((step) => ({ ...step, preconditions: JSON.parse(step.preconditions_json), input: JSON.parse(step.input_json), expected: JSON.parse(step.expected_json), result: step.result_json ? JSON.parse(step.result_json) : null, verification: step.verification_json ? JSON.parse(step.verification_json) : null })) })));
  const events = await env.DB.prepare("SELECT id,run_id,step_id,actor_id,event,details_json,created_at FROM agent_trace_events WHERE task_id=? ORDER BY id DESC LIMIT 200").bind(id).all();
  const snapshots = await env.DB.prepare("SELECT run_id,policy_version,minimum_evidence,profile_sha256,plan_sha256,policy_sha256,tool_contract_sha256,created_at FROM agent_execution_snapshots WHERE task_id=? ORDER BY created_at DESC").bind(id).all();
  const inputs = await env.DB.prepare("SELECT id,run_id,step_id,field_name,prompt,classification,state,requested_at,provided_at,provided_by FROM agent_task_inputs WHERE task_id=? ORDER BY requested_at DESC").bind(id).all();
  const delegations = await env.DB.prepare("SELECT id,parent_task_id,child_task_id,parent_profile_id,child_profile_id,state,created_at,completed_at FROM agent_task_delegations WHERE parent_task_id=? OR child_task_id=? ORDER BY created_at DESC").bind(id, id).all();
  return { ...parse(task), admission: task.admission_json ? JSON.parse(task.admission_json) : {}, runs: hydratedRuns, snapshots: snapshots.results, inputs: inputs.results, delegations: delegations.results, trace: events.results.map((event) => ({ ...event, details: JSON.parse(event.details_json) })) };
}

const taskTransitions = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["paused", "waiting_input", "waiting_approval", "completed", "failed", "cancelled"])],
  ["paused", new Set(["running", "cancelled"])],
  ["waiting_input", new Set(["running", "cancelled"])],
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
  // Older console clients used `queued` for Resume. Treat that request as a
  // direct return to execution, preserving a running step and its quota.
  if (nextState === "queued") {
    const current = await env.DB.prepare("SELECT state FROM agent_tasks WHERE id=?").bind(taskId).first();
    if (current?.state === "paused") nextState = "running";
  }
  if (!TASK_STATES.has(nextState)) throw new Error("Estado de tarea inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (!taskTransitions.get(task.state)?.has(nextState)) throw new Error("Transición de tarea no permitida.");
  if (nextState === "completed") {
    const pending = await env.DB.prepare("SELECT 1 FROM agent_steps WHERE run_id=? AND state NOT IN ('completed','skipped') LIMIT 1").bind(run.id).first();
    if (pending) throw new Error("No se puede completar una tarea con pasos no verificados.");
    const delegated = await env.DB.prepare("SELECT 1 FROM agent_task_delegations WHERE parent_task_id=? AND state='active' LIMIT 1").bind(taskId).first();
    if (delegated) throw new Error("No se puede completar una tarea con una delegación activa.");
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
  const step = await env.DB.prepare("SELECT id,tool_name,risk,state,preconditions_json FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step) throw new Error("El paso no está disponible.");
  // Re-attaching a companion after a browser reload must not consume another
  // quota unit or leave an already-running step permanently inaccessible.
  if (step.state === "running" && task.state === "running" && run.state === "running") return { id: step.id, state: "running", tool: step.tool_name, resumed: true };
  if (step.state === "waiting_approval" && step.risk === "sensitive" && task.state === "waiting_approval" && run.state === "waiting_approval") return { id: step.id, state: "waiting_approval", requiresApproval: true, resumed: true };
  if (step.state !== "planned") throw new Error("El paso no está disponible.");
  let dependsOn;
  try { dependsOn = JSON.parse(step.preconditions_json || "{}").dependsOn ?? (ordinal > 1 ? [ordinal - 1] : []); } catch { throw new Error("Las dependencias del paso no son válidas."); }
  if (!Array.isArray(dependsOn) || dependsOn.some((dependency) => !Number.isInteger(dependency) || dependency < 1 || dependency >= ordinal)) throw new Error("Las dependencias del paso no son válidas.");
  if (dependsOn.length) {
    const placeholders = dependsOn.map(() => "?").join(",");
    const unresolved = await env.DB.prepare(`SELECT ordinal FROM agent_steps WHERE run_id=? AND ordinal IN (${placeholders}) AND state NOT IN ('completed','skipped') LIMIT 1`).bind(run.id, ...dependsOn).first();
    if (unresolved) throw new Error("Las dependencias declaradas deben verificarse primero.");
  }
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

// A task is complete only when its server-persisted run has no outstanding
// steps.  This keeps agents from leaving an otherwise successful run in
// `running`, while preserving the supervisor's explicit completion guard.
async function completeRunIfVerified(env, task, run, actorId) {
  const pending = await env.DB.prepare("SELECT 1 FROM agent_steps WHERE run_id=? AND state NOT IN ('completed','skipped') LIMIT 1").bind(run.id).first();
  if (pending) return false;
  const delegated = await env.DB.prepare("SELECT 1 FROM agent_task_delegations WHERE parent_task_id=? AND state='active' LIMIT 1").bind(task.id).first();
  if (delegated) {
    await trace(env, { traceId: task.trace_id, taskId: task.id, runId: run.id, actorId, event: "task_completion_blocked", details: { reason: "active_delegation" } });
    return false;
  }
  const snapshot = await env.DB.prepare("SELECT minimum_evidence FROM agent_execution_snapshots WHERE run_id=?").bind(run.id).first();
  const requiredEvidence = snapshot?.minimum_evidence || "agent-attested";
  const completed = await env.DB.prepare("SELECT ordinal,verification_json FROM agent_steps WHERE run_id=? AND state='completed'").bind(run.id).all();
  const weak = completed.results.find((step) => {
    try { return evidenceRank(JSON.parse(step.verification_json || "{}").evidenceLevel || "unverifiable") < evidenceRank(requiredEvidence); } catch { return true; }
  });
  if (weak) {
    await trace(env, { traceId: task.trace_id, taskId: task.id, runId: run.id, actorId, event: "task_completion_blocked", details: { reason: "insufficient_evidence", requiredEvidence, ordinal: weak.ordinal } });
    return false;
  }
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_runs SET state='completed',completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(stamp, stamp, run.id),
    env.DB.prepare("UPDATE agent_tasks SET state='completed',completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(stamp, stamp, task.id),
  ]);
  await trace(env, { traceId: task.trace_id, taskId: task.id, runId: run.id, actorId, event: "task_completed", details: { reason: "all_steps_verified" } });
  return true;
}

async function finishStep(env, actor, taskId, ordinal, outcome) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || !validObject(outcome?.result ?? {}) || !validObject(outcome?.verification ?? {})) throw new Error("Resultado de paso inválido.");
  const { task, run } = await currentTaskRun(env, taskId);
  const step = await env.DB.prepare("SELECT id,tool_name,state FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step || step.state !== "running") throw new Error("El paso no está en ejecución.");
  if (outcome.verification.verified !== true) throw new Error("El paso requiere una postcondición verificada.");
  const verification = { ...outcome.verification, evidenceLevel: EVIDENCE_LEVELS.includes(outcome.verification.evidenceLevel) ? outcome.verification.evidenceLevel : "agent-attested" };
  const stamp = now();
  await env.DB.prepare("UPDATE agent_steps SET state='completed',result_json=?,verification_json=?,completed_at=?,updated_at=? WHERE id=? AND state='running'").bind(JSON.stringify(outcome.result), JSON.stringify(verification), stamp, stamp, step.id).run();
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "step_verified", details: { ordinal, tool: step.tool_name, verification } });
  return { id: step.id, state: "completed", verified: true, taskCompleted: await completeRunIfVerified(env, task, run, actor.id) };
}

function validHumanInput(value) {
  return (typeof value === "string" && value.length <= 4000) || value === null || typeof value === "number" || typeof value === "boolean" || (value && typeof value === "object" && JSON.stringify(value).length <= 4000);
}

async function requestTaskInput(env, actor, taskId, ordinal, body) {
  const fieldName = String(body?.fieldName || "").trim(), prompt = String(body?.prompt || "").trim(), classification = String(body?.classification || "public");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(fieldName) || !prompt || prompt.length > 500 || !["public", "internal"].includes(classification)) throw new Error("La solicitud de información humana no sensible no es válida.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.state !== "running" || run.state !== "running") throw new Error("La tarea no está en ejecución.");
  const step = await env.DB.prepare("SELECT id,state FROM agent_steps WHERE run_id=? AND ordinal=?").bind(run.id, ordinal).first();
  if (!step || step.state !== "running") throw new Error("El paso no está en ejecución.");
  const profile = await getProfile(env, task.profile_id);
  if (!profile || CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(profile.dataPolicy.maximumClassification)) throw new Error("La clasificación solicitada excede la política del perfil.");
  const stamp = now(), inputId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO agent_task_inputs(id,task_id,run_id,step_id,field_name,prompt,classification,state,requested_at) VALUES(?,?,?,?,?,?,?,'waiting',?)").bind(inputId, taskId, run.id, step.id, fieldName, prompt, classification, stamp),
      env.DB.prepare("UPDATE agent_steps SET state='waiting_input',updated_at=? WHERE id=? AND state='running'").bind(stamp, step.id),
      env.DB.prepare("UPDATE agent_runs SET state='waiting_input',updated_at=? WHERE id=? AND state='running'").bind(stamp, run.id),
      env.DB.prepare("UPDATE agent_tasks SET state='waiting_input',updated_at=? WHERE id=? AND state='running'").bind(stamp, taskId),
    ]);
  } catch { throw new Error("Ya existe una solicitud pendiente con ese identificador de campo."); }
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "task_waiting_input", details: { ordinal, fieldName, prompt, classification } });
  return { id: inputId, state: "waiting_input", fieldName, classification };
}

async function provideTaskInput(env, actor, taskId, inputId, value) {
  if (!/^[A-Za-z0-9-]{36}$/.test(String(inputId || "")) || !validHumanInput(value)) throw new Error("La respuesta humana no sensible no es válida.");
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.actor_id !== actor.id || task.state !== "waiting_input" || run.state !== "waiting_input") throw new Error("La tarea no está esperando información humana.");
  const input = await env.DB.prepare("SELECT id,step_id,field_name,state FROM agent_task_inputs WHERE id=? AND task_id=? AND run_id=?").bind(inputId, taskId, run.id).first();
  if (!input || input.state !== "waiting") throw new Error("La solicitud de información no está disponible.");
  const step = await env.DB.prepare("SELECT input_json FROM agent_steps WHERE id=? AND run_id=? AND state='waiting_input'").bind(input.step_id, run.id).first();
  if (!step) throw new Error("El paso asociado no está esperando información humana.");
  let stepInput = {}; try { stepInput = JSON.parse(step.input_json || "{}"); } catch { throw new Error("La entrada del paso no es válida."); }
  stepInput.humanInput = { ...(stepInput.humanInput || {}), [input.field_name]: value };
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_task_inputs SET state='provided',value_json=?,provided_at=?,provided_by=? WHERE id=? AND state='waiting'").bind(JSON.stringify(value), stamp, actor.id, input.id),
    env.DB.prepare("UPDATE agent_steps SET state='running',input_json=?,updated_at=? WHERE id=? AND state='waiting_input'").bind(JSON.stringify(stepInput), stamp, input.step_id),
    env.DB.prepare("UPDATE agent_runs SET state='running',updated_at=? WHERE id=? AND state='waiting_input'").bind(stamp, run.id),
    env.DB.prepare("UPDATE agent_tasks SET state='running',updated_at=? WHERE id=? AND state='waiting_input'").bind(stamp, taskId),
  ]);
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: input.step_id, actorId: actor.id, event: "task_input_provided", details: { fieldName: input.field_name, inputId: input.id, classification: "non-secret" } });
  return { id: input.id, state: "provided", taskState: "running" };
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
  const verification = { ...outcome.verification, verified: true, source: "server-approved-action", evidenceLevel: "approval-verified", evidence: { type: "approval_execution", approvalRequestId, operation: payload.operation } };
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_steps SET state='completed',approval_request_id=?,result_json=?,verification_json=?,completed_at=?,updated_at=? WHERE id=? AND state='waiting_approval'").bind(approvalRequestId, JSON.stringify(approvedResult), JSON.stringify(verification), stamp, stamp, step.id),
    env.DB.prepare("UPDATE agent_tasks SET state='running',updated_at=? WHERE id=? AND state='waiting_approval'").bind(stamp, taskId),
  ]);
  await trace(env, { traceId: task.trace_id, taskId, runId: run.id, stepId: step.id, actorId: actor.id, event: "sensitive_step_verified", details: { ordinal, tool: step.tool_name, approvalRequestId, operation: payload.operation, verification } });
  return { id: step.id, state: "completed", verified: true, approvalRequestId, taskCompleted: await completeRunIfVerified(env, task, run, actor.id) };
}

async function retryTask(env, actor, taskId) {
  const { task, run } = await currentTaskRun(env, taskId);
  if (task.state !== "failed" || run.state !== "failed") throw new Error("Sólo se puede reintentar una tarea fallida.");
  const profile = await getProfile(env, task.profile_id);
  if (!profile || profile.status !== "active") throw new Error("El perfil de agente no está disponible.");
  if (run.attempt >= 100) throw new Error("La tarea alcanzó el límite de reintentos.");
  const plan = JSON.parse(task.plan_json), runId = crypto.randomUUID(), stamp = now();
  const previousSnapshot = await env.DB.prepare("SELECT policy_version,minimum_evidence,profile_snapshot_json,plan_snapshot_json,policy_snapshot_json,tool_contract_snapshot_json,profile_sha256,plan_sha256,policy_sha256,tool_contract_sha256 FROM agent_execution_snapshots WHERE run_id=?").bind(run.id).first();
  const statements = [
    env.DB.prepare("INSERT INTO agent_runs(id,task_id,attempt,state,step_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId, taskId, run.attempt + 1, "queued", profile.maxStepsPerRun, stamp, stamp),
    env.DB.prepare("UPDATE agent_tasks SET state='queued',completed_at=NULL,updated_at=? WHERE id=? AND state='failed'").bind(stamp, taskId),
    env.DB.prepare("INSERT INTO agent_runtime_jobs(id,task_id,run_id,profile_id,provider_id,state,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)").bind(crypto.randomUUID(), taskId, runId, task.profile_id, "external-webmcp", stamp, stamp),
  ];
  if (previousSnapshot) statements.push(env.DB.prepare("INSERT INTO agent_execution_snapshots(id,task_id,run_id,policy_version,minimum_evidence,profile_snapshot_json,plan_snapshot_json,policy_snapshot_json,tool_contract_snapshot_json,profile_sha256,plan_sha256,policy_sha256,tool_contract_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), taskId, runId, previousSnapshot.policy_version, previousSnapshot.minimum_evidence, previousSnapshot.profile_snapshot_json, previousSnapshot.plan_snapshot_json, previousSnapshot.policy_snapshot_json, previousSnapshot.tool_contract_snapshot_json, previousSnapshot.profile_sha256, previousSnapshot.plan_sha256, previousSnapshot.policy_sha256, previousSnapshot.tool_contract_sha256, stamp));
  for (const [index, step] of plan.entries()) statements.push(env.DB.prepare("INSERT INTO agent_steps(id,run_id,ordinal,tool_name,risk,state,preconditions_json,input_json,expected_json,created_at,updated_at) VALUES(?,?,?,?,?,'planned',?,?,?,?,?)").bind(crypto.randomUUID(), runId, index + 1, step.tool, step.risk, JSON.stringify(step.preconditions || {}), JSON.stringify(step.input || {}), JSON.stringify(step.expected || {}), stamp, stamp));
  await env.DB.batch(statements);
  await trace(env, { traceId: task.trace_id, taskId, runId, actorId: actor.id, event: "task_retried", details: { fromAttempt: run.attempt, toAttempt: run.attempt + 1 } });
  return { id: taskId, runId, attempt: run.attempt + 1, state: "queued" };
}

export { activeAgentStep, createProfile, createTask, failStep, finishSensitiveStep, finishStep, getProfile, listProfiles, normalizePlan, profileInput, provideTaskInput, requestTaskInput, retryTask, setProfileStatus, startStep, taskDetail, trace, transitionTask };
