import { json, requireAdmin } from "../../../../_shared.js";
import { enabledPlugin, pluginAudit } from "../../../../_plugins/host.js";

const roles = ["admin", "author", "user"];

export async function onRequestGet({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const pluginId = String(params.pluginId || ""); if (!await enabledPlugin(env, pluginId)) return json({ error: "Plugin no disponible." }, 404);
  const [definitions, assignments] = await env.DB.batch([env.DB.prepare("SELECT capability_id,label FROM plugin_capabilities WHERE plugin_id=? ORDER BY capability_id").bind(pluginId), env.DB.prepare("SELECT capability_id,role FROM plugin_role_capabilities WHERE plugin_id=? ORDER BY capability_id,role").bind(pluginId)]);
  return json({ capabilities: definitions.results.map((item) => ({ ...item, roles: assignments.results.filter((assignment) => assignment.capability_id === item.capability_id).map((assignment) => assignment.role) })) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPut({ request, env, params }) {
  const admin = await requireAdmin(request, env); if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const pluginId = String(params.pluginId || ""), body = await request.json().catch(() => null), capabilityId = String(body?.capabilityId || ""), selected = body?.roles;
  if (!await enabledPlugin(env, pluginId)) return json({ error: "Plugin no disponible." }, 404);
  if (!Array.isArray(selected) || selected.some((role) => !roles.includes(role))) return json({ error: "Roles inválidos." }, 422);
  const definition = await env.DB.prepare("SELECT 1 FROM plugin_capabilities WHERE plugin_id=? AND capability_id=?").bind(pluginId, capabilityId).first(); if (!definition) return json({ error: "Capacidad no declarada." }, 404);
  await env.DB.batch([env.DB.prepare("DELETE FROM plugin_role_capabilities WHERE plugin_id=? AND capability_id=?").bind(pluginId, capabilityId), ...[...new Set(selected)].map((role) => env.DB.prepare("INSERT INTO plugin_role_capabilities(plugin_id,capability_id,role) VALUES(?,?,?)").bind(pluginId, capabilityId, role))]);
  await pluginAudit(env, pluginId, "capability_roles_updated", admin.id, { capabilityId, roles: [...new Set(selected)] });
  return json({ ok: true, capabilityId, roles: [...new Set(selected)] });
}
