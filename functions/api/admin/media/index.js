import { json, requireAdmin } from "../../../_shared.js";
import { defaultMediaMetadata, mediaMetadataByKey, normalizeMediaMetadata, saveMediaMetadata } from "../../../_media.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const safeName = (name) => String(name || "imagen").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "media:manage")) return json({ error: "Se requiere permiso de medios" }, 403);
  const url = new URL(request.url); const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase(); const contentType = url.searchParams.get("contentType") || "";
  if (query.length > 120) return json({ error: "La búsqueda es demasiado larga" }, 400);
  if (contentType && !TYPES.has(contentType)) return json({ error: "Tipo MIME no permitido" }, 400);
  const listed = await env.MEDIA.list({ prefix: "media/", limit: 500 });
  const byKey = await mediaMetadataByKey(env, listed.objects.map((object) => object.key));
  const items = listed.objects.map((object) => {
    const name = object.key.slice(6);
    return { key: object.key, name, size: object.size, uploaded: object.uploaded, contentType: object.httpMetadata?.contentType || "application/octet-stream", url: `/media/${encodeURIComponent(name)}`, metadata: { ...defaultMediaMetadata(name), ...byKey.get(object.key) } };
  }).filter((item) => (!contentType || item.contentType === contentType) && (!query || [item.name, item.contentType, item.metadata.title, item.metadata.altText, item.metadata.caption, item.metadata.creator, item.metadata.license].some((value) => String(value || "").toLocaleLowerCase().includes(query))));
  return json({ items, total: items.length, filtered: Boolean(query || contentType) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env, "media:manage");
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return json({ error: "Selecciona un archivo" }, 400);
  if (!TYPES.has(file.type)) return json({ error: "Solo se permiten JPG, PNG, GIF o WebP" }, 415);
  if (file.size > MAX_BYTES) return json({ error: "La imagen supera el límite de 10 MB" }, 413);
  const key = `media/${crypto.randomUUID()}-${safeName(file.name)}`;
  let suppliedMetadata = {};
  const rawMetadata = form.get("metadata");
  if (rawMetadata !== null) {
    try { suppliedMetadata = JSON.parse(String(rawMetadata)); }
    catch { return json({ error: "Los metadatos deben ser JSON válido." }, 400); }
  }
  let metadata;
  try { metadata = normalizeMediaMetadata(suppliedMetadata, defaultMediaMetadata(file.name)); }
  catch (error) { return json({ error: String(error?.message || "Metadatos inválidos.") }, 400); }
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploadedBy: String(admin.id), originalName: safeName(file.name) } });
  try { await saveMediaMetadata(env, key, metadata); }
  catch {
    await env.MEDIA.delete(key);
    return json({ error: "No se pudieron guardar los metadatos de la imagen." }, 500);
  }
  return json({ ok: true, key, url: `/media/${encodeURIComponent(key.slice(6))}`, metadata }, 201);
}
