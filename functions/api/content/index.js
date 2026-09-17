import { json } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), kind = url.searchParams.get("kind"), contentType = url.searchParams.get("contentType");
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("pageSize")) || 20));
  if (kind && !["post", "page"].includes(kind)) return json({ error: "Tipo base inválido" }, 400);
  if (kind && contentType) return json({ error: "Usa kind o contentType, no ambos" }, 400);
  let type = null;
  if (contentType) {
    type = String(contentType).trim();
    const publicType = await env.DB.prepare("SELECT 1 FROM core_content_types WHERE type_id=? AND public_api=1 UNION SELECT 1 FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE t.type_id=? AND t.public_api=1 AND p.status='enabled' LIMIT 1").bind(type, type).first();
    if (!publicType) return json({ error: "Tipo no publicado mediante API" }, 404);
  }
  const where = "status = 'published' AND julianday(published_at) <= julianday('now')" + (kind ? " AND kind = ?" : type ? " AND content_type = ?" : "");
  const filter = kind || type;
  const list = env.DB.prepare("SELECT id, kind, content_type, title, slug, excerpt, body, published_at FROM content_items WHERE " + where + " ORDER BY published_at DESC LIMIT ? OFFSET ?");
  const count = env.DB.prepare("SELECT COUNT(*) AS total FROM content_items WHERE " + where);
  const result = filter ? await list.bind(filter, pageSize, (page - 1) * pageSize).all() : await list.bind(pageSize, (page - 1) * pageSize).all();
  const total = filter ? await count.bind(filter).all() : await count.all();
  const items = await Promise.all(result.results.map(async (item) => ({
    ...item,
    terms: (await env.DB.prepare("SELECT taxonomy_terms.id, taxonomy_terms.type, taxonomy_terms.name, taxonomy_terms.slug FROM content_terms JOIN taxonomy_terms ON taxonomy_terms.id = content_terms.term_id WHERE content_id = ? ORDER BY taxonomy_terms.type, taxonomy_terms.name").bind(item.id).all()).results,
  })));
  return json({ page, pageSize, total: total.results[0].total, items }, 200, { "Cache-Control": "public, max-age=60" });
}
