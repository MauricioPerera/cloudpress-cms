import { bytesToBase64, json, sha256 } from "./_shared.js";
import { deleteMediaMetadata } from "./_media.js";
import { ensurePluginReleaseTable } from "./_plugins/host.js";

const OPERATIONS = new Set(["purge_content", "delete_user", "delete_media", "uninstall_plugin", "delete_metadata", "delete_core_term", "delete_plugin_term"]);
const safeMediaName = (value) => typeof value === "string" && value.length <= 100 && value.length > 0 && !value.includes("/") && !value.includes("..");
const safePluginId = (value) => /^[a-z0-9][a-z0-9-]{2,47}$/.test(String(value || ""));
const positiveId = (value) => Number.isInteger(value) && value > 0;
const now = () => new Date().toISOString();
const LEGACY_OPERATION_VALUES = new Set(["purge_content", "delete_user", "delete_media", "uninstall_plugin"]);
// Existing deployments constrain approval_requests.operation to the original four
// values. The canonical action is always payload.operation; this column remains a
// backwards-compatible index hint until a versioned database migration can widen it.
const storedOperation = (operation) => LEGACY_OPERATION_VALUES.has(operation) ? operation : "purge_content";

async function event(env, requestId, actorId, eventName, details = {}) {
  await env.DB.prepare("INSERT INTO approval_events(request_id,actor_id,event,details_json,created_at) VALUES(?,?,?,?,?)")
    .bind(requestId, actorId || null, eventName, JSON.stringify(details), now()).run();
}

async function targetFor(env, admin, input) {
  if (!input || typeof input !== "object" || !OPERATIONS.has(input.operation)) throw new Error("Operación irreversible inválida.");
  if (input.operation === "purge_content") {
    if (!positiveId(input.contentId)) throw new Error("Contenido inválido.");
    const item = await env.DB.prepare("SELECT id,title,status FROM content_items WHERE id=?").bind(input.contentId).first();
    if (!item || item.status !== "trash") throw new Error("El contenido debe estar en Papelera antes de purgarse.");
    return { payload: { operation: input.operation, contentId: item.id }, summary: { operation: input.operation, target: { id: item.id, title: item.title }, risk: "irreversible" } };
  }
  if (input.operation === "delete_user") {
    if (!positiveId(input.userId) || input.userId === admin.id) throw new Error("No puedes eliminar esta cuenta.");
    const user = await env.DB.prepare("SELECT id,username,role FROM users WHERE id=?").bind(input.userId).first();
    if (!user) throw new Error("Usuario no encontrado.");
    return { payload: { operation: input.operation, userId: user.id }, summary: { operation: input.operation, target: { id: user.id, username: user.username, role: user.role }, risk: "irreversible" } };
  }
  if (input.operation === "delete_media") {
    if (!safeMediaName(input.key)) throw new Error("Archivo inválido.");
    const object = await env.MEDIA.head(`media/${input.key}`);
    if (!object) throw new Error("Archivo no encontrado.");
    return { payload: { operation: input.operation, key: input.key }, summary: { operation: input.operation, target: { key: input.key, size: object.size }, risk: "irreversible" } };
  }
  if (input.operation === "delete_metadata") {
    const scope = input.scope === "content" || input.scope === "user" ? input.scope : null;
    const entityId = input.entityId;
    const key = String(input.key || "");
    if (!scope || !positiveId(entityId) || !/^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/.test(key)) throw new Error("Metadato inválido.");
    const table = scope === "content" ? "content_meta" : "user_meta", column = scope === "content" ? "content_id" : "user_id";
    const record = await env.DB.prepare(`SELECT m.meta_key,d.plugin_id FROM ${table} m JOIN plugin_meta_definitions d ON d.meta_key=m.meta_key AND d.scope=? JOIN plugin_installations p ON p.plugin_id=d.plugin_id WHERE p.status='enabled' AND m.${column}=? AND m.meta_key=?`).bind(scope, entityId, key).first();
    if (!record) throw new Error("Metadato no encontrado o no está activo.");
    return { payload: { operation: input.operation, scope, entityId, key }, summary: { operation: input.operation, target: { scope, entityId, key, pluginId: record.plugin_id }, risk: "irreversible" } };
  }
  if (input.operation === "delete_core_term") {
    if (!positiveId(input.termId)) throw new Error("Término inválido.");
    const term = await env.DB.prepare("SELECT id,type,name,slug FROM taxonomy_terms WHERE id=?").bind(input.termId).first();
    if (!term) throw new Error("Término no encontrado.");
    const references = await env.DB.prepare("SELECT COUNT(*) AS total FROM content_terms WHERE term_id=?").bind(term.id).first("total");
    return { payload: { operation: input.operation, termId: term.id }, summary: { operation: input.operation, target: { ...term, contentReferences: Number(references || 0) }, risk: "irreversible" } };
  }
  if (input.operation === "delete_plugin_term") {
    if (!positiveId(input.termId) || !safePluginId(input.pluginId) || !safePluginId(input.taxonomyId)) throw new Error("Término de plugin inválido.");
    const term = await env.DB.prepare("SELECT t.id,t.name,t.slug,t.parent_id FROM plugin_terms t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.id=? AND t.plugin_id=? AND t.taxonomy_id=?").bind(input.termId, input.pluginId, input.taxonomyId).first();
    if (!term) throw new Error("Término de plugin no encontrado.");
    const references = await env.DB.prepare("SELECT COUNT(*) AS total FROM plugin_content_terms WHERE term_id=?").bind(term.id).first("total");
    return { payload: { operation: input.operation, pluginId: input.pluginId, taxonomyId: input.taxonomyId, termId: term.id }, summary: { operation: input.operation, target: { ...term, pluginId: input.pluginId, taxonomyId: input.taxonomyId, contentReferences: Number(references || 0) }, risk: "irreversible" } };
  }
  if (!safePluginId(input.pluginId)) throw new Error("Plugin desconocido.");
  await ensurePluginReleaseTable(env);
  const installed = await env.DB.prepare("SELECT status,manifest_json FROM plugin_installations WHERE plugin_id=?").bind(input.pluginId).first();
  if (!installed) throw new Error("Plugin no instalado.");
  const policy = JSON.parse(installed.manifest_json || "{}").uninstallPolicy || "preserve-content-purge-plugin-storage";
  return { payload: { operation: input.operation, pluginId: input.pluginId, policy }, summary: { operation: input.operation, target: { id: input.pluginId, status: installed.status, policy }, risk: "irreversible" } };
}

