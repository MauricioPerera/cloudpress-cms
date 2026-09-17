import { json, requireRoleManager } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const [plugins, capabilities, assignments, roles] = await Promise.all([
    env.DB.prepare("SELECT plugin_id FROM plugin_installations WHERE status='enabled' ORDER BY plugin_id").all(),
    env.DB.prepare("SELECT plugin_id,capability_id,label FROM plugin_capabilities ORDER BY plugin_id,capability_id").all(),
    env.DB.prepare("SELECT plugin_id,capability_id,role FROM plugin_role_capabilities ORDER BY plugin_id,capability_id,role").all(),
    env.DB.prepare("SELECT id,label,scope FROM roles ORDER BY scope DESC,label COLLATE NOCASE").all(),
  ]);
  return json({ roles: roles.results, plugins: plugins.results.map(({ plugin_id }) => ({ id: plugin_id, capabilities: capabilities.results.filter((item) => item.plugin_id === plugin_id).map((item) => ({ id: item.capability_id, label: item.label, roles: assignments.results.filter((grant) => grant.plugin_id === plugin_id && grant.capability_id === item.capability_id).map((grant) => grant.role) })) })) }, 200, { "Cache-Control": "no-store" });
}
