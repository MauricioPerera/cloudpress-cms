import { json, requireRoleManager } from "../../../../_shared.js";
import { enabledPlugin, pluginAudit } from "../../../../_plugins/host.js";

async function availableRoles(env) { return (await env.DB.prepare("SELECT id,label,scope FROM roles ORDER BY scope DESC,label COLLATE NOCASE").all()).results; }

export async function onRequestGet({ request, env, params }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const pluginId = String(params.pluginId || ""); if (!await enabledPlugin(env, pluginId)) return json({ error: "Plugin no disponible." }, 404);
  const [definitions, assignments, roles] = await Promise.all([env.DB.prepare("SELECT capability_id,label FROM plugin_capabilities WHERE plugin_id=? ORDER BY capability_id").bind(pluginId).all(), env.DB.prepare("SELECT capability_id,role FROM plugin_role_capabilities WHERE plugin_id=? ORDER BY capability_id,role").bind(pluginId).all(), env.DB.prepare("SELECT id,label,scope FROM roles ORDER BY scope DESC,label COLLATE NOCASE").all()]);
  return json({ roles: roles.results, capabilities: definitions.results.map((item) => ({ ...item, roles: assignments.results.filter((assignment) => assignment.capability_id === item.capability_id).map((assignment) => assignment.role) })) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPut({ request, env, params }) {
  const admin = await requireRoleManager(request, env); if (!admin) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const pluginId = String(params.pluginId || ""), body = await request.json().catch(() => null), capabilityId = String(body?.capabilityId || ""), selected = body?.roles;
  if (!await enabledPlugin(env, pluginId)) return json({ error: "Plugin no disponible." }, 404);
  if (!Array.isArray(selected) || selected.some((role) => typeof role !== "string")) return json({ error: "Roles inválidos." }, 422);
  const knownRoles = new Set((await availableRoles(env)).map((role) => role.id));
  if (selected.some((role) => !knownRoles.has(role))) return json({ error: "Roles inválidos." }, 422);
  const definition = await env.DB.prepare("SELECT 1 FROM plugin_capabilities WHERE plugin_id=? AND capability_id=?").bind(pluginId, capabilityId).first(); if (!definition) return json({ error: "Capacidad no declarada." }, 404);
  await env.DB.batch([env.DB.prepare("DELETE FROM plugin_role_capabilities WHERE plugin_id=? AND capability_id=?").bind(pluginId, capabilityId), ...[...new Set(selected)].map((role) => env.DB.prepare("INSERT INTO plugin_role_capabilities(plugin_id,capability_id,role) VALUES(?,?,?)").bind(pluginId, capabilityId, role))]);
  await pluginAudit(env, pluginId, "capability_roles_updated", admin.id, { capabilityId, roles: [...new Set(selected)] });
  return json({ ok: true, capabilityId, roles: [...new Set(selected)] });
}
