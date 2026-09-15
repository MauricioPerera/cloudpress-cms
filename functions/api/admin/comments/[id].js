import { json, requireAdmin } from "../../../_shared.js";

const idOf = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export async function onRequestPatch({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = idOf(params.id);
  const body = await request.json().catch(() => null);
  if (!id || body?.status !== "approved") return json({ error: "Actualización inválida" }, 400);
  const updated = await env.DB.prepare("UPDATE comments SET status = 'approved', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  return updated.meta.changes ? json({ ok: true }) : json({ error: "Comentario no encontrado" }, 404);
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = idOf(params.id);
  if (!id) return json({ error: "ID inválido" }, 400);
  const deleted = await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return deleted.meta.changes ? json({ ok: true }) : json({ error: "Comentario no encontrado" }, 404);
}
