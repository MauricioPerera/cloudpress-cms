import { currentAgentCapabilityUser, json } from "../../_shared.js";
import { checkpointAgentRuntimeJob, claimAgentRuntimeJob, heartbeatAgentRuntimeJob, recordAgentModelUsage } from "../../_agent-runtime.js";

export async function onRequestPost({ request, env }) {
  const agent = await currentAgentCapabilityUser(request, env);
  if (!agent) return json({ error: "Se requiere una credencial de agente activa." }, 403);
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "claim") return json({ assignment: await claimAgentRuntimeJob(env, agent) });
    if (body?.action === "heartbeat") return json({ lease: await heartbeatAgentRuntimeJob(env, agent, String(body.jobId || ""), String(body.leaseId || "")) });
    if (body?.action === "checkpoint") return json({ checkpoint: await checkpointAgentRuntimeJob(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body.checkpoint) });
    if (body?.action === "record_model_usage") return json({ usage: await recordAgentModelUsage(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body.usage) });
    return json({ error: "Acción de runtime de agente inválida." }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo operar el runtime." }, 422); }
}
