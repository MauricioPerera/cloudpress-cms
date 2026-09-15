import { json, requireAdmin } from "../../_shared.js";
function matches(type, value) { return (type === "string" && typeof value === "string" && value.length <= 4000) || (type === "number" && typeof value === "number" && Number.isFinite(value)) || (type === "boolean" && typeof value === "boolean") || type === "json"; }
export async function onRequestPut({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const body = await request.json().catch(() => null); const scope = body?.scope; const id = Number(body?.id); const key = String(body?.key || "");
  if (!['content','user'].includes(scope) || !Number.isInteger(id) || id < 1) return json({ error: "Entidad inválida" }, 400);
  const definition = await env.DB.prepare("SELECT m.* FROM plugin_meta_definitions m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' AND m.scope=? AND m.meta_key=?").bind(scope,key).first();
  if (!definition || !matches(definition.value_type, body?.value)) return json({ error: "El metadato no cumple su contrato." }, 422);
  const table = scope === 'content' ? 'content_meta' : 'user_meta'; const column = scope === 'content' ? 'content_id' : 'user_id';
  await env.DB.prepare(`INSERT INTO ${table}(${column},meta_key,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(${column},meta_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(id,key,JSON.stringify(body.value),new Date().toISOString()).run();
  return json({ ok: true, scope, id, key, value: body.value });
}
