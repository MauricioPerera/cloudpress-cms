import { base64ToBytes, currentUser, equalBytes, json, pbkdf2 } from "../../../_shared.js";
import { encryptTotpSecret, newTotpSecret, otpAuthUri } from "../../../_totp.js";

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Se requiere iniciar sesión" }, 401);
  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || "");
  const record = await env.DB.prepare("SELECT password_hash,password_salt FROM users WHERE id=?").bind(user.id).first();
  if (!record || !currentPassword || !equalBytes(await pbkdf2(currentPassword, base64ToBytes(record.password_salt)), base64ToBytes(record.password_hash))) return json({ error: "La contraseña actual no es correcta" }, 400);
  const existing = await env.DB.prepare("SELECT state FROM totp_credentials WHERE user_id=?").bind(user.id).first();
  if (existing?.state === "active") return json({ error: "El autenticador ya está activo." }, 409);
  try {
    const secret = newTotpSecret();
    await env.DB.prepare("INSERT INTO totp_credentials(user_id,secret_ciphertext,state,last_used_counter) VALUES(?,?, 'pending',NULL) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,state='pending',last_used_counter=NULL,created_at=CURRENT_TIMESTAMP,verified_at=NULL").bind(user.id, await encryptTotpSecret(env, secret)).run();
    return json({ ok: true, manualKey: secret, otpauthUri: otpAuthUri({ account: user.username, secret }) }, 201, { "Cache-Control": "no-store" });
  } catch { return json({ error: "No se pudo preparar el autenticador. Revisa TOTP_ENCRYPTION_KEY." }, 503); }
}
