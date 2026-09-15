import { pluginRegistry } from "./registry.js";

const idPattern = /^[a-z0-9][a-z0-9-]{2,47}$/;
const safeJson = (value) => JSON.parse(JSON.stringify(value ?? null));
const now = () => new Date().toISOString();

export function auditSnapshot(value) {
  const redact = (item, depth = 0) => { if (depth > 4) return "[truncated-depth]"; if (Array.isArray(item)) return item.slice(0, 30).map((value) => redact(value, depth + 1)); if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).slice(0, 40).map(([key, value]) => [key, /password|token|secret|authorization/i.test(key) ? "[redacted]" : redact(value, depth + 1)])); if (typeof item === "string") return item.slice(0, 1000); return item; };
  const snapshot = redact(safeJson(value));
  return JSON.stringify(snapshot).slice(0, 4000);
}

export async function enabledPlugin(env, id) {
  const plugin = pluginRegistry.get(id);
  if (!plugin) return null;
  const installed = await env.DB.prepare("SELECT status FROM plugin_installations WHERE plugin_id=?").bind(id).first();
  return installed?.status === "enabled" ? plugin : null;
}

export async function pluginAudit(env, pluginId, action, actorId, details = {}) {
  await env.DB.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(pluginId, action, actorId || null, JSON.stringify(safeJson(details))).run();
}

export function validateInput(schema, value) {
  if (!schema || Object.keys(schema).length === 0) return { valid: true };
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return { valid: false, error: "La entrada debe ser un objeto." };
  for (const key of schema.required || []) if (!(key in (value || {}))) return { valid: false, error: `Falta el campo ${key}.` };
  for (const [key, rule] of Object.entries(schema.properties || {})) { const item = value?.[key]; if (item === undefined) continue; if (rule.type === "string" && typeof item !== "string") return { valid: false, error: `${key} debe ser texto.` }; if (rule.type === "number" && (typeof item !== "number" || !Number.isFinite(item))) return { valid: false, error: `${key} debe ser número.` }; if (rule.type === "boolean" && typeof item !== "boolean") return { valid: false, error: `${key} debe ser booleano.` }; if (rule.maxLength && String(item).length > rule.maxLength) return { valid: false, error: `${key} excede el tamaño permitido.` }; }
  return { valid: true };
}

export function createPluginContext(env, pluginId, actor) {
  const validCollection = (value) => idPattern.test(String(value || ""));
  const assert = (collection, key) => { if (!validCollection(collection) || typeof key !== "string" || !key || key.length > 160) throw new Error("Registro de plugin inválido."); };
  return Object.freeze({
    actor: Object.freeze({ id: actor?.id || null, role: actor?.role || "system" }),
    data: Object.freeze({
      async get(collection, key) { assert(collection, key); const row = await env.DB.prepare("SELECT value_json,subject_user_id,created_at,updated_at FROM plugin_records WHERE plugin_id=? AND collection_id=? AND record_key=?").bind(pluginId, collection, key).first(); return row ? { key, value: JSON.parse(row.value_json), subjectUserId: row.subject_user_id, createdAt: row.created_at, updatedAt: row.updated_at } : null; },
      async list(collection, { subjectUserId = null, limit = 100 } = {}) { if (!validCollection(collection)) throw new Error("Colección inválida."); const size = Math.min(Math.max(Number(limit) || 100, 1), 200); const query = subjectUserId ? env.DB.prepare("SELECT record_key,value_json,subject_user_id,created_at,updated_at FROM plugin_records WHERE plugin_id=? AND collection_id=? AND subject_user_id=? ORDER BY record_key LIMIT ?").bind(pluginId, collection, subjectUserId, size) : env.DB.prepare("SELECT record_key,value_json,subject_user_id,created_at,updated_at FROM plugin_records WHERE plugin_id=? AND collection_id=? ORDER BY record_key LIMIT ?").bind(pluginId, collection, size); const rows = await query.all(); return rows.results.map((row) => ({ key: row.record_key, value: JSON.parse(row.value_json), subjectUserId: row.subject_user_id, createdAt: row.created_at, updatedAt: row.updated_at })); },
      async put(collection, key, value, { subjectUserId = null } = {}) { assert(collection, key); const serialized = JSON.stringify(safeJson(value)); if (serialized.length > 64000) throw new Error("El registro excede 64 KB."); await env.DB.prepare("INSERT INTO plugin_records(plugin_id,collection_id,record_key,subject_user_id,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(plugin_id,collection_id,record_key) DO UPDATE SET subject_user_id=excluded.subject_user_id,value_json=excluded.value_json,updated_at=excluded.updated_at").bind(pluginId, collection, key, Number.isInteger(subjectUserId) ? subjectUserId : null, serialized, now(), now()).run(); return { key, value: safeJson(value), subjectUserId: Number.isInteger(subjectUserId) ? subjectUserId : null }; },
      async remove(collection, key) { assert(collection, key); const result = await env.DB.prepare("DELETE FROM plugin_records WHERE plugin_id=? AND collection_id=? AND record_key=?").bind(pluginId, collection, key).run(); return { removed: Boolean(result.meta.changes) }; }
    }),
    async enqueue(taskId, payload = {}, { dedupeKey = crypto.randomUUID(), runAfter = now() } = {}) { if (!idPattern.test(String(taskId || "")) || typeof dedupeKey !== "string" || !dedupeKey || dedupeKey.length > 160) throw new Error("Tarea inválida."); const result = await env.DB.prepare("INSERT INTO plugin_jobs(plugin_id,task_id,dedupe_key,payload_json,status,run_after,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?,?) ON CONFLICT(plugin_id,task_id,dedupe_key) DO NOTHING").bind(pluginId, taskId, dedupeKey, JSON.stringify(safeJson(payload)), runAfter, now(), now()).run(); return { queued: Boolean(result.meta.changes), dedupeKey }; },
    async audit(action, details = {}) { await pluginAudit(env, pluginId, action, actor?.id, details); }
  });
}

export async function applyPluginMigrations(env, plugin, actor) {
  const applied = [];
  for (const migration of plugin.manifest.migrations || []) { const existing = await env.DB.prepare("SELECT 1 FROM plugin_migrations WHERE plugin_id=? AND migration_id=?").bind(plugin.manifest.id, migration.id).first(); if (!existing) { await env.DB.prepare("INSERT INTO plugin_migrations(plugin_id,migration_id,applied_at) VALUES(?,?,?)").bind(plugin.manifest.id, migration.id, now()).run(); applied.push(migration.id); } }
  if (applied.length) await pluginAudit(env, plugin.manifest.id, "migrations_applied", actor?.id, { applied });
  return applied;
}
