import { bytesToBase64, json, requireAdmin, sha256 } from "../../../../../_shared.js";
import { enabledPlugin, pluginAudit } from "../../../../../_plugins/host.js";

function token() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); }
export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const pluginId = String(params.pluginId || ""), webhookId = String(params.webhookId || ""), plugin = await enabledPlugin(env, pluginId); if (!plugin) return json({ error: "Plugin no disponible." }, 404);
  const webhook = plugin.manifest.webhooks?.find((item) => item.id === webhookId); if (!webhook) return json({ error: "Webhook no declarado." }, 404);
  const value = token(), hash = bytesToBase64(await sha256(value)), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO plugin_webhooks(plugin_id,webhook_id,token_hash,created_at,rotated_at) VALUES(?,?,?,?,?) ON CONFLICT(plugin_id,webhook_id) DO UPDATE SET token_hash=excluded.token_hash,rotated_at=excluded.rotated_at").bind(pluginId, webhookId, hash, now, now).run();
  await pluginAudit(env, pluginId, "webhook_rotated", admin.id, { webhookId });
  return json({ ok: true, id: webhookId, path: `/api/plugins/${pluginId}${webhook.path}`, token: value, warning: "Copia este token ahora; no se volverá a mostrar." }, 201);
}
