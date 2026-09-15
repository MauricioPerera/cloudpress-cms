import { base64ToBytes, bytesToBase64, currentUser, equalBytes, json, sha256 } from "../../../_shared.js";
import { createPluginContext, enabledPlugin, pluginAudit } from "../../../_plugins/host.js";
import { allowed } from "../../../_plugins/execute.js";

export async function onRequest({ request, env, params }) {
  const pluginId = String(params.pluginId || ""), plugin = await enabledPlugin(env, pluginId);
  if (!plugin) return json({ error: "Plugin no disponible." }, 404);
  const raw = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const path = `/${raw.replace(/^\/+|\/+$/g, "")}`;
  const webhook = plugin.manifest.webhooks?.find((item) => item.path === path && request.method === "POST");
  if (webhook) {
    const provided = request.headers.get("x-cloudpress-webhook-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!provided) return json({ error: "Token de webhook requerido." }, 401);
    const expected = await env.DB.prepare("SELECT token_hash FROM plugin_webhooks WHERE plugin_id=? AND webhook_id=?").bind(pluginId, webhook.id).first();
    if (!expected || !equalBytes(await sha256(provided), base64ToBytes(expected.token_hash))) return json({ error: "Token de webhook inválido." }, 401);
    const handler = plugin.module?.webhooks?.[webhook.handler]; if (typeof handler !== "function") return json({ error: "Handler de webhook no disponible." }, 501);
    const body = await request.json().catch(() => null);
    try { const result = await handler(createPluginContext(env, pluginId, { id: null, role: "webhook" }), { body, request }); await pluginAudit(env, pluginId, "webhook_succeeded", null, { webhookId: webhook.id, path }); return json({ ok: true, result }); }
    catch (error) { await pluginAudit(env, pluginId, "webhook_failed", null, { webhookId: webhook.id, path, error: String(error?.message || "Error") }); return json({ error: String(error?.message || "El webhook falló.") }, 422); }
  }
  const route = plugin.manifest.routes?.find((item) => item.path === path && item.methods.includes(request.method));
  if (!route) return json({ error: "Ruta de plugin no declarada." }, 404);
  const user = await currentUser(request, env); if (!await allowed(env, user, pluginId, route.capability)) return json({ error: "No tienes permiso para esta ruta." }, 403);
  const handler = plugin.module?.routes?.[route.handler]; if (typeof handler !== "function") return json({ error: "Handler de ruta no disponible." }, 501);
  try { const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.json().catch(() => null) : null; const result = await handler(createPluginContext(env, pluginId, user), { request, body, params: new URL(request.url).searchParams }); await pluginAudit(env, pluginId, "route_succeeded", user.id, { path, method: request.method }); return json({ ok: true, result }); }
  catch (error) { await pluginAudit(env, pluginId, "route_failed", user.id, { path, method: request.method, error: String(error?.message || "Error") }); return json({ error: String(error?.message || "La ruta falló.") }, 422); }
}
