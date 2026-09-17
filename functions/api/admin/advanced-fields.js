import { json, requireAdmin } from "../../_shared.js";
import { fieldsForGroup, groupsFor, knownContentType, validField, validGroup } from "../../_advanced-fields.js";

const groupPattern = /^[a-z][a-z0-9-]{2,47}$/;
const fieldPattern = /^[a-z][a-z0-9-]{1,47}$/;
const allowed = (request, env) => requireAdmin(request, env, "content:manage");
const groupExists = async (env, groupId) => Boolean(await env.DB.prepare("SELECT 1 FROM custom_field_groups WHERE group_id=?").bind(groupId).first());

export async function onRequestGet({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const type = new URL(request.url).searchParams.get("contentType");
  if (type && !await knownContentType(env, type)) return json({ error: "Tipo de contenido no declarado" }, 422);
  const groups = await groupsFor(env, type);
  return json({ groups: await Promise.all(groups.map(async (group) => ({ ...group, fields: await fieldsForGroup(env, group.group_id) }))) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null);
  if (body?.action === "group") {
    const group = validGroup(body);
    if (!group || !await knownContentType(env, group.contentType)) return json({ error: "Grupo de campos inválido" }, 422);
    try { await env.DB.prepare("INSERT INTO custom_field_groups(group_id,title,content_type,active,updated_at) VALUES(?,?,?,?,?)").bind(group.groupId, group.title, group.contentType, group.active ? 1 : 0, new Date().toISOString()).run(); }
    catch { return json({ error: "Ese identificador de grupo ya existe" }, 409); }
    return json({ ok: true, group }, 201);
  }
  if (body?.action === "field") {
    const groupId = String(body.groupId || ""), field = validField(body);
    if (!groupPattern.test(groupId) || !field || !await groupExists(env, groupId) || (field.valueType === "reference" && !await knownContentType(env, field.relationType))) return json({ error: "Campo de metadatos inválido" }, 422);
    try { await env.DB.prepare("INSERT INTO custom_field_definitions(group_id,field_id,label,value_type,required,relation_type,settings_json,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(groupId, field.fieldId, field.label, field.valueType, field.required ? 1 : 0, field.relationType, JSON.stringify(field.settings), new Date().toISOString()).run(); }
    catch { return json({ error: "Ese identificador de campo ya existe en el grupo" }, 409); }
    return json({ ok: true, groupId, field }, 201);
  }
  return json({ error: "Acción inválida" }, 422);
}

export async function onRequestPatch({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const body = await request.json().catch(() => null);
  if (body?.action === "group") {
    const group = validGroup(body);
    if (!group || !await knownContentType(env, group.contentType)) return json({ error: "Grupo de campos inválido" }, 422);
    const result = await env.DB.prepare("UPDATE custom_field_groups SET title=?,content_type=?,active=?,updated_at=? WHERE group_id=?").bind(group.title, group.contentType, group.active ? 1 : 0, new Date().toISOString(), group.groupId).run();
    return result.meta?.changes ? json({ ok: true, group }) : json({ error: "Grupo no encontrado" }, 404);
  }
  if (body?.action === "field") {
    const groupId = String(body.groupId || ""), field = validField(body);
    if (!groupPattern.test(groupId) || !field || !await groupExists(env, groupId) || (field.valueType === "reference" && !await knownContentType(env, field.relationType))) return json({ error: "Campo de metadatos inválido" }, 422);
    const result = await env.DB.prepare("UPDATE custom_field_definitions SET label=?,value_type=?,required=?,relation_type=?,settings_json=?,updated_at=? WHERE group_id=? AND field_id=?").bind(field.label, field.valueType, field.required ? 1 : 0, field.relationType, JSON.stringify(field.settings), new Date().toISOString(), groupId, field.fieldId).run();
    return result.meta?.changes ? json({ ok: true, groupId, field }) : json({ error: "Campo no encontrado" }, 404);
  }
  return json({ error: "Acción inválida" }, 422);
}

export async function onRequestDelete({ request, env }) {
  if (!await allowed(request, env)) return json({ error: "Se requiere permiso de contenido" }, 403);
  const url = new URL(request.url), groupId = url.searchParams.get("group") || "", fieldId = url.searchParams.get("field");
  if (!groupPattern.test(groupId) || (fieldId && !fieldPattern.test(fieldId))) return json({ error: "Identificador inválido" }, 422);
  if (fieldId) {
    const used = await env.DB.prepare("SELECT 1 FROM content_meta WHERE meta_key=? LIMIT 1").bind(`acf.${groupId}.${fieldId}`).first();
    if (used) return json({ error: "No se puede eliminar un campo que ya tiene valores." }, 409);
    const result = await env.DB.prepare("DELETE FROM custom_field_definitions WHERE group_id=? AND field_id=?").bind(groupId, fieldId).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: "Campo no encontrado" }, 404);
  }
  const used = await env.DB.prepare("SELECT 1 FROM content_meta WHERE meta_key LIKE ? LIMIT 1").bind(`acf.${groupId}.%`).first();
  if (used) return json({ error: "No se puede eliminar un grupo que ya tiene valores." }, 409);
  const result = await env.DB.prepare("DELETE FROM custom_field_groups WHERE group_id=?").bind(groupId).run();
  return result.meta?.changes ? json({ ok: true }) : json({ error: "Grupo no encontrado" }, 404);
}
