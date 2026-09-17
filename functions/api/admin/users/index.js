import { bytesToBase64, json, normalizeEmail, pbkdf2, requireAdmin, requireRoleManager, validEmail } from "../../../_shared.js";
import { roleExists } from "../../../_roles.js";

function validUsername(value) {
  return /^[a-z0-9_.-]{3,40}$/.test(String(value || "").trim().toLowerCase());
}

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "users:manage")) return json({ error: "Se requiere permiso de usuarios" }, 403);
  const result = await env.DB.prepare("SELECT id, username, email, role, active, created_at FROM users ORDER BY id DESC LIMIT 200").all();
  return json({ users: result.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  if (!await requireRoleManager(request, env)) return json({ error: "Se requiere permiso para gestionar roles" }, 403);
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const email = normalizeEmail(body?.email);
  const role = body?.role === undefined ? "user" : String(body.role);
  if (!validUsername(username) || password.length < 10) return json({ error: "Usuario inválido o contraseña menor de 10 caracteres" }, 400);
  if (email && !validEmail(email)) return json({ error: "Correo inválido" }, 400);
  if (!await roleExists(env, role)) return json({ error: "El rol seleccionado no existe." }, 422);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  try {
    const result = await env.DB.prepare("INSERT INTO users (username, password_hash, password_salt, email, role, active) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(username, bytesToBase64(hash), bytesToBase64(salt), email || null, role, body?.active === false ? 0 : 1).run();
    return json({ ok: true, id: result.meta.last_row_id, username, role }, 201);
  } catch {
    return json({ error: "El usuario ya existe" }, 409);
  }
}
