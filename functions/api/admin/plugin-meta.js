import { json, requireAdmin } from "../../_shared.js";
function matches(type, value, schema = {}) {
  if (type === "string") return typeof value === "string" && value.length <= 4000 && (!schema.maxLength || value.length <= schema.maxLength) && (!schema.minLength || value.length >= schema.minLength) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (type === "number") return typeof value === "number" && Number.isFinite(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "json") return JSON.stringify(value).length <= 64000;
  return false;
}
export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "content:manage")) return json({ error: "Se requiere permiso de contenido" }, 403);
  const url = new URL(request.url), scope = url.searchParams.get("scope"), id = Number(url.searchParams.get("id"));
  if (!['content','user'].includes(scope) || !Number.isInteger(id) || id < 1) return json({ error: "Entidad inválida" }, 400);
  const table = scope === 'content' ? 'content_meta' : 'user_meta', column = scope === 'content' ? 'content_id' : 'user_id';
  const rows = await env.DB.prepare(`SELECT m.meta_key,m.value_json,m.updated_at FROM ${table} m JOIN plugin_meta_definitions d ON d.meta_key=m.meta_key AND d.scope=? JOIN plugin_installations p ON p.plugin_id=d.plugin_id WHERE p.status='enabled' AND m.${column}=? ORDER BY m.meta_key`).bind(scope,id).all();
  return json({ items: rows.results.map((row) => ({ key: row.meta_key, value: JSON.parse(row.value_json), updatedAt: row.updated_at })) }, 200, { "Cache-Control": "no-store" });
}
export async function onRequestPut({ request, env }) {
  if (!await requireAdmin(request, env, "content:manage")) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null); const scope = body?.scope; const id = Number(body?.id); const key = String(body?.key || "");
  if (!['content','user'].includes(scope) || !Number.isInteger(id) || id < 1) return json({ error: "Entidad inválida" }, 400);
  const definition = await env.DB.prepare("SELECT m.* FROM plugin_meta_definitions m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' AND m.scope=? AND m.meta_key=?").bind(scope,key).first();
  const schema = JSON.parse(definition?.schema_json || "{}");
  if (!definition || !matches(definition.value_type, body?.value, schema)) return json({ error: "El metadato no cumple su contrato." }, 422);
  const table = scope === 'content' ? 'content_meta' : 'user_meta'; const column = scope === 'content' ? 'content_id' : 'user_id';
  const entity = await env.DB.prepare(`SELECT 1 FROM ${scope === 'content' ? 'content_items' : 'users'} WHERE id=?`).bind(id).first();
  if (!entity) return json({ error: "Entidad no encontrada." }, 404);
  await env.DB.prepare(`INSERT INTO ${table}(${column},meta_key,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(${column},meta_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(id,key,JSON.stringify(body.value),new Date().toISOString()).run();
  return json({ ok: true, scope, id, key, value: body.value });
}
