import { json, requireAdmin } from "../../../_shared.js";

export async function onRequestPost({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: "Solicitud inválida" }, 400);
  const item = await env.DB.prepare("SELECT status, trashed_from_status FROM content_items WHERE id=?").bind(id).first();
  if (!item) return json({ error: "Contenido no encontrado" }, 404);
  if (item.status !== "trash") return json({ error: "El contenido no está en la papelera" }, 409);
  const status = item.trashed_from_status === "published" ? "published" : "draft";
  await env.DB.prepare("UPDATE content_items SET status=?, trashed_from_status=NULL, trashed_at=NULL, updated_at=? WHERE id=?").bind(status, new Date().toISOString(), id).run();
  return json({ ok: true, status });
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: "Solicitud inválida" }, 400);
  const result = await env.DB.prepare("DELETE FROM content_items WHERE id=? AND status='trash'").bind(id).run();
  return result.meta.changes ? json({ ok: true, deleted: true }) : json({ error: "Contenido no encontrado en la papelera" }, 404);
}
