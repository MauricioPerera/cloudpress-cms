import { json, requireRoleManager } from "../../../_shared.js";
import { CORE_PERMISSIONS, validRoleLabel } from "../../../_roles.js";

function selectedPermissions(value, scope) {
  if (!Array.isArray(value) || value.some((item) => !CORE_PERMISSIONS.includes(item))) return null;
  const permissions = [...new Set(value)];
  if (scope === "external" && permissions.length) return null;
  return permissions;
}

export async function onRequestPut({ request, env, params }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const id = String(params.id || ""); const existing = await env.DB.prepare("SELECT id,scope,system FROM roles WHERE id=?").bind(id).first();
  if (!existing) return json({ error: "Rol no encontrado" }, 404);
  const body = await request.json().catch(() => null); const label = String(body?.label || "").trim();
  const scope = body?.scope;
  if (!validRoleLabel(label) || !["management", "external"].includes(scope) || (existing.system && scope !== existing.scope)) return json({ error: "No se puede cambiar el ámbito de un rol del sistema." }, 422);
  const permissions = selectedPermissions(body?.permissions, scope);
  if (!permissions) return json({ error: "Los permisos no son válidos para el ámbito elegido." }, 422);
  await env.DB.batch([
    env.DB.prepare("UPDATE roles SET label=?,scope=? WHERE id=?").bind(label, scope, id),
    env.DB.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(id),
    ...permissions.map((permission) => env.DB.prepare("INSERT INTO role_permissions(role_id,permission) VALUES(?,?)").bind(id, permission)),
  ]);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const id = String(params.id || ""); const role = await env.DB.prepare("SELECT system FROM roles WHERE id=?").bind(id).first();
  if (!role) return json({ error: "Rol no encontrado" }, 404);
  if (role.system) return json({ error: "Los roles del sistema no se pueden eliminar." }, 422);
  const inUse = await env.DB.prepare("SELECT 1 FROM users WHERE role=? LIMIT 1").bind(id).first();
  if (inUse) return json({ error: "Asigna otro rol a los usuarios antes de eliminarlo." }, 409);
  await env.DB.prepare("DELETE FROM roles WHERE id=?").bind(id).run();
  return json({ ok: true });
}
