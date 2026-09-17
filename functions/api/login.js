import { bytesToBase64, json, pbkdf2, sha256, verifyPassword } from "../_shared.js";
import { hasCorePermission } from "../_roles.js";
import { decryptTotpSecret, verifyTotp } from "../_totp.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const fingerprint = `${username}:${ip}`;
  let lock = await env.DB.prepare("SELECT failures, locked_until FROM login_lockouts WHERE fingerprint = ?").bind(fingerprint).first();
  if (lock?.locked_until && Date.parse(lock.locked_until) <= Date.now()) {
    await env.DB.prepare("DELETE FROM login_lockouts WHERE fingerprint = ?").bind(fingerprint).run();
    lock = null;
  }
  if (lock?.locked_until) return json({ error: "Demasiados intentos. Intenta nuevamente en 15 minutos." }, 429, { "Retry-After": "900", "Cache-Control": "no-store" });
  const user = await env.DB.prepare("SELECT id, username, password_hash, password_salt, role FROM users WHERE username = ? AND active = 1")
    .bind(username).first();
  const reject = async () => {
    const failures = Number(lock?.failures || 0) + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare("INSERT INTO login_lockouts (fingerprint, failures, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at")
      .bind(fingerprint, failures, lockedUntil, new Date().toISOString()).run();
    return json({ error: lockedUntil ? "Demasiados intentos. Intenta nuevamente en 15 minutos." : "Credenciales inválidas" }, lockedUntil ? 429 : 401, { "Cache-Control": "no-store" });
  };
  const passwordCheck = user ? await verifyPassword(password, Uint8Array.from(atob(user.password_salt), (character) => character.charCodeAt(0)), user.password_hash) : null;
  if (!user || !passwordCheck?.valid) {
    return reject();
  }

  const totp = await env.DB.prepare("SELECT secret_ciphertext,last_used_counter FROM totp_credentials WHERE user_id=? AND state='active'").bind(user.id).first();
  if (totp) {
    let counter = null;
    try { counter = await verifyTotp(await decryptTotpSecret(env, totp.secret_ciphertext), body?.totp, { lastCounter: totp.last_used_counter }); }
    catch { return json({ error: "No se pudo verificar el autenticador" }, 503, { "Cache-Control": "no-store" }); }
    if (counter === null) return reject();
    const consumed = await env.DB.prepare("UPDATE totp_credentials SET last_used_counter=? WHERE user_id=? AND state='active' AND (last_used_counter IS NULL OR last_used_counter < ?)").bind(counter, user.id, counter).run();
    if (!consumed.meta.changes) return reject();
  }

  if (passwordCheck.needsUpgrade) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt);
    await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").bind(bytesToBase64(hash), bytesToBase64(salt), user.id).run();
  }

  await env.DB.prepare("DELETE FROM login_lockouts WHERE fingerprint = ?").bind(fingerprint).run();

  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(rawToken));
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").bind(user.id, tokenHash, expires).run();
  const permissions = { adminAccess: await hasCorePermission(env, user, "dashboard:access"), contentOwn: await hasCorePermission(env, user, "content:own") };
  return json({ ok: true, user: { username: user.username, role: user.role, permissions } }, 200, {
    "Set-Cookie": `session=${encodeURIComponent(rawToken)}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,
    "Cache-Control": "no-store"
  });
}
