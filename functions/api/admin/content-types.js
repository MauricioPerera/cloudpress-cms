import { json, requireAdmin } from "../../_shared.js";

const pattern = /^[a-z][a-z0-9-]{2,47}$/;
const supportedFields = new Set(["title", "body", "excerpt"]);
const reserved = new Set(["post", "page"]);
const serialize = (row) => ({ ...row, publicApi: Boolean(row.public_api), supports: JSON.parse(row.supports_json) });

function input(body, { includeId = true } = {}) {
  const id = String(body?.id || "").trim().toLowerCase();
  const label = String(body?.label || "").trim();
  const items = [...new Set(Array.isArray(body?.supports) ? body.supports : [])];
  if ((includeId && (!pattern.test(id) || reserved.has(id))) || !label || label.length > 80 || !items.includes("title") || items.some((item) => !supportedFields.has(item))) return null;
  if (body?.publicApi !== undefined && typeof body.publicApi !== "boolean") return null;
  return { ...(includeId ? { id } : {}), label, supports: items, publicApi: body?.publicApi === true };
}

async function canManage(request, env) {
  return await requireAdmin(request, env, "content:manage");
}

export async function onRequestGet({ request, env }) {
  if (!await canManage(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const result = await env.DB.prepare("SELECT type_id,label,supports_json,public_api,created_at,updated_at FROM core_content_types ORDER BY label COLLATE NOCASE").all();
  return json({ types: result.results.map(serialize) });
}

export async function onRequestPost({ request, env }) {
  if (!await canManage(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const value = input(await request.json().catch(() => null));
  if (!value) return json({ error: "Definición de tipo inválida; el título es obligatorio." }, 422);
  const plugin = await env.DB.prepare("SELECT 1 FROM plugin_content_types WHERE type_id=?").bind(value.id).first();
  if (plugin) return json({ error: "El identificador pertenece a un plugin" }, 409);
  try {
    await env.DB.prepare("INSERT INTO core_content_types(type_id,label,supports_json,public_api,updated_at) VALUES(?,?,?,?,?)").bind(value.id, value.label, JSON.stringify(value.supports), value.publicApi ? 1 : 0, new Date().toISOString()).run();
    return json({ ok: true, type: value }, 201);
  } catch {
    return json({ error: "El tipo ya existe" }, 409);
  }
}

export async function onRequestPut({ request, env }) {
  if (!await canManage(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null);
  const id = String(body?.id || "").trim().toLowerCase();
  const value = input(body, { includeId: false });
  if (!pattern.test(id) || !value) return json({ error: "Definición de tipo inválida; el título es obligatorio." }, 422);
  const result = await env.DB.prepare("UPDATE core_content_types SET label=?,supports_json=?,public_api=?,updated_at=? WHERE type_id=?").bind(value.label, JSON.stringify(value.supports), value.publicApi ? 1 : 0, new Date().toISOString(), id).run();
  if (!result.meta?.changes) return json({ error: "Tipo no encontrado" }, 404);
  return json({ ok: true, type: { id, ...value } });
}

export async function onRequestDelete({ request, env }) {
  if (!await canManage(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!pattern.test(id)) return json({ error: "Identificador inválido" }, 422);
  const used = await env.DB.prepare("SELECT 1 FROM content_items WHERE content_type=? LIMIT 1").bind(id).first();
  if (used) return json({ error: "No se puede eliminar un tipo que aún tiene contenido." }, 409);
  const result = await env.DB.prepare("DELETE FROM core_content_types WHERE type_id=?").bind(id).run();
  if (!result.meta?.changes) return json({ error: "Tipo no encontrado" }, 404);
  return json({ ok: true });
}
