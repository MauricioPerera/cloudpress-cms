import { currentTaskScopedUser, json } from "../_shared.js";
import { hasCorePermission } from "../_roles.js";
import { auditSnapshot, createPluginContext, enabledPlugin, pluginAudit, validateInput } from "./host.js";

export async function allowed(env, user, pluginId, capability = "admin") {
  if (!user) return false;
  if (capability === "admin") return hasCorePermission(env, user, "admin:access");
  if (capability === "author") return hasCorePermission(env, user, "content:own");
  if (capability === "user") return true;
  return Boolean(await env.DB.prepare("SELECT 1 FROM plugin_role_capabilities WHERE plugin_id=? AND capability_id=? AND role=?").bind(pluginId, capability, user.role).first());
}

export async function executeAction({ request, env, pluginId, actionId }) {
  const user = await currentTaskScopedUser(request, env); const plugin = await enabledPlugin(env, pluginId);
  if (!plugin) return json({ error: "Plugin no disponible o desactivado." }, 404);
  const action = plugin.manifest.actions?.find((item) => item.id === actionId);
  if (!action) return json({ error: "Acción no declarada." }, 404);
  if (user?.auth_method === "agent_capability" && (!action.agent || user.agent_tool_name !== "cloudpress_plugin_action" || user.agent_tool_risk !== action.agent.risk)) return json({ error: "Esta acción de plugin no está autorizada para agentes." }, 403);
  if (!await allowed(env, user, pluginId, action.capability)) return json({ error: "No tienes permiso para ejecutar esta acción." }, 403);
  const input = await request.json().catch(() => null); const verdict = validateInput(action.inputSchema, input);
  if (!verdict.valid) return json({ error: verdict.error }, 422);
  const handler = plugin.module?.actions?.[action.handler];
  if (typeof handler !== "function") return json({ error: "El handler declarado no está disponible." }, 501);
  try { const result = await handler(createPluginContext(env, pluginId, user), input); await pluginAudit(env, pluginId, "action_succeeded", user.id, { actionId, input: JSON.parse(auditSnapshot(input)), result: JSON.parse(auditSnapshot(result)) }); return json({ ok: true, actionId, result }); }
  catch (error) { await pluginAudit(env, pluginId, "action_failed", user?.id, { actionId, input: JSON.parse(auditSnapshot(input)), error: String(error?.message || "Error") }); return json({ error: "La operación del plugin no se pudo completar." }, 422); }
}
