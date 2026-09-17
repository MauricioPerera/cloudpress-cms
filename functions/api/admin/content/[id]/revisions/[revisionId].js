import { json, requireAdmin } from "../../../../../_shared.js";

const snapshot = (db, item) => db.prepare("INSERT INTO content_revisions (content_id, kind, title, slug, excerpt, body, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(item.id, item.kind, item.title, item.slug, item.excerpt, item.body, item.status, item.published_at);

export async function onRequestPost({ request, env, params }) {
  if (!await requireAdmin(request, env, "content:manage")) return json({ error: "Se requiere permiso de contenido" }, 403);
  const contentId = Number(params.id); const revisionId = Number(params.revisionId);
  if (!Number.isInteger(contentId) || contentId < 1 || !Number.isInteger(revisionId) || revisionId < 1) return json({ error: "Solicitud inválida" }, 400);
  const current = await env.DB.prepare("SELECT id, kind, title, slug, excerpt, body, status, published_at FROM content_items WHERE id = ?").bind(contentId).first();
  if (!current) return json({ error: "Contenido no encontrado" }, 404);
  const revision = await env.DB.prepare("SELECT kind, title, slug, excerpt, body, status, published_at FROM content_revisions WHERE id = ? AND content_id = ?").bind(revisionId, contentId).first();
  if (!revision) return json({ error: "Revisión no encontrada" }, 404);
  try {
    await env.DB.batch([snapshot(env.DB, current), env.DB.prepare("UPDATE content_items SET kind=?, title=?, slug=?, excerpt=?, body=?, status=?, published_at=?, updated_at=? WHERE id=?").bind(revision.kind, revision.title, revision.slug, revision.excerpt, revision.body, revision.status, revision.published_at, new Date().toISOString(), contentId)]);
  } catch { return json({ error: "No se pudo restaurar: el slug de esta revisión ya está en uso" }, 409); }
  return json({ ok: true });
}
