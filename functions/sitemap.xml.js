const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const items = await env.DB.prepare("SELECT kind, slug, updated_at, published_at FROM content_items WHERE status = 'published' AND julianday(published_at) <= julianday('now') ORDER BY published_at DESC LIMIT 5000").all();
  const urls = [`<url><loc>${escapeXml(origin + "/")}</loc></url>`];
  for (const item of items.results) {
    const loc = `${origin}/contenido?kind=${encodeURIComponent(item.kind)}&slug=${encodeURIComponent(item.slug)}`;
    const lastmod = item.updated_at || item.published_at;
    urls.push(`<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(new Date(lastmod).toISOString().slice(0, 10))}</lastmod>` : ""}</url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
