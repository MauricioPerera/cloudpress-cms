import { currentAgentCapabilityUser, json } from "../../_shared.js";
import { checkpointAgentRuntimeJob, claimAgentRuntimeJob, delegateAgentTask, heartbeatAgentRuntimeJob, invokeAgentModel, listAgentMessages, recallEpisodicMemories, recordAgentModelUsage, routeAgentModel, sendAgentMessage, writeEpisodicMemory } from "../../_agent-runtime.js";

export async function onRequestPost({ request, env }) {
  const agent = await currentAgentCapabilityUser(request, env);
  if (!agent) return json({ error: "Se requiere una credencial de agente activa." }, 403);
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "claim") return json({ assignment: await claimAgentRuntimeJob(env, agent) });
    if (body?.action === "heartbeat") return json({ lease: await heartbeatAgentRuntimeJob(env, agent, String(body.jobId || ""), String(body.leaseId || "")) });
    if (body?.action === "checkpoint") return json({ checkpoint: await checkpointAgentRuntimeJob(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body.checkpoint) });
    if (body?.action === "record_model_usage") return json({ usage: await recordAgentModelUsage(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body.usage) });
    if (body?.action === "route_model") return json({ model: await routeAgentModel(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body) });
    if (body?.action === "invoke_model") return json({ inference: await invokeAgentModel(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body) });
    if (body?.action === "write_memory") return json({ memory: await writeEpisodicMemory(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body.memory) });
    if (body?.action === "recall_memories") return json({ memories: await recallEpisodicMemories(env, agent, { limit: body.limit }) });
    if (body?.action === "send_message") return json({ message: await sendAgentMessage(env, agent, String(body.jobId || ""), String(body.leaseId || ""), body) });
    if (body?.action === "receive_messages") return json({ messages: await listAgentMessages(env, agent, { limit: body.limit, acknowledge: true }) });
    if (body?.action === "delegate_task") return json({ task: await delegateAgentTask(env, agent, String(body.parentTaskId || ""), body) }, 201);
    return json({ error: "Acción de runtime de agente inválida." }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo operar el runtime." }, 422); }
}
