import { json, requireRoleManager } from "../../../_shared.js";
import { CORE_PERMISSIONS, validRoleId, validRoleLabel } from "../../../_roles.js";

function selectedPermissions(value, scope) {
  if (!Array.isArray(value) || value.some((item) => !CORE_PERMISSIONS.includes(item))) return null;
  const permissions = [...new Set(value)];
  // Los roles externos nunca reciben acceso al panel ni pueden administrar roles.
  if (scope === "external" && permissions.length) return null;
  return permissions;
}

async function listRoles(env) {
  const [roles, grants] = await Promise.all([
    env.DB.prepare("SELECT id,label,scope,system,created_at FROM roles ORDER BY scope DESC, label COLLATE NOCASE").all(),
    env.DB.prepare("SELECT role_id,permission FROM role_permissions ORDER BY role_id,permission").all(),
  ]);
  return roles.results.map((role) => ({ ...role, system: Boolean(role.system), permissions: grants.results.filter((grant) => grant.role_id === role.id).map((grant) => grant.permission) }));
}

export async function onRequestGet({ request, env }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  return json({ roles: await listRoles(env), permissions: CORE_PERMISSIONS }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const actor = await requireRoleManager(request, env); if (!actor) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const body = await request.json().catch(() => null);
  const id = String(body?.id || "").trim().toLowerCase();
  const label = String(body?.label || "").trim();
  const scope = body?.scope;
  if (!validRoleId(id) || !validRoleLabel(label) || !["management", "external"].includes(scope) || ["admin", "author", "user"].includes(id)) return json({ error: "Rol inválido. Usa un identificador único de 3 a 48 caracteres." }, 422);
  const permissions = selectedPermissions(body?.permissions, scope);
  if (!permissions) return json({ error: "Los permisos no son válidos para el ámbito elegido." }, 422);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO roles(id,label,scope,system) VALUES(?,?,?,0)").bind(id, label, scope),
      ...permissions.map((permission) => env.DB.prepare("INSERT INTO role_permissions(role_id,permission) VALUES(?,?)").bind(id, permission)),
    ]);
  } catch { return json({ error: "Ya existe un rol con ese identificador." }, 409); }
  return json({ ok: true, role: (await listRoles(env)).find((role) => role.id === id) }, 201);
}
