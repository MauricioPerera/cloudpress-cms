import { json, requireAdmin } from "../../../_shared.js";
import { validatePluginManifest } from "../../../_plugins/contract.js";

export async function onRequestPost({ request, env }) {
  if (!await requireAdmin(request, env, "plugins:manage")) return json({ error: "Se requiere permiso de plugins" }, 403);
  const manifest = await request.json().catch(() => null);
  return json(validatePluginManifest(manifest));
}
