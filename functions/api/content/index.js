import { json } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind && kind !== "post" && kind !== "page") return json({ error: "Tipo inválido" }, 400);
  const query = "SELECT id, kind, title, slug, excerpt, body, published_at FROM content_items WHERE status = 'published' AND julianday(published_at) <= julianday('now')" + (kind ? " AND kind = ?" : "") + " ORDER BY published_at DESC LIMIT 50";
  const result = kind ? await env.DB.prepare(query).bind(kind).all() : await env.DB.prepare(query).all();
  const items = await Promise.all(result.results.map(async (item) => ({
    ...item,
    terms: (await env.DB.prepare("SELECT taxonomy_terms.id, taxonomy_terms.type, taxonomy_terms.name, taxonomy_terms.slug FROM content_terms JOIN taxonomy_terms ON taxonomy_terms.id = content_terms.term_id WHERE content_id = ? ORDER BY taxonomy_terms.type, taxonomy_terms.name").bind(item.id).all()).results,
  })));
  return json({ items });
}