export async function prepareApproval(env, admin, input) {
  const { payload, summary } = await targetFor(env, admin, input);
  const requestId = crypto.randomUUID();
  const executionToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(executionToken));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO approval_requests(id,actor_id,operation,payload_json,summary_json,token_hash,expires_at,state,prepared_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(requestId, admin.id, storedOperation(payload.operation), JSON.stringify(payload), JSON.stringify(summary), tokenHash, expiresAt, "pending", now()).run();
  await event(env, requestId, admin.id, "prepared", { operation: payload.operation, summary });
  return { requestId, operation: payload.operation, risk: "irreversible", expiresAt, summary, executionToken };
}

async function perform(env, record) {
  const payload = JSON.parse(record.payload_json);
  if (payload.operation === "purge_content") {
    const result = await env.DB.prepare("DELETE FROM content_items WHERE id=? AND status='trash'").bind(payload.contentId).run();
    if (!result.meta.changes) throw new Error("El contenido ya no está disponible para purga.");
    return { deleted: "content", id: payload.contentId };
  }
  if (payload.operation === "delete_user") {
    if (payload.userId === record.actor_id) throw new Error("No puedes eliminar la cuenta que autorizó esta operación.");
    await env.DB.prepare("UPDATE plugin_installations SET installed_by=? WHERE installed_by=?").bind(record.actor_id, payload.userId).run();
    const result = await env.DB.prepare("DELETE FROM users WHERE id=?").bind(payload.userId).run();
    if (!result.meta.changes) throw new Error("El usuario ya no existe.");
    return { deleted: "user", id: payload.userId };
  }
  if (payload.operation === "delete_media") {
    await env.MEDIA.delete(`media/${payload.key}`);
    await deleteMediaMetadata(env, `media/${payload.key}`);
    return { deleted: "media", key: payload.key };
  }
  if (payload.operation === "delete_metadata") {
    const table = payload.scope === "content" ? "content_meta" : "user_meta", column = payload.scope === "content" ? "content_id" : "user_id";
    const result = await env.DB.prepare(`DELETE FROM ${table} WHERE ${column}=? AND meta_key=?`).bind(payload.entityId, payload.key).run();
    if (!result.meta.changes) throw new Error("El metadato ya no existe.");
    return { deleted: "metadata", scope: payload.scope, entityId: payload.entityId, key: payload.key };
  }
  if (payload.operation === "delete_core_term") {
    const result = await env.DB.prepare("DELETE FROM taxonomy_terms WHERE id=?").bind(payload.termId).run();
    if (!result.meta.changes) throw new Error("El término ya no existe.");
    return { deleted: "core_term", id: payload.termId };
  }
  if (payload.operation === "delete_plugin_term") {
    const result = await env.DB.prepare("DELETE FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(payload.termId, payload.pluginId, payload.taxonomyId).run();
    if (!result.meta.changes) throw new Error("El término de plugin ya no existe.");
    return { deleted: "plugin_term", id: payload.termId, pluginId: payload.pluginId, taxonomyId: payload.taxonomyId };
  }
  if (payload.operation === "uninstall_plugin") {
    await env.DB.prepare("DELETE FROM plugin_terms WHERE plugin_id=?").bind(payload.pluginId).run();
    await env.DB.prepare("DELETE FROM plugin_active_releases WHERE plugin_id=?").bind(payload.pluginId).run();
    const result = await env.DB.prepare("DELETE FROM plugin_installations WHERE plugin_id=?").bind(payload.pluginId).run();
    if (!result.meta.changes) throw new Error("Plugin ya no está instalado.");
    await env.DB.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(payload.pluginId, "uninstalled", record.actor_id, "{}").run();
    return { deleted: "plugin", id: payload.pluginId, policy: payload.policy || "preserve-content-purge-plugin-storage" };
  }
  throw new Error("Operación irreversible inválida.");
}

export async function executeApproval(env, requestId, executionToken) {
  if (!/^[A-Za-z0-9-]{36}$/.test(String(requestId || "")) || typeof executionToken !== "string" || executionToken.length > 128) return json({ error: "Aprobación inválida." }, 400);
  const tokenHash = bytesToBase64(await sha256(executionToken));
  const record = await env.DB.prepare("SELECT id,actor_id,operation,payload_json,state,expires_at FROM approval_requests WHERE id=? AND token_hash=?").bind(requestId, tokenHash).first();
  if (!record || record.state !== "pending" || Date.parse(record.expires_at) <= Date.now()) return json({ error: "La aprobación no está disponible." }, 409);
  let operation;
  try { operation = JSON.parse(record.payload_json).operation; }
  catch { return json({ error: "La aprobación no está disponible." }, 409); }
  if (!OPERATIONS.has(operation)) return json({ error: "La aprobación no está disponible." }, 409);
  const claimed = await env.DB.prepare("UPDATE approval_requests SET state='executing',executed_at=? WHERE id=? AND token_hash=? AND state='pending' AND julianday(expires_at)>julianday('now')").bind(now(), requestId, tokenHash).run();
  if (!claimed.meta.changes) return json({ error: "La aprobación ya fue consumida o expiró." }, 409);
  await event(env, requestId, record.actor_id, "executing", { operation });
  try {
    const result = await perform(env, record);
    await env.DB.prepare("UPDATE approval_requests SET state='accepted',completed_at=? WHERE id=? AND state='executing'").bind(now(), requestId).run();
    await event(env, requestId, record.actor_id, "accepted", { operation, result });
    return json({ ok: true, requestId, operation, state: "accepted", result });
  } catch {
    const terminal = operation === "delete_media" ? "unknown" : "failed";
    await env.DB.prepare("UPDATE approval_requests SET state=?,completed_at=? WHERE id=? AND state='executing'").bind(terminal, now(), requestId).run();
    await event(env, requestId, record.actor_id, terminal, { operation });
    return json({ error: "La acción no pudo confirmarse; revisa el estado antes de reintentar." }, 409);
  }
}
