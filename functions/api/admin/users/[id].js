import { bytesToBase64, json, normalizeEmail, pbkdf2, requireRoleManager, validEmail } from "../../../_shared.js";
import { roleExists } from "../../../_roles.js";

function validUsername(value) {
  return /^[a-z0-9_.-]{3,40}$/.test(String(value || "").trim().toLowerCase());
}

export async function onRequestPatch({ request, env, params }) {
  const admin = await requireRoleManager(request, env);
  if (!admin) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(id) || id < 1 || !body) return json({ error: "Solicitud inválida" }, 400);
  if (id === admin.id && body.active === false) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);

  const updates = [];
  const values = [];
  if (body.username !== undefined) {
    const username = String(body.username).trim().toLowerCase();
    if (!validUsername(username)) return json({ error: "Nombre de usuario inválido" }, 400);
    updates.push("username = ?"); values.push(username);
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (email && !validEmail(email)) return json({ error: "Correo inválido" }, 400);
    updates.push("email = ?"); values.push(email || null);
  }
  if (typeof body.active === "boolean") { updates.push("active = ?"); values.push(body.active ? 1 : 0); }
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!await roleExists(env, role)) return json({ error: "El rol seleccionado no existe." }, 422);
    if (id === admin.id && role !== "admin") return json({ error: "No puedes quitar el rol admin a tu propia cuenta" }, 400);
    updates.push("role = ?"); values.push(role);
  }
  let passwordChanged = false;
  if (body.password !== undefined && String(body.password).length > 0) {
    if (String(body.password).length < 10) return json({ error: "La contraseña debe tener al menos 10 caracteres" }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(String(body.password), salt);
    updates.push("password_hash = ?", "password_salt = ?"); values.push(bytesToBase64(hash), bytesToBase64(salt));
    passwordChanged = true;
  }
  if (!updates.length) return json({ error: "No hay cambios válidos" }, 400);
  values.push(id);
  let result;
  try { result = await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run(); }
  catch { return json({ error: "El nombre de usuario ya existe" }, 409); }
  if (!result.meta.changes) return json({ error: "Usuario no encontrado" }, 404);
  if (body.active === false || passwordChanged) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const admin = await requireRoleManager(request, env);
  if (!admin) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1 || id === admin.id) return json({ error: "No puedes eliminar esta cuenta" }, 400);
  await env.DB.prepare("UPDATE plugin_installations SET installed_by=? WHERE installed_by=?").bind(admin.id, id).run();
  const result = await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return result.meta.changes ? json({ ok: true }) : json({ error: "Usuario no encontrado" }, 404);
}
