import { bytesToBase64, json, sha256, validEmail } from "../../_shared.js";

const contentId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), id = contentId(url.searchParams.get("contentId"));
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize")) || 20));
  if (!id) return json({ error: "Contenido inválido" }, 400);
  const comments = await env.DB.prepare("SELECT id, author_name, body, created_at FROM comments WHERE content_id = ? AND status = 'approved' ORDER BY created_at ASC LIMIT ? OFFSET ?").bind(id, pageSize, (page - 1) * pageSize).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS total FROM comments WHERE content_id = ? AND status = 'approved'").bind(id).all();
  return json({ page, pageSize, total: total.results[0].total, comments: comments.results }, 200, { "Cache-Control": "public, max-age=60" });
}

export async function onRequestPost({ request, env }) {
  const input = await request.json().catch(() => null);
  const id = contentId(input?.contentId);
  const author = String(input?.author || "").trim().slice(0, 80);
  const email = String(input?.email || "").trim().toLowerCase();
  const body = String(input?.body || "").trim().slice(0, 2000);
  if (input?.website) return json({ ok: true }, 201);
  if (!id || author.length < 2 || body.length < 2 || (email && !validEmail(email))) return json({ error: "Datos de comentario inválidos" }, 400);
  const content = await env.DB.prepare("SELECT id FROM content_items WHERE id = ? AND kind = 'post' AND status = 'published' AND julianday(published_at) <= julianday('now')").bind(id).first();
  if (!content) return json({ error: "La entrada no admite comentarios" }, 404);
  const client = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const fingerprint = bytesToBase64(await sha256(client));
  const previous = await env.DB.prepare("SELECT last_created_at FROM comment_rate_limits WHERE fingerprint = ?").bind(fingerprint).first();
  if (previous && Date.now() - Date.parse(previous.last_created_at) < 5 * 60 * 1000) return json({ error: "Espera cinco minutos antes de enviar otro comentario" }, 429, { "Retry-After": "300" });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments(content_id, author_name, author_email, body, status, created_at, updated_at) VALUES(?, ?, ?, ?, 'pending', ?, ?)").bind(id, author, email || null, body, now, now),
    env.DB.prepare("INSERT INTO comment_rate_limits(fingerprint,last_created_at) VALUES(?,?) ON CONFLICT(fingerprint) DO UPDATE SET last_created_at=excluded.last_created_at").bind(fingerprint, now),
  ]);
  return json({ ok: true, message: "Comentario recibido y pendiente de moderación" }, 201);
}
