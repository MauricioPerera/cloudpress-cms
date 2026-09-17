import { json, requireAdmin } from "../../../_shared.js";

const idOf = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export async function onRequestPatch({ request, env, params }) {
  const admin = await requireAdmin(request, env, "comments:moderate"); if (!admin) return json({ error: "Se requiere permiso de moderación" }, 403);
  const id = idOf(params.id);
  const body = await request.json().catch(() => null);
  if (!id || body?.status !== "approved") return json({ error: "Actualización inválida" }, 400);
  const updated = await env.DB.prepare("UPDATE comments SET status = 'approved', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  if (!updated.meta.changes) return json({ error: "Comentario no encontrado" }, 404);
  await env.DB.prepare("INSERT INTO comment_moderation_events(comment_id,actor_id,action) VALUES(?,?,?)").bind(id, admin.id, "approved").run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const admin = await requireAdmin(request, env, "comments:moderate"); if (!admin) return json({ error: "Se requiere permiso de moderación" }, 403);
  const id = idOf(params.id);
  if (!id) return json({ error: "ID inválido" }, 400);
  const deleted = await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  if (!deleted.meta.changes) return json({ error: "Comentario no encontrado" }, 404);
  await env.DB.prepare("INSERT INTO comment_moderation_events(comment_id,actor_id,action) VALUES(?,?,?)").bind(id, admin.id, "deleted").run();
  return json({ ok: true });
}
