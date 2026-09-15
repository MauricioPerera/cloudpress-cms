import { bytesToBase64, json, normalizeEmail, pbkdf2, takeRateLimit, validEmail } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!await takeRateLimit(env, request, "register", 5 * 60 * 1000)) return json({ error: "Espera unos minutos antes de registrar otra cuenta" }, 429, { "Retry-After": "300" });
  const username = String(body?.username || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const email = normalizeEmail(body?.email);
  if (!/^[a-z0-9_.-]{3,40}$/.test(username) || password.length < 10) {
    return json({ error: "Usuario inválido o contraseña menor de 10 caracteres" }, 400);
  }
  if (email && !validEmail(email)) return json({ error: "Correo inválido" }, 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  try {
    await env.DB.prepare("INSERT INTO users (username, password_hash, password_salt, email) VALUES (?, ?, ?, ?)")
      .bind(username, bytesToBase64(hash), bytesToBase64(salt), email || null).run();
  } catch {
    return json({ error: "El usuario ya existe" }, 409);
  }
  return json({ ok: true, username }, 201);
}
