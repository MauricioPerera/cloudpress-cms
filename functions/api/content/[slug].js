import { json } from "../../_shared.js";

export async function onRequestGet({ request, env, params }) {
  const slug = String(params.slug || "").trim();
  const kind = new URL(request.url).searchParams.get("kind");
  if (!slug || (kind && kind !== "post" && kind !== "page")) return json({ error: "Solicitud inválida" }, 400);
  const query = "SELECT id, kind, title, slug, excerpt, body, published_at FROM content_items WHERE slug = ? AND status = 'published' AND julianday(published_at) <= julianday('now')" + (kind ? " AND kind = ?" : "");
  const item = kind ? await env.DB.prepare(query).bind(slug, kind).first() : await env.DB.prepare(query).bind(slug).first();
  if (!item) return json({ error: "Contenido no encontrado" }, 404);
  const terms = await env.DB.prepare("SELECT taxonomy_terms.id, taxonomy_terms.type, taxonomy_terms.name, taxonomy_terms.slug FROM content_terms JOIN taxonomy_terms ON taxonomy_terms.id = content_terms.term_id WHERE content_id = ? ORDER BY taxonomy_terms.type, taxonomy_terms.name").bind(item.id).all();
  return json({ item: { ...item, terms: terms.results } }, 200, { "Cache-Control": "public, max-age=300" });
}
