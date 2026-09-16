import { json, requireAdmin } from "../../_shared.js";
import { defaultMediaMetadata, normalizeMediaMetadata, saveMediaMetadata } from "../../_media.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX = 10 * 1024 * 1024;
const safeName = (name) => String(name || "imagen").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const input = await request.json().catch(() => null);
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(input?.dataUrl || ""));
  if (!match || !TYPES.has(match[1])) return json({ error: "Imagen inválida" }, 400);
  let bytes; try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch { return json({ error: "Imagen inválida" }, 400); }
  if (!bytes.length || bytes.length > MAX) return json({ error: "La imagen supera el límite de 10 MB" }, 413);
  const name = safeName(input.filename);
  let metadata; try { metadata = normalizeMediaMetadata(input.metadata, defaultMediaMetadata(name)); } catch (error) { return json({ error: String(error.message) }, 400); }
  const key = `media/${crypto.randomUUID()}-${name}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: match[1], cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploadedBy: String(admin.id), originalName: name } });
  try { await saveMediaMetadata(env, key, metadata); } catch { await env.MEDIA.delete(key); return json({ error: "No se pudieron guardar los metadatos de la imagen." }, 500); }
  return json({ ok: true, key, url: `/media/${encodeURIComponent(key.slice(6))}`, metadata }, 201);
}
