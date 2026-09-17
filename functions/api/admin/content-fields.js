import { json, requireAdmin } from "../../_shared.js";
import { fieldsFor, knownContentType, validDefinition } from "../../_content-fields.js";

const typePattern = /^[a-z][a-z0-9-]{2,47}$/;
async function ownType(env, typeId) { return Boolean(await env.DB.prepare("SELECT 1 FROM core_content_types WHERE type_id=?").bind(typeId).first()); }
async function allowed(request, env) { return await requireAdmin(request, env, "content:manage"); }

export async function onRequestGet({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const typeId = new URL(request.url).searchParams.get("type") || "";
  if (!typePattern.test(typeId) || !await knownContentType(env, typeId)) return json({ error: "Tipo de contenido no declarado" }, 422);
  return json({ typeId, fields: await fieldsFor(env, typeId) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null); const typeId = String(body?.typeId || ""); const field = validDefinition(body);
  if (!typePattern.test(typeId) || !field || !await ownType(env, typeId)) return json({ error: "Definición de campo inválida" }, 422);
  if (field.valueType === "reference" && !await knownContentType(env, field.relationType)) return json({ error: "El tipo relacionado no está declarado" }, 422);
  try { await env.DB.prepare("INSERT INTO core_content_fields(type_id,field_id,label,value_type,required,relation_type,settings_json,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(typeId, field.fieldId, field.label, field.valueType, field.required ? 1 : 0, field.relationType, JSON.stringify(field.settings), new Date().toISOString()).run(); }
  catch { return json({ error: "Ese identificador de campo ya existe" }, 409); }
  return json({ ok: true, typeId, field }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null); const typeId = String(body?.typeId || ""); const field = validDefinition(body);
  if (!typePattern.test(typeId) || !field || !await ownType(env, typeId)) return json({ error: "Definición de campo inválida" }, 422);
  if (field.valueType === "reference" && !await knownContentType(env, field.relationType)) return json({ error: "El tipo relacionado no está declarado" }, 422);
  const result = await env.DB.prepare("UPDATE core_content_fields SET label=?,value_type=?,required=?,relation_type=?,settings_json=?,updated_at=? WHERE type_id=? AND field_id=?").bind(field.label, field.valueType, field.required ? 1 : 0, field.relationType, JSON.stringify(field.settings), new Date().toISOString(), typeId, field.fieldId).run();
  if (!result.meta?.changes) return json({ error: "Campo no encontrado" }, 404);
  return json({ ok: true, typeId, field });
}

export async function onRequestDelete({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const url = new URL(request.url), typeId = url.searchParams.get("type") || "", fieldId = url.searchParams.get("field") || "";
  if (!typePattern.test(typeId) || !/^[a-z][a-z0-9-]{1,47}$/.test(fieldId)) return json({ error: "Identificador inválido" }, 422);
  const used = await env.DB.prepare("SELECT 1 FROM content_meta WHERE meta_key=? LIMIT 1").bind(`core.${typeId}.${fieldId}`).first();
  if (used) return json({ error: "No se puede eliminar un campo que ya tiene valores." }, 409);
  const result = await env.DB.prepare("DELETE FROM core_content_fields WHERE type_id=? AND field_id=?").bind(typeId, fieldId).run();
  if (!result.meta?.changes) return json({ error: "Campo no encontrado" }, 404);
  return json({ ok: true });
}
