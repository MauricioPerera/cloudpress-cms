import { json, requireAdmin } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const result = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM content_items WHERE kind = 'post') AS posts, (SELECT COUNT(*) FROM content_items WHERE kind = 'page') AS pages, (SELECT COUNT(*) FROM content_items WHERE status = 'draft') AS drafts, (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending_comments").first();
  return json(result, 200, { "Cache-Control": "no-store" });
}
