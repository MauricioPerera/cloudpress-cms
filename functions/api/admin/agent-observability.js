import { json, requireAdmin } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  const admin = await requireAdmin(request, env, "scheduler:manage");
  if (!admin) return json({ error: "Se requiere permiso de operación de agentes" }, 403);
  const [runtime, usage, recent] = await Promise.all([
    env.DB.prepare("SELECT state,COUNT(*) AS total FROM agent_runtime_jobs GROUP BY state ORDER BY state").all(),
    env.DB.prepare("SELECT provider_id,model_id,evidence_level,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(cost_microunits) AS cost_microunits,COUNT(*) AS invocations FROM agent_model_usage GROUP BY provider_id,model_id,evidence_level ORDER BY cost_microunits DESC,invocations DESC LIMIT 100").all(),
    env.DB.prepare("SELECT u.task_id,u.run_id,u.provider_id,u.model_id,u.input_tokens,u.output_tokens,u.cost_microunits,u.evidence_level,u.created_at FROM agent_model_usage u ORDER BY u.created_at DESC LIMIT 100").all(),
  ]);
  return json({ runtime: runtime.results, modelUsage: usage.results, recentUsage: recent.results }, 200, { "Cache-Control": "no-store" });
}
