import { json, requireAdmin } from "../../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "comments:moderate")) return json({ error: "Se requiere permiso de moderación" }, 403);
  const status = new URL(request.url).searchParams.get("status");
  if (status && !["pending", "approved"].includes(status)) return json({ error: "Estado inválido" }, 400);
  const query = "SELECT comments.id, comments.content_id, comments.author_name, comments.author_email, comments.body, comments.status, comments.created_at, content_items.title AS content_title FROM comments JOIN content_items ON content_items.id = comments.content_id" + (status ? " WHERE comments.status = ?" : "") + " ORDER BY comments.created_at DESC LIMIT 200";
  const result = status ? await env.DB.prepare(query).bind(status).all() : await env.DB.prepare(query).all();
  return json({ comments: result.results }, 200, { "Cache-Control": "no-store" });
}
