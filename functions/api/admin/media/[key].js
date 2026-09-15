import { json, requireAdmin } from "../../../_shared.js";
import { defaultMediaMetadata, deleteMediaMetadata, mediaMetadataByKey, normalizeMediaMetadata, saveMediaMetadata } from "../../../_media.js";

const validName = (name) => Boolean(name) && !name.includes("/") && !name.includes("..");

export async function onRequestGet({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const name = String(params.key || "");
  if (!validName(name)) return json({ error: "Archivo inválido" }, 400);
  const key = `media/${name}`;
  if (!await env.MEDIA.head(key)) return json({ error: "Archivo no encontrado" }, 404);
  const metadata = (await mediaMetadataByKey(env, [key])).get(key);
  return json({ key, name, metadata: { ...defaultMediaMetadata(name), ...metadata } }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPatch({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const name = String(params.key || "");
  if (!validName(name)) return json({ error: "Archivo inválido" }, 400);
  const key = `media/${name}`;
  if (!await env.MEDIA.head(key)) return json({ error: "Archivo no encontrado" }, 404);
  const input = await request.json().catch(() => null);
  try {
    const existing = (await mediaMetadataByKey(env, [key])).get(key);
    const metadata = normalizeMediaMetadata(input, { ...defaultMediaMetadata(name), ...existing });
    await saveMediaMetadata(env, key, metadata);
    return json({ ok: true, key, name, metadata });
  } catch (error) { return json({ error: String(error?.message || "Metadatos inválidos.") }, 400); }
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const name = String(params.key || "");
  if (!validName(name)) return json({ error: "Archivo inválido" }, 400);
  const key = `media/${name}`;
  await env.MEDIA.delete(key);
  await deleteMediaMetadata(env, key);
  return json({ ok: true });
}
