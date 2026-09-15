import { json, requireAdmin } from "../../../_shared.js";
import { validatePluginManifest } from "../../../_plugins/contract.js";

export async function onRequestPost({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const manifest = await request.json().catch(() => null);
  return json(validatePluginManifest(manifest));
}
