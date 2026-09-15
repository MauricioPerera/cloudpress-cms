import { json, requireAdmin } from "../../../../../_shared.js";

export async function onRequestGet({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const contentId = Number(params.id);
  if (!Number.isInteger(contentId) || contentId < 1) return json({ error: "Solicitud inválida" }, 400);
  const exists = await env.DB.prepare("SELECT id FROM content_items WHERE id = ?").bind(contentId).first();
  if (!exists) return json({ error: "Contenido no encontrado" }, 404);
  const revisions = await env.DB.prepare("SELECT id, content_id, kind, title, slug, excerpt, body, status, published_at, created_at FROM content_revisions WHERE content_id = ? ORDER BY id DESC LIMIT 100").bind(contentId).all();
  return json({ revisions: revisions.results }, 200, { "Cache-Control": "no-store" });
}
