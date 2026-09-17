import { knownContentType } from "./_content-types.js";

const fieldPattern = /^[a-z][a-z0-9-]{1,47}$/;
const types = new Set(["string", "number", "boolean", "date", "reference"]);
const keyFor = (typeId, fieldId) => `core.${typeId}.${fieldId}`;
const parse = (row) => ({ ...row, required: Boolean(row.required), settings: JSON.parse(row.settings_json || "{}") });

async function fieldsFor(env, typeId) {
  const result = await env.DB.prepare("SELECT type_id,field_id,label,value_type,required,relation_type,settings_json,created_at,updated_at FROM core_content_fields WHERE type_id=? ORDER BY field_id").bind(typeId).all();
  return result.results.map(parse);
}

function validDefinition(body) {
  const fieldId = String(body?.fieldId || "").trim().toLowerCase();
  const label = String(body?.label || "").trim();
  const valueType = String(body?.valueType || "");
  const required = Boolean(body?.required);
  const relationType = body?.relationType === undefined || body?.relationType === null || body?.relationType === "" ? null : String(body.relationType);
  const settings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? body.settings : {};
  if (!fieldPattern.test(fieldId) || !label || label.length > 80 || !types.has(valueType) || (valueType === "reference") !== Boolean(relationType) || JSON.stringify(settings).length > 2000) return null;
  if (settings.maxLength !== undefined && (!Number.isInteger(settings.maxLength) || settings.maxLength < 1 || settings.maxLength > 4000)) return null;
  return { fieldId, label, valueType, required, relationType, settings };
}

function matches(field, value) {
  if (field.value_type === "string") return typeof value === "string" && value.length <= (field.settings.maxLength || 4000);
  if (field.value_type === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.value_type === "boolean") return typeof value === "boolean";
  if (field.value_type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  return Number.isInteger(value) && value > 0;
}

async function validateCustomFields(env, typeId, submitted, { existing = {}, requireAll = true } = {}) {
  const fields = await fieldsFor(env, typeId);
  if (!fields.length) { if (submitted !== undefined && (typeof submitted !== "object" || submitted === null || Array.isArray(submitted) || Object.keys(submitted).length)) throw new Error("Este tipo no declara campos configurables."); return { fields, values: {} }; }
  if (submitted !== undefined && (typeof submitted !== "object" || submitted === null || Array.isArray(submitted))) throw new Error("Los campos deben ser un objeto.");
  const input = submitted === undefined ? {} : submitted;
  const byId = new Map(fields.map((field) => [field.field_id, field]));
  if (Object.keys(input).some((id) => !byId.has(id))) throw new Error("Incluye un campo no declarado.");
  const values = { ...existing, ...input };
  for (const field of fields) {
    const value = values[field.field_id];
    if ((value === undefined || value === null || value === "") && !field.required) { delete values[field.field_id]; continue; }
    if ((value === undefined || value === null || value === "") && field.required && requireAll) throw new Error(`El campo ${field.label} es obligatorio.`);
    if (value !== undefined && !matches(field, value)) throw new Error(`El campo ${field.label} no tiene el formato esperado.`);
    if (field.value_type === "reference" && value !== undefined) {
      const target = await env.DB.prepare("SELECT 1 FROM content_items WHERE id=? AND content_type=? AND status!='trash'").bind(value, field.relation_type).first();
      if (!target) throw new Error(`La relación ${field.label} no apunta a contenido disponible del tipo correcto.`);
    }
  }
  return { fields, values };
}

async function currentCustomFields(env, contentId, typeId) {
  const fields = await fieldsFor(env, typeId); if (!fields.length) return {};
  const rows = await env.DB.prepare("SELECT meta_key,value_json FROM content_meta WHERE content_id=? AND meta_key LIKE ?").bind(contentId, `core.${typeId}.%`).all();
  const allowed = new Set(fields.map((field) => keyFor(typeId, field.field_id)));
  return Object.fromEntries(rows.results.filter((row) => allowed.has(row.meta_key)).map((row) => [row.meta_key.slice(`core.${typeId}.`.length), JSON.parse(row.value_json)]));
}

async function saveCustomFields(env, contentId, typeId, values) {
  const fields = await fieldsFor(env, typeId); const prefix = `core.${typeId}.`;
  const statements = [env.DB.prepare("DELETE FROM content_meta WHERE content_id=? AND meta_key LIKE ?").bind(contentId, `${prefix}%`)];
  for (const field of fields) if (values[field.field_id] !== undefined) statements.push(env.DB.prepare("INSERT INTO content_meta(content_id,meta_key,value_json,updated_at) VALUES(?,?,?,?)").bind(contentId, keyFor(typeId, field.field_id), JSON.stringify(values[field.field_id]), new Date().toISOString()));
  await env.DB.batch(statements);
}
async function clearCustomFields(env, contentId, typeId) { await env.DB.prepare("DELETE FROM content_meta WHERE content_id=? AND meta_key LIKE ?").bind(contentId, `core.${typeId}.%`).run(); }

export { clearCustomFields, currentCustomFields, fieldsFor, keyFor, knownContentType, saveCustomFields, validDefinition, validateCustomFields };
