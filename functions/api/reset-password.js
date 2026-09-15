import { base64ToBytes, bytesToBase64, json, pbkdf2, sha256 } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token || "");
  const password = String(body?.password || "");
  if (!token || password.length < 10) return json({ error: "Token inválido o contraseña menor de 10 caracteres" }, 400);
  const tokenHash = bytesToBase64(await sha256(token));
  const reset = await env.DB.prepare("SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(tokenHash, new Date().toISOString()).first();
  if (!reset) return json({ error: "El enlace es inválido o ha expirado" }, 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(bytesToBase64(hash), bytesToBase64(salt), reset.user_id),
    env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(new Date().toISOString(), reset.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(reset.user_id)
  ]);
  return json({ ok: true });
}
