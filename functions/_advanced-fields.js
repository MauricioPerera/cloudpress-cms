import { knownContentType } from "./_content-types.js";

const groupPattern = /^[a-z][a-z0-9-]{2,47}$/;
const fieldPattern = /^[a-z][a-z0-9-]{1,47}$/;
const types = new Set(["text", "textarea", "number", "boolean", "date", "email", "url", "select", "reference"]);
const keyFor = (groupId, fieldId) => `acf.${groupId}.${fieldId}`;
const parse = (row) => ({ ...row, active: Boolean(row.active), required: Boolean(row.required), settings: JSON.parse(row.settings_json || "{}") });

function validOptions(options) {
  return Array.isArray(options) && options.length > 0 && options.length <= 100 && options.every((item) => typeof item === "string" && item.trim() && item.length <= 120) && new Set(options).size === options.length;
}

function validGroup(body) {
  const groupId = String(body?.groupId || "").trim().toLowerCase();
  const title = String(body?.title || "").trim();
  const contentType = String(body?.contentType || "").trim();
  if (!groupPattern.test(groupId) || !title || title.length > 100 || !contentType) return null;
  return { groupId, title, contentType, active: body?.active !== false };
}

function validField(body) {
  const fieldId = String(body?.fieldId || "").trim().toLowerCase();
  const label = String(body?.label || "").trim();
  const valueType = String(body?.valueType || "");
  const relationType = body?.relationType == null || body.relationType === "" ? null : String(body.relationType);
  const settings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? body.settings : {};
  if (!fieldPattern.test(fieldId) || !label || label.length > 100 || !types.has(valueType) || (valueType === "reference") !== Boolean(relationType) || JSON.stringify(settings).length > 4000) return null;
  if (settings.maxLength !== undefined && (!Number.isInteger(settings.maxLength) || settings.maxLength < 1 || settings.maxLength > 10000)) return null;
  if (valueType === "select" && !validOptions(settings.options)) return null;
  if (valueType !== "select" && settings.options !== undefined) return null;
  return { fieldId, label, valueType, required: Boolean(body?.required), relationType, settings };
}

async function groupsFor(env, contentType = null) {
  const query = contentType ? "SELECT group_id,title,content_type,active,created_at,updated_at FROM custom_field_groups WHERE content_type=? ORDER BY title COLLATE NOCASE" : "SELECT group_id,title,content_type,active,created_at,updated_at FROM custom_field_groups ORDER BY content_type,title COLLATE NOCASE";
  const result = contentType ? await env.DB.prepare(query).bind(contentType).all() : await env.DB.prepare(query).all();
  return result.results.map(parse);
}

async function fieldsForGroup(env, groupId) {
  const result = await env.DB.prepare("SELECT group_id,field_id,label,value_type,required,relation_type,settings_json,created_at,updated_at FROM custom_field_definitions WHERE group_id=? ORDER BY field_id").bind(groupId).all();
  return result.results.map(parse);
}

async function definitionsFor(env, contentType) {
  const groups = (await groupsFor(env, contentType)).filter((group) => group.active);
  return Promise.all(groups.map(async (group) => ({ ...group, fields: await fieldsForGroup(env, group.group_id) })));
}

function matches(field, value) {
  if (field.value_type === "text" || field.value_type === "textarea") return typeof value === "string" && value.length <= (field.settings.maxLength || (field.value_type === "textarea" ? 10000 : 1000));
  if (field.value_type === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.value_type === "boolean") return typeof value === "boolean";
  if (field.value_type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (field.value_type === "email") return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (field.value_type === "url") { try { return typeof value === "string" && value.length <= 2048 && ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
  if (field.value_type === "select") return typeof value === "string" && field.settings.options.includes(value);
  return Number.isInteger(value) && value > 0;
}

async function currentAdvancedFields(env, contentId, contentType) {
  const groups = await definitionsFor(env, contentType);
  if (!groups.length) return {};
  const allowed = new Set(groups.flatMap((group) => group.fields.map((field) => keyFor(group.group_id, field.field_id))));
  const rows = await env.DB.prepare("SELECT meta_key,value_json FROM content_meta WHERE content_id=? AND meta_key LIKE 'acf.%'").bind(contentId).all();
  const values = {};
  for (const row of rows.results) if (allowed.has(row.meta_key)) values[row.meta_key.slice(4)] = JSON.parse(row.value_json);
  return values;
}

async function validateAdvancedFields(env, contentType, submitted, { existing = {}, requireAll = true } = {}) {
  const groups = await definitionsFor(env, contentType);
  const fields = groups.flatMap((group) => group.fields.map((field) => ({ ...field, group_id: group.group_id, key: `${group.group_id}.${field.field_id}` })));
  if (!fields.length) { if (submitted !== undefined && (typeof submitted !== "object" || submitted === null || Array.isArray(submitted) || Object.keys(submitted).length)) throw new Error("Este tipo no declara metadatos configurables."); return { fields, values: {} }; }
  if (submitted !== undefined && (typeof submitted !== "object" || submitted === null || Array.isArray(submitted))) throw new Error("Los metadatos deben ser un objeto.");
  const input = submitted === undefined ? {} : submitted;
  const byKey = new Map(fields.map((field) => [field.key, field]));
  if (Object.keys(input).some((key) => !byKey.has(key))) throw new Error("Incluye un metadato no declarado.");
  const values = { ...existing, ...input };
  for (const field of fields) {
    const value = values[field.key];
    if ((value === undefined || value === null || value === "") && !field.required) { delete values[field.key]; continue; }
    if ((value === undefined || value === null || value === "") && field.required && requireAll) throw new Error(`El metadato ${field.label} es obligatorio.`);
    if (value !== undefined && !matches(field, value)) throw new Error(`El metadato ${field.label} no tiene el formato esperado.`);
    if (field.value_type === "reference" && value !== undefined) {
      const target = await env.DB.prepare("SELECT 1 FROM content_items WHERE id=? AND content_type=? AND status!='trash'").bind(value, field.relation_type).first();
      if (!target) throw new Error(`La relación ${field.label} no apunta a contenido disponible del tipo correcto.`);
    }
  }
  return { fields, values };
}

async function saveAdvancedFields(env, contentId, fields, values) {
  const statements = [env.DB.prepare("DELETE FROM content_meta WHERE content_id=? AND meta_key LIKE 'acf.%'").bind(contentId)];
  for (const field of fields) if (values[field.key] !== undefined) statements.push(env.DB.prepare("INSERT INTO content_meta(content_id,meta_key,value_json,updated_at) VALUES(?,?,?,?)").bind(contentId, keyFor(field.group_id, field.field_id), JSON.stringify(values[field.key]), new Date().toISOString()));
  await env.DB.batch(statements);
}

export { currentAdvancedFields, definitionsFor, fieldsForGroup, groupsFor, keyFor, knownContentType, saveAdvancedFields, validField, validGroup, validateAdvancedFields };
