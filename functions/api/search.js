import { json } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page")) || 1));
  if (query.length < 2) return json({ error: "Introduce al menos 2 caracteres" }, 400);
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const offset = (page - 1) * 10;
  const where = "status = 'published' AND julianday(published_at) <= julianday('now') AND (title LIKE ? ESCAPE '\\' OR excerpt LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')";
  const [items, total] = await env.DB.batch([
    env.DB.prepare("SELECT id, kind, title, slug, excerpt, published_at FROM content_items WHERE " + where + " ORDER BY published_at DESC LIMIT 10 OFFSET ?").bind(pattern, pattern, pattern, offset),
    env.DB.prepare("SELECT COUNT(*) AS total FROM content_items WHERE " + where).bind(pattern, pattern, pattern),
  ]);
  return json({ query, page, total: total.results[0].total, items: items.results }, 200, { "Cache-Control": "public, max-age=60" });
}
