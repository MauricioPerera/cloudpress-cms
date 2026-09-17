import { currentAgentCapabilityUser, json } from "../../_shared.js";
import { failStep, finishStep, startStep } from "../../_agent-os.js";

async function ownedTask(env, agent, taskId) {
  const task = await env.DB.prepare("SELECT id FROM agent_tasks WHERE id=? AND actor_id=? AND profile_id=?").bind(taskId, agent.id, agent.agent_profile_id).first();
  if (!task) throw new Error("La tarea no pertenece al perfil de esta credencial.");
}

export async function onRequestPost({ request, env }) {
  const agent = await currentAgentCapabilityUser(request, env);
  if (!agent) return json({ error: "Se requiere una credencial de agente activa." }, 403);
  const body = await request.json().catch(() => null);
  try {
    const taskId = String(body?.taskId || "");
    await ownedTask(env, agent, taskId);
    if (body?.action === "start_step") return json({ step: await startStep(env, agent, taskId, Number(body.ordinal)) });
    if (body?.action === "finish_step") return json({ step: await finishStep(env, agent, taskId, Number(body.ordinal), body.outcome) });
    if (body?.action === "fail_step") return json({ step: await failStep(env, agent, taskId, Number(body.ordinal), body.error) });
    return json({ error: "Acción de ejecución de agente inválida." }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo registrar el paso." }, 422); }
}
