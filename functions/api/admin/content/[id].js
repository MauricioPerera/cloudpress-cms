import { json, requireAdmin, sanitizeHtml } from "../../../_shared.js";

const validKind = (kind) => kind === "post" || kind === "page";
const validStatus = (status) => status === "draft" || status === "published";
const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
const snapshot = (db, item) => db.prepare("INSERT INTO content_revisions (content_id, kind, title, slug, excerpt, body, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(item.id, item.kind, item.title, item.slug, item.excerpt, item.body, item.status, item.published_at);

export async function onRequestPatch({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(id) || id < 1 || !body) return json({ error: "Solicitud inválida" }, 400);
  const current = await env.DB.prepare("SELECT id, kind, title, slug, excerpt, body, status, published_at FROM content_items WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Contenido no encontrado" }, 404);
  if (current.status === "trash") return json({ error: "Restaura el contenido antes de editarlo" }, 409);
  const updates = []; const values = [];
  if (body.kind !== undefined) { if (!validKind(body.kind)) return json({ error: "Tipo inválido" }, 400); updates.push("kind = ?"); values.push(body.kind); }
  if (body.title !== undefined) { const title = String(body.title).trim().slice(0, 180); if (!title) return json({ error: "El título es obligatorio" }, 400); updates.push("title = ?"); values.push(title); }
  if (body.slug !== undefined) { const slug = slugify(body.slug); if (!slug) return json({ error: "Slug inválido" }, 400); updates.push("slug = ?"); values.push(slug); }
  if (body.excerpt !== undefined) { updates.push("excerpt = ?"); values.push(String(body.excerpt).slice(0, 500)); }
  if (body.body !== undefined) { updates.push("body = ?"); values.push(sanitizeHtml(String(body.body)).slice(0, 50000)); }
  if (body.status !== undefined) { if (!validStatus(body.status)) return json({ error: "Estado inválido" }, 400); updates.push("status = ?"); values.push(body.status); if (body.status === "published" && !current.published_at) { updates.push("published_at = ?"); values.push(new Date().toISOString()); } }
  const hasTerms = Array.isArray(body.termIds);
  if (!updates.length && !hasTerms) return json({ error: "No hay cambios válidos" }, 400);
  if (!updates.length && hasTerms) { await env.DB.prepare("DELETE FROM content_terms WHERE content_id=?").bind(id).run(); const ids=[...new Set(body.termIds.map(Number).filter(Number.isInteger))]; if(ids.length) await env.DB.batch(ids.map(termId=>env.DB.prepare("INSERT OR IGNORE INTO content_terms(content_id,term_id) SELECT ?,id FROM taxonomy_terms WHERE id=?").bind(id,termId))); return json({ok:true}); }
  updates.push("updated_at = ?"); values.push(new Date().toISOString(), id);
  try { await env.DB.batch([snapshot(env.DB, current), env.DB.prepare(`UPDATE content_items SET ${updates.join(", ")} WHERE id = ?`).bind(...values)]); }
  catch { return json({ error: "No se pudo guardar la revisión; revisa que el slug sea único" }, 409); }
  if (hasTerms) { await env.DB.prepare("DELETE FROM content_terms WHERE content_id=?").bind(id).run(); const ids=[...new Set(body.termIds.map(Number).filter(Number.isInteger))]; if(ids.length) await env.DB.batch(ids.map(termId=>env.DB.prepare("INSERT OR IGNORE INTO content_terms(content_id,term_id) SELECT ?,id FROM taxonomy_terms WHERE id=?").bind(id,termId))); }
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: "Solicitud inválida" }, 400);
  const current = await env.DB.prepare("SELECT id, kind, title, slug, excerpt, body, status, published_at FROM content_items WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Contenido no encontrado" }, 404);
  if (current.status === "trash") return json({ error: "El contenido ya está en la papelera" }, 409);
  const now = new Date().toISOString();
  await env.DB.batch([snapshot(env.DB, current), env.DB.prepare("UPDATE content_items SET status='trash', trashed_from_status=?, trashed_at=?, updated_at=? WHERE id=?").bind(current.status, now, now, id)]);
  return json({ ok: true, trashed: true });
}
