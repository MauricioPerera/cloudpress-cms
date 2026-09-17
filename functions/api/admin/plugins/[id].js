import { json, requireAdmin } from "../../../_shared.js";
import { pluginRegistry } from "../../../_plugins/registry.js";
import { ensurePluginReleaseTable } from "../../../_plugins/host.js";

export async function onRequestPatch({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const id = String(params.id || ""); if (!pluginRegistry.has(id)) return json({ error: "Plugin desconocido" }, 404);
  const body = await request.json().catch(() => null); const status = body?.status;
  if (!['enabled','disabled'].includes(status)) return json({ error: "Estado inválido" }, 400);
  const result = await env.DB.prepare("UPDATE plugin_installations SET status=?,updated_at=? WHERE plugin_id=?").bind(status, new Date().toISOString(), id).run();
  if (!result.meta.changes) return json({ error: "Plugin no instalado" }, 404);
  await env.DB.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(id, status, admin.id, "{}").run();
  return json({ ok: true, id, status });
}

export async function onRequestDelete({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const id = String(params.id || ""); if (!pluginRegistry.has(id)) return json({ error: "Plugin desconocido" }, 404);
  await ensurePluginReleaseTable(env);
  const installation = await env.DB.prepare("SELECT manifest_json FROM plugin_installations WHERE plugin_id=?").bind(id).first();
  if (!installation) return json({ error: "Plugin no instalado" }, 404);
  const policy = JSON.parse(installation.manifest_json || "{}").uninstallPolicy || "preserve-content-purge-plugin-storage";
  await env.DB.prepare("DELETE FROM plugin_terms WHERE plugin_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM plugin_active_releases WHERE plugin_id=?").bind(id).run();
  const result = await env.DB.prepare("DELETE FROM plugin_installations WHERE plugin_id=?").bind(id).run();
  if (!result.meta.changes) return json({ error: "Plugin no instalado" }, 404);
  await env.DB.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(id, "uninstalled", admin.id, "{}").run();
  return json({ ok: true, id, status: "uninstalled", policy });
}
