import { base64ToBytes, bytesToBase64, equalBytes, json, pbkdf2, sha256 } from "../_shared.js";

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
  const candidate = user ? await pbkdf2(password, base64ToBytes(user.password_salt)) : null;
  if (!user || !equalBytes(candidate, base64ToBytes(user.password_hash))) {
    const failures = Number(lock?.failures || 0) + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare("INSERT INTO login_lockouts (fingerprint, failures, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at")
      .bind(fingerprint, failures, lockedUntil, new Date().toISOString()).run();
    return json({ error: lockedUntil ? "Demasiados intentos. Intenta nuevamente en 15 minutos." : "Credenciales inválidas" }, lockedUntil ? 429 : 401, { "Cache-Control": "no-store" });
  }

  await env.DB.prepare("DELETE FROM login_lockouts WHERE fingerprint = ?").bind(fingerprint).run();

  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(rawToken));
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").bind(user.id, tokenHash, expires).run();
  return json({ ok: true, user: { username: user.username, role: user.role } }, 200, {
    "Set-Cookie": `session=${encodeURIComponent(rawToken)}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,
    "Cache-Control": "no-store"
  });
}
