import { json, requireAdmin } from "../../../../_shared.js";

// The only user mutation intentionally exposed to an agent capability.
// Role, password and identity changes remain browser-only admin operations.
export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env, "users:manage");
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(id) || id < 1 || typeof body?.active !== "boolean") return json({ error: "Solicitud inválida" }, 400);
  if (id === admin.id && body.active === false) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
  const result = await env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(body.active ? 1 : 0, id).run();
  if (!result.meta.changes) return json({ error: "Usuario no encontrado" }, 404);
  if (!body.active) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
  return json({ ok: true, id, active: body.active });
}
