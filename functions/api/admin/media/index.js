import { json, requireAdmin } from "../../../_shared.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const safeName = (name) => String(name || "imagen").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const listed = await env.MEDIA.list({ prefix: "media/", limit: 500 });
  return json({ items: listed.objects.map((object) => ({ key: object.key, name: object.key.slice(6), size: object.size, uploaded: object.uploaded, contentType: object.httpMetadata?.contentType || "application/octet-stream", url: `/media/${encodeURIComponent(object.key.slice(6))}` })) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return json({ error: "Selecciona un archivo" }, 400);
  if (!TYPES.has(file.type)) return json({ error: "Solo se permiten JPG, PNG, GIF o WebP" }, 415);
  if (file.size > MAX_BYTES) return json({ error: "La imagen supera el límite de 10 MB" }, 413);
  const key = `media/${crypto.randomUUID()}-${safeName(file.name)}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploadedBy: String(admin.id), originalName: safeName(file.name) } });
  return json({ ok: true, key, url: `/media/${encodeURIComponent(key.slice(6))}` }, 201);
}
