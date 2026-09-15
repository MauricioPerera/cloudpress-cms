import { json, requireAuthor, sanitizeHtml } from "../../../_shared.js";

const validKind = kind => kind === "post" || kind === "page";
const validStatus = status => status === "draft" || status === "published";
const slugify = value => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);

export async function onRequestGet({ request, env }) {
  const author = await requireAuthor(request, env);
  if (!author) return json({ error: "Se requiere rol autor" }, 403);
  const url = new URL(request.url), kind = url.searchParams.get("kind"), status = url.searchParams.get("status");
  if (kind && !validKind(kind)) return json({ error: "Tipo inválido" }, 400);
  if (status && status !== "trash") return json({ error: "Estado inválido" }, 400);
  const filters = ["author_id=?", status === "trash" ? "status='trash'" : "status!='trash'"], values = [author.id];
  if (kind) { filters.push("kind=?"); values.push(kind); }
  const result = await env.DB.prepare("SELECT id,kind,title,slug,excerpt,body,status,trashed_from_status,trashed_at,created_at,updated_at,published_at FROM content_items WHERE " + filters.join(" AND ") + " ORDER BY updated_at DESC LIMIT 200").bind(...values).all();
  return json({ items: result.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const author = await requireAuthor(request, env);
  if (!author) return json({ error: "Se requiere rol autor" }, 403);
  const body = await request.json().catch(() => null), kind = body?.kind, title = String(body?.title || "").trim().slice(0, 180), slug = slugify(body?.slug || title), status = body?.status || "draft";
  if (!validKind(kind) || !title || !slug || !validStatus(status)) return json({ error: "Datos de contenido inválidos" }, 400);
  const now = new Date().toISOString();
  try { const r = await env.DB.prepare("INSERT INTO content_items(kind,title,slug,excerpt,body,status,author_id,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(kind, title, slug, String(body?.excerpt || "").slice(0, 500), sanitizeHtml(String(body?.body || "")).slice(0, 50000), status, author.id, now, status === "published" ? now : null).run(); return json({ ok: true, id: r.meta.last_row_id }, 201); }
  catch { return json({ error: "El slug ya está en uso" }, 409); }
}
