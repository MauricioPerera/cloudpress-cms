import { json, requireAdmin } from "../../_shared.js";
import { createProfile, createTask, failStep, finishSensitiveStep, finishStep, listProfiles, provideTaskInput, requestTaskInput, retryTask, setProfileStatus, startStep, taskDetail, transitionTask } from "../../_agent-os.js";
import { syncAgentRuntimeTask } from "../../_agent-runtime.js";

const canManage = (request, env) => requireAdmin(request, env, "scheduler:manage");

export async function onRequestGet({ request, env }) {
  if (!await canManage(request, env)) return json({ error: "Se requiere permiso de operación de agentes" }, 403);
  const url = new URL(request.url), taskId = url.searchParams.get("taskId");
  if (taskId) { const task = await taskDetail(env, taskId); return task ? json({ task }, 200, { "Cache-Control": "no-store" }) : json({ error: "Tarea no encontrada" }, 404); }
  const tasks = await env.DB.prepare("SELECT id,trace_id,profile_id,actor_id,objective,state,created_at,started_at,completed_at,updated_at FROM agent_tasks ORDER BY updated_at DESC LIMIT 200").all();
  return json({ profiles: await listProfiles(env), tasks: tasks.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await canManage(request, env); if (!admin) return json({ error: "Se requiere permiso de operación de agentes" }, 403);
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "create_profile") return json({ profile: await createProfile(env, admin.id, body) }, 201);
    if (body?.action === "set_profile_status") return json({ profile: await setProfileStatus(env, admin.id, String(body.profileId || ""), String(body.status || "")) });
    if (body?.action === "create_task") return json({ task: await createTask(env, admin, body) }, 201);
    const taskId = String(body?.taskId || "");
    if (body?.action === "transition_task") { const task = await transitionTask(env, admin, taskId, String(body.state || ""), body.reason); await syncAgentRuntimeTask(env, taskId); return json({ task }); }
    if (body?.action === "start_step") { const step = await startStep(env, admin, taskId, Number(body.ordinal)); await syncAgentRuntimeTask(env, taskId); return json({ step }); }
    if (body?.action === "finish_step") { const step = await finishStep(env, admin, taskId, Number(body.ordinal), body.outcome); await syncAgentRuntimeTask(env, taskId); return json({ step }); }
    if (body?.action === "fail_step") { const step = await failStep(env, admin, taskId, Number(body.ordinal), body.error); await syncAgentRuntimeTask(env, taskId); return json({ step }); }
    if (body?.action === "finish_sensitive_step") { const step = await finishSensitiveStep(env, admin, taskId, Number(body.ordinal), body.approvalRequestId, body.outcome); await syncAgentRuntimeTask(env, taskId); return json({ step }); }
    if (body?.action === "request_task_input") { const input = await requestTaskInput(env, admin, taskId, Number(body.ordinal), body); await syncAgentRuntimeTask(env, taskId); return json({ input }); }
    if (body?.action === "provide_task_input") { const input = await provideTaskInput(env, admin, taskId, String(body.inputId || ""), body.value); await syncAgentRuntimeTask(env, taskId); return json({ input }); }
    if (body?.action === "retry_task") { const task = await retryTask(env, admin, taskId); await syncAgentRuntimeTask(env, taskId); return json({ task }); }
    return json({ error: "Acción de control de agentes inválida" }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo registrar la operación" }, 422); }
}
