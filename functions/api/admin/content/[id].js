import { json, requireAdmin, sanitizeHtml } from "../../../_shared.js";
import { runPluginHook } from "../../../_plugins/runtime.js";
import { renderBlocksDocument, replaceBlocksDocument } from "../../../_blocks.js";

const validKind = (kind) => kind === "post" || kind === "page";
const validStatus = (status) => status === "draft" || status === "published";
const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
const snapshot = (db, item) => db.prepare("INSERT INTO content_revisions (content_id, kind, title, slug, excerpt, body, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(item.id, item.kind, item.title, item.slug, item.excerpt, item.body, item.status, item.published_at);
const hookContent = (item, authorId) => ({ id: item.id, kind: item.kind, contentType: item.content_type, title: item.title, slug: item.slug, excerpt: item.excerpt, body: item.body, status: item.status, authorId });

async function proposedContent(env, current, body) {
  const proposed = { kind: current.kind, contentType: current.content_type, title: current.title, slug: current.slug, excerpt: current.excerpt, body: current.body, status: current.status };
  if (body.kind !== undefined) { if (!validKind(body.kind)) throw new Error("Tipo inválido"); proposed.kind = body.kind; }
  if (body.contentType !== undefined) {
    const contentType = String(body.contentType);
    if (!["post", "page"].includes(contentType)) {
      const type = await env.DB.prepare("SELECT 1 FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.type_id=?").bind(contentType).first();
      if (!type) throw new Error("Tipo de entrada no declarado por un plugin activo");
    }
    proposed.contentType = contentType;
  }
  if (body.title !== undefined) { proposed.title = String(body.title).trim().slice(0, 180); if (!proposed.title) throw new Error("El título es obligatorio"); }
  if (body.slug !== undefined) { proposed.slug = slugify(body.slug); if (!proposed.slug) throw new Error("Slug inválido"); }
  if (body.excerpt !== undefined) proposed.excerpt = String(body.excerpt).slice(0, 500);
  if (body.body !== undefined) proposed.body = sanitizeHtml(String(body.body)).slice(0, 50000);
  if (body.status !== undefined) { if (!validStatus(body.status)) throw new Error("Estado inválido"); proposed.status = body.status; }
  return proposed;
}

function applyPatch(proposed, patch) {
  const next = { ...proposed, ...patch };
  if (!next.title.trim()) throw new Error("El plugin devolvió un título inválido");
  if (!slugify(next.slug)) throw new Error("El plugin devolvió un slug inválido");
  if (!validStatus(next.status)) throw new Error("El plugin devolvió un estado inválido");
  return { ...next, title: next.title.trim().slice(0, 180), slug: slugify(next.slug), excerpt: String(next.excerpt).slice(0, 500), body: sanitizeHtml(String(next.body)).slice(0, 50000) };
}

async function replaceTerms(env, contentId, body) {
  if (Array.isArray(body.termIds)) { await env.DB.prepare("DELETE FROM content_terms WHERE content_id=?").bind(contentId).run(); const ids = [...new Set(body.termIds.map(Number).filter(Number.isInteger))]; if (ids.length) await env.DB.batch(ids.map((termId) => env.DB.prepare("INSERT OR IGNORE INTO content_terms(content_id,term_id) SELECT ?,id FROM taxonomy_terms WHERE id=?").bind(contentId, termId))); }
  if (Array.isArray(body.pluginTermIds)) { await env.DB.prepare("DELETE FROM plugin_content_terms WHERE content_id=?").bind(contentId).run(); const ids = [...new Set(body.pluginTermIds.map(Number).filter(Number.isInteger))]; if (ids.length) await env.DB.batch(ids.map((termId) => env.DB.prepare("INSERT OR IGNORE INTO plugin_content_terms(content_id,term_id) SELECT ?,plugin_terms.id FROM plugin_terms JOIN plugin_installations ON plugin_installations.plugin_id=plugin_terms.plugin_id WHERE plugin_terms.id=? AND plugin_installations.status='enabled'").bind(contentId, termId))); }
}

export async function onRequestPatch({ request, env, params }) {
  const admin = await requireAdmin(request, env); if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(id) || id < 1 || !body) return json({ error: "Solicitud inválida" }, 400);
  const current = await env.DB.prepare("SELECT id, kind, content_type, title, slug, excerpt, body, status, published_at FROM content_items WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Contenido no encontrado" }, 404);
  if (current.status === "trash") return json({ error: "Restaura el contenido antes de editarlo" }, 409);
  let renderedBlocks = null;
  try { if (body.blocks !== undefined) renderedBlocks = await renderBlocksDocument(env, body.blocks); }
  catch (error) { return json({ error: error.message || "Documento de bloques inválido" }, 422); }
  const effectiveBody = renderedBlocks ? { ...body, body: renderedBlocks.html } : body;
  let proposed;
  try { proposed = await proposedContent(env, current, effectiveBody); }
  catch (error) { return json({ error: error.message }, error.message.includes("declarado") ? 422 : 400); }
  const before = await runPluginHook(env, "content.beforeUpdate", { ...hookContent(current, admin.id), ...proposed });
  if (!before.allowed) return json({ error: before.error }, 422);
  if (renderedBlocks && before.patch.body !== undefined && before.patch.body !== renderedBlocks.html) return json({ error: "Un plugin no puede transformar HTML directamente cuando el contenido usa bloques." }, 422);
  let next;
  try { next = applyPatch(proposed, before.patch); }
  catch (error) { return json({ error: error.message }, 422); }
  const fields = [["kind", "kind"], ["contentType", "content_type"], ["title", "title"], ["slug", "slug"], ["excerpt", "excerpt"], ["body", "body"], ["status", "status"]];
  const updates = []; const values = [];
  for (const [key, column] of fields) if (next[key] !== (key === "contentType" ? current.content_type : current[key])) { updates.push(`${column} = ?`); values.push(next[key]); }
  if (next.status === "published" && !current.published_at) { updates.push("published_at = ?"); values.push(new Date().toISOString()); }
  const hasTerms = Array.isArray(body.termIds), hasPluginTerms = Array.isArray(body.pluginTermIds), hasBlockChange = body.blocks !== undefined, hasRawBodyChange = body.blocks === undefined && body.body !== undefined;
  if (!updates.length && !hasTerms && !hasPluginTerms && !hasBlockChange && !hasRawBodyChange) return json({ error: "No hay cambios válidos" }, 400);
  if (updates.length) {
    updates.push("updated_at = ?"); values.push(new Date().toISOString(), id);
    try { await env.DB.batch([snapshot(env.DB, current), env.DB.prepare(`UPDATE content_items SET ${updates.join(", ")} WHERE id = ?`).bind(...values)]); }
    catch { return json({ error: "No se pudo guardar la revisión; revisa que el slug sea único" }, 409); }
  }
  await replaceTerms(env, id, body);
  if (hasBlockChange) await replaceBlocksDocument(env, id, renderedBlocks.document);
  else if (hasRawBodyChange) await replaceBlocksDocument(env, id, null);
  const persisted = await env.DB.prepare("SELECT id, kind, content_type, title, slug, excerpt, body, status FROM content_items WHERE id=?").bind(id).first();
  await runPluginHook(env, "content.afterUpdate", hookContent(persisted, admin.id));
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const admin = await requireAdmin(request, env); if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: "Solicitud inválida" }, 400);
  const current = await env.DB.prepare("SELECT id, kind, content_type, title, slug, excerpt, body, status, published_at FROM content_items WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Contenido no encontrado" }, 404);
  if (current.status === "trash") return json({ error: "El contenido ya está en la papelera" }, 409);
  const before = await runPluginHook(env, "content.beforeTrash", hookContent(current, admin.id));
  if (!before.allowed) return json({ error: before.error }, 422);
  const now = new Date().toISOString();
  await env.DB.batch([snapshot(env.DB, current), env.DB.prepare("UPDATE content_items SET status='trash', trashed_from_status=?, trashed_at=?, updated_at=? WHERE id=?").bind(current.status, now, now, id)]);
  await runPluginHook(env, "content.afterTrash", { ...hookContent(current, admin.id), status: "trash" });
  return json({ ok: true, trashed: true });
}
