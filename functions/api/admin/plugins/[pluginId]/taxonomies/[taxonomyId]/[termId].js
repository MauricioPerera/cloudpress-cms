import { json, requireAdmin } from "../../../../../../_shared.js";

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.termId), pluginId = String(params.pluginId || ""), taxonomyId = String(params.taxonomyId || "");
  if (!Number.isInteger(id) || id < 1) return json({ error: "Término inválido." }, 400);
  const result = await env.DB.prepare("DELETE FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(id, pluginId, taxonomyId).run();
  if (!result.meta.changes) return json({ error: "Término no encontrado." }, 404);
  return json({ ok: true, removed: true });
}
