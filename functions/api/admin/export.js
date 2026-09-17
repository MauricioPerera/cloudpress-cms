import { json, requireAdmin } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "import-export:manage")) return json({ error: "Se requiere permiso de importación y exportación" }, 403);
  const includePersonalData = new URL(request.url).searchParams.get("includePersonalData") === "true";
  if (includePersonalData && !await requireAdmin(request, env, "sensitive:approve")) return json({ error: "Se requiere aprobación sensible para exportar datos personales" }, 403);
  const [content, terms, relations, menu, comments, revisions, settings] = await env.DB.batch([
    env.DB.prepare("SELECT kind,title,slug,excerpt,body,status,trashed_from_status,trashed_at,published_at,created_at,updated_at FROM content_items ORDER BY id"),
    env.DB.prepare("SELECT type,name,slug FROM taxonomy_terms ORDER BY id"),
    env.DB.prepare("SELECT content_items.slug AS content_slug,taxonomy_terms.slug AS term_slug FROM content_terms JOIN content_items ON content_items.id=content_terms.content_id JOIN taxonomy_terms ON taxonomy_terms.id=content_terms.term_id ORDER BY content_terms.content_id"),
    env.DB.prepare("SELECT label,url,position FROM menu_items ORDER BY position,id"),
    env.DB.prepare(`SELECT content_items.slug AS content_slug,comments.author_name,${includePersonalData ? "comments.author_email" : "NULL AS author_email"},comments.body,comments.status,comments.created_at,comments.updated_at FROM comments JOIN content_items ON content_items.id=comments.content_id ORDER BY comments.id`),
    env.DB.prepare("SELECT content_items.slug AS content_slug,content_revisions.kind,content_revisions.title,content_revisions.slug,content_revisions.excerpt,content_revisions.body,content_revisions.status,content_revisions.published_at,content_revisions.created_at FROM content_revisions JOIN content_items ON content_items.id=content_revisions.content_id ORDER BY content_revisions.id"),
    env.DB.prepare("SELECT setting_key,setting_value FROM site_settings ORDER BY setting_key"),
  ]);
  const payload = { format: "cloudpress-export", version: 2, exportedAt: new Date().toISOString(), personalDataIncluded: includePersonalData, content: content.results, terms: terms.results, contentTerms: relations.results, menu: menu.results, comments: comments.results, revisions: revisions.results, settings: settings.results };
  return new Response(JSON.stringify(payload, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="cloudpress-export-${new Date().toISOString().slice(0,10)}.json"`, "Cache-Control": "no-store" } });
}
