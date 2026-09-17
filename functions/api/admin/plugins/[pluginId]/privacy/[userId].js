import { json, requireAdmin } from "../../../../../_shared.js";
import { enabledPlugin, pluginAudit } from "../../../../../_plugins/host.js";

async function target(env, pluginId, userId) { const plugin = await enabledPlugin(env, pluginId); if (!plugin) return { error: "Plugin no disponible." }; if (!plugin.manifest.permissions.includes("privacy:manage")) return { error: "El plugin no declaró gestión de privacidad." }; const user = await env.DB.prepare("SELECT id,username,email FROM users WHERE id=?").bind(userId).first(); return user ? { plugin, user } : { error: "Usuario no encontrado." }; }
export async function onRequestGet({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const pluginId = String(params.pluginId || ""), userId = Number(params.userId), result = await target(env, pluginId, userId); if (result.error) return json({ error: result.error }, 404);
  const records = await env.DB.prepare("SELECT collection_id,record_key,value_json,created_at,updated_at FROM plugin_records WHERE plugin_id=? AND subject_user_id=? ORDER BY collection_id,record_key").bind(pluginId,userId).all();
  const meta = await env.DB.prepare("SELECT m.meta_key,m.value_json,m.updated_at FROM user_meta m JOIN plugin_meta_definitions d ON d.meta_key=m.meta_key AND d.scope='user' WHERE d.plugin_id=? AND m.user_id=? ORDER BY m.meta_key").bind(pluginId,userId).all();
  await pluginAudit(env, pluginId, "privacy_exported", admin.id, { userId, records: records.results.length, meta: meta.results.length });
  return json({ ok: true, user: result.user, data: { records: records.results.map((row)=>({ collection:row.collection_id,key:row.record_key,value:JSON.parse(row.value_json),createdAt:row.created_at,updatedAt:row.updated_at })), userMeta: meta.results.map((row)=>({ key:row.meta_key,value:JSON.parse(row.value_json),updatedAt:row.updated_at })) } });
}
export async function onRequestDelete({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const pluginId = String(params.pluginId || ""), userId = Number(params.userId), result = await target(env, pluginId, userId); if (result.error) return json({ error: result.error }, 404);
  const metaKeys = result.plugin.manifest.userMeta || [];
  const batch = [env.DB.prepare("DELETE FROM plugin_records WHERE plugin_id=? AND subject_user_id=?").bind(pluginId,userId), ...metaKeys.map((definition)=>env.DB.prepare("DELETE FROM user_meta WHERE user_id=? AND meta_key=?").bind(userId,definition.key))];
  await env.DB.batch(batch); await pluginAudit(env, pluginId, "privacy_erased", admin.id, { userId });
  return json({ ok: true, erased: true, userId });
}
