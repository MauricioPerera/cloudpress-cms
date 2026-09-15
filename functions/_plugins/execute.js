import { currentUser, json } from "../_shared.js";
import { auditSnapshot, createPluginContext, enabledPlugin, pluginAudit, validateInput } from "./host.js";

const roleWeight = { user: 1, author: 2, admin: 3 };
export async function allowed(env, user, pluginId, capability = "admin") { if (!user) return false; if (roleWeight[capability]) return roleWeight[user.role] >= roleWeight[capability]; return Boolean(await env.DB.prepare("SELECT 1 FROM plugin_role_capabilities WHERE plugin_id=? AND capability_id=? AND role=?").bind(pluginId, capability, user.role).first()); }

export async function executeAction({ request, env, pluginId, actionId }) {
  const user = await currentUser(request, env); const plugin = await enabledPlugin(env, pluginId);
  if (!plugin) return json({ error: "Plugin no disponible o desactivado." }, 404);
  const action = plugin.manifest.actions?.find((item) => item.id === actionId);
  if (!action) return json({ error: "Acción no declarada." }, 404);
  if (!await allowed(env, user, pluginId, action.capability)) return json({ error: "No tienes permiso para ejecutar esta acción." }, 403);
  const input = await request.json().catch(() => null); const verdict = validateInput(action.inputSchema, input);
  if (!verdict.valid) return json({ error: verdict.error }, 422);
  const handler = plugin.module?.actions?.[action.handler];
  if (typeof handler !== "function") return json({ error: "El handler declarado no está disponible." }, 501);
  try { const result = await handler(createPluginContext(env, pluginId, user), input); await pluginAudit(env, pluginId, "action_succeeded", user.id, { actionId, input: JSON.parse(auditSnapshot(input)), result: JSON.parse(auditSnapshot(result)) }); return json({ ok: true, actionId, result }); }
  catch (error) { await pluginAudit(env, pluginId, "action_failed", user?.id, { actionId, input: JSON.parse(auditSnapshot(input)), error: String(error?.message || "Error") }); return json({ error: String(error?.message || "La acción falló.") }, 422); }
}
