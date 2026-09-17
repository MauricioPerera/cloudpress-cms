import { currentAgentCapabilityUser, json } from "../../_shared.js";
import { failStep, finishStep, startStep } from "../../_agent-os.js";

async function ownedTask(env, agent, taskId) {
  const task = await env.DB.prepare("SELECT id FROM agent_tasks WHERE id=? AND actor_id=? AND profile_id=?").bind(taskId, agent.id, agent.agent_profile_id).first();
  if (!task) throw new Error("La tarea no pertenece al perfil de esta credencial.");
}

async function verifiedOutcome(env, agent, taskId, ordinal, outcome) {
  if (!outcome?.verification || outcome.verification.verified !== true) throw new Error("El paso requiere una postcondición declarada.");
  const step = await env.DB.prepare("SELECT agent_steps.tool_name FROM agent_steps JOIN agent_runs ON agent_runs.id=agent_steps.run_id WHERE agent_runs.task_id=? AND agent_steps.ordinal=? ORDER BY agent_runs.attempt DESC LIMIT 1").bind(taskId, ordinal).first();
  if (!step) throw new Error("Paso no encontrado.");
  const id = Number(outcome?.result?.id);
  let evidence = null;
  if (["cloudpress_create_draft", "cloudpress_trash_content", "cloudpress_restore_content", "cloudpress_update_content"].includes(step.tool_name)) {
    if (!Number.isInteger(id) || id < 1) throw new Error("El resultado no identifica el contenido comprobable.");
    const item = await env.DB.prepare("SELECT id,status,author_id,updated_at FROM content_items WHERE id=?").bind(id).first();
    if (!item) throw new Error("CloudPress no puede comprobar el contenido indicado.");
    if (step.tool_name === "cloudpress_create_draft" && (item.status !== "draft" || item.author_id !== agent.id)) throw new Error("El borrador no coincide con la postcondición del agente.");
    if (step.tool_name === "cloudpress_trash_content" && item.status !== "trash") throw new Error("El contenido no está en Papelera.");
    if (step.tool_name === "cloudpress_restore_content" && item.status === "trash") throw new Error("El contenido continúa en Papelera.");
    evidence = { type: "d1_content_state", id: item.id, status: item.status, updatedAt: item.updated_at };
  } else if (step.tool_name === "cloudpress_set_user_active") {
    if (!Number.isInteger(id) || id < 1 || typeof outcome?.result?.active !== "boolean") throw new Error("El resultado no identifica el usuario comprobable.");
    const user = await env.DB.prepare("SELECT id,active FROM users WHERE id=?").bind(id).first();
    if (!user || Boolean(user.active) !== outcome.result.active) throw new Error("El estado del usuario no coincide con la postcondición.");
    evidence = { type: "d1_user_state", id: user.id, active: Boolean(user.active) };
  }
  return { ...outcome, verification: { ...outcome.verification, verified: true, source: evidence ? "server-state" : "agent-attested", ...(evidence ? { evidence } : {}) } };
}

export async function onRequestPost({ request, env }) {
  const agent = await currentAgentCapabilityUser(request, env);
  if (!agent) return json({ error: "Se requiere una credencial de agente activa." }, 403);
  const body = await request.json().catch(() => null);
  try {
    const taskId = String(body?.taskId || "");
    await ownedTask(env, agent, taskId);
    if (body?.action === "start_step") return json({ step: await startStep(env, agent, taskId, Number(body.ordinal)) });
    if (body?.action === "finish_step") return json({ step: await finishStep(env, agent, taskId, Number(body.ordinal), await verifiedOutcome(env, agent, taskId, Number(body.ordinal), body.outcome)) });
    if (body?.action === "fail_step") return json({ step: await failStep(env, agent, taskId, Number(body.ordinal), body.error) });
    return json({ error: "Acción de ejecución de agente inválida." }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo registrar el paso." }, 422); }
}
