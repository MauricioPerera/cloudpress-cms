import { base64ToBytes, bytesToBase64, currentUser, equalBytes, json, normalizeEmail, pbkdf2, validEmail } from "../_shared.js";

const validUsername = value => /^[a-z0-9_.-]{3,40}$/.test(String(value || "").trim().toLowerCase());

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Se requiere iniciar sesión" }, 401);
  const profile = await env.DB.prepare("SELECT username,email,role,created_at FROM users WHERE id=? AND active=1").bind(user.id).first();
  return profile ? json({ profile }, 200, { "Cache-Control": "no-store" }) : json({ error: "Usuario no encontrado" }, 404);
}

export async function onRequestPatch({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Se requiere iniciar sesión" }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Solicitud inválida" }, 400);
  const updates = [], values = [];
  if (body.username !== undefined) { const username = String(body.username).trim().toLowerCase(); if (!validUsername(username)) return json({ error: "Nombre de usuario inválido" }, 400); updates.push("username=?"); values.push(username); }
  if (body.email !== undefined) { const email = normalizeEmail(body.email); if (email && !validEmail(email)) return json({ error: "Correo inválido" }, 400); updates.push("email=?"); values.push(email || null); }
  let passwordChanged = false;
  if (body.password !== undefined && String(body.password).length) {
    if (String(body.password).length < 10) return json({ error: "La contraseña debe tener al menos 10 caracteres" }, 400);
    const record = await env.DB.prepare("SELECT password_hash,password_salt FROM users WHERE id=?").bind(user.id).first();
    const current = String(body.currentPassword || "");
    if (!record || !current || !equalBytes(await pbkdf2(current, base64ToBytes(record.password_salt)), base64ToBytes(record.password_hash))) return json({ error: "La contraseña actual no es correcta" }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16)), hash = await pbkdf2(String(body.password), salt);
    updates.push("password_hash=?", "password_salt=?"); values.push(bytesToBase64(hash), bytesToBase64(salt)); passwordChanged = true;
  }
  if (!updates.length) return json({ error: "No hay cambios válidos" }, 400);
  try { await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id=?`).bind(...values, user.id).run(); }
  catch { return json({ error: "El usuario o correo ya está en uso" }, 409); }
  if (passwordChanged) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id).run();
  return json({ ok: true, passwordChanged });
}
