import { json, requireAdmin, sanitizeHtml } from "../../../_shared.js";
import { runPluginHook } from "../../../_plugins/runtime.js";

const validKind = (kind) => kind === "post" || kind === "page";
const validStatus = (status) => status === "draft" || status === "published";
const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const url = new URL(request.url); const kind = url.searchParams.get("kind"); const status = url.searchParams.get("status");
  if (kind && !validKind(kind)) return json({ error: "Tipo inválido" }, 400);
  if (status && status !== "trash") return json({ error: "Estado inválido" }, 400);
  const filters = []; const values = [];
  if (kind) { filters.push("content_items.kind = ?"); values.push(kind); }
  filters.push(status === "trash" ? "content_items.status = 'trash'" : "content_items.status != 'trash'");
  const query = "SELECT content_items.id, content_items.kind, content_items.title, content_items.slug, content_items.excerpt, content_items.body, content_items.status, content_items.trashed_from_status, content_items.trashed_at, content_items.created_at, content_items.updated_at, content_items.published_at, users.username AS author FROM content_items JOIN users ON users.id = content_items.author_id WHERE " + filters.join(" AND ") + " ORDER BY content_items.updated_at DESC LIMIT 200";
  const result = values.length ? await env.DB.prepare(query).bind(...values).all() : await env.DB.prepare(query).all();
  const items = await Promise.all(result.results.map(async (item) => ({
    ...item,
    updated_at: String(item.updated_at || "").replace(/Z$/, ""),
    terms: (await env.DB.prepare("SELECT taxonomy_terms.id, taxonomy_terms.type, taxonomy_terms.name, taxonomy_terms.slug FROM content_terms JOIN taxonomy_terms ON taxonomy_terms.id = content_terms.term_id WHERE content_id = ? ORDER BY taxonomy_terms.type, taxonomy_terms.name").bind(item.id).all()).results,
  })));
  return json({ items }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const body = await request.json().catch(() => null);
  let kind = body?.kind;
  let contentType = String(body?.contentType || kind || "");
  let title = String(body?.title || "").trim().slice(0, 180);
  let slug = slugify(body?.slug || title);
  let status = body?.status || "draft";
  if (!validKind(kind) || !title || !slug || !validStatus(status)) return json({ error: "Datos de contenido inválidos" }, 400);
  if (contentType !== "post" && contentType !== "page") {
    const type = await env.DB.prepare("SELECT 1 FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.type_id=?").bind(contentType).first();
    if (!type) return json({ error: "Tipo de entrada no declarado por un plugin activo" }, 422);
  }
  const plugin = await runPluginHook(env, "content.beforeCreate", { kind, contentType, title, slug, status, excerpt: String(body?.excerpt || ""), body: String(body?.body || ""), authorId: admin.id });
  if (!plugin.allowed) return json({ error: plugin.error }, 422);
  const transformed = { ...body, ...plugin.patch };
  kind = transformed.kind;
  title = String(transformed.title || "").trim().slice(0, 180);
  slug = slugify(transformed.slug || title);
  status = transformed.status || "draft";
  if (!validKind(kind) || !title || !slug || !validStatus(status)) return json({ error: "El plugin generó contenido inválido" }, 422);
  contentType = String(transformed.contentType || contentType);
  const now = new Date().toISOString();
  const scheduledAt = body?.publishedAt ? new Date(body.publishedAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return json({ error: "Fecha de publicación inválida" }, 400);
  try {
    const result = await env.DB.prepare("INSERT INTO content_items (kind, content_type, title, slug, excerpt, body, status, author_id, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(kind, contentType, title, slug, String(transformed.excerpt || "").slice(0, 500), sanitizeHtml(String(transformed.body || "")).slice(0, 50000), status, admin.id, now, status === "published" ? (scheduledAt ? scheduledAt.toISOString() : now) : null).run();
    const ids=[...new Set((Array.isArray(body?.termIds)?body.termIds:[]).map(Number).filter(Number.isInteger))];
    if(ids.length) await env.DB.batch(ids.map(id=>env.DB.prepare("INSERT OR IGNORE INTO content_terms(content_id,term_id) SELECT ?,id FROM taxonomy_terms WHERE id=?").bind(result.meta.last_row_id,id)));
    await runPluginHook(env, "content.afterCreate", { id: result.meta.last_row_id, kind, title, slug, status, excerpt: String(transformed.excerpt || ""), body: String(transformed.body || ""), authorId: admin.id });
    return json({ ok: true, id: result.meta.last_row_id }, 201);
  } catch { return json({ error: "El slug ya está en uso" }, 409); }
}
