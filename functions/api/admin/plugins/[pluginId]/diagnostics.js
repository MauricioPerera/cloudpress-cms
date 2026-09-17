import { json, requireAdmin } from "../../../../_shared.js";
import { createPluginContext, enabledPlugin, pluginAudit } from "../../../../_plugins/host.js";

export async function onRequestGet({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const pluginId = String(params.pluginId || ""), plugin = await enabledPlugin(env, pluginId); if (!plugin) return json({ error: "Plugin no disponible." }, 404);
  if (!plugin.manifest.permissions.includes("diagnostics:read")) return json({ error: "El plugin no declaró diagnósticos." }, 403);
  try { const result = typeof plugin.module?.diagnostics === "function" ? await plugin.module.diagnostics(createPluginContext(env, pluginId, admin)) : { status: "No declarado" }; await pluginAudit(env, pluginId, "diagnostics_read", admin.id, {}); return json({ ok: true, result }); }
  catch (error) { await pluginAudit(env, pluginId, "diagnostics_failed", admin.id, { error: String(error?.message || "Error") }); return json({ error: String(error?.message || "El diagnóstico falló.") }, 422); }
}
