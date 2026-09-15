import { bytesToBase64, json, normalizeEmail, sha256, takeRateLimit } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  if (!await takeRateLimit(env, request, "forgot-password", 60 * 1000)) return json({ error: "Espera un minuto antes de solicitar otra recuperación" }, 429, { "Retry-After": "60" });
  if (!env.RESEND_API_KEY || !env.RESET_FROM) return json({ error: "La recuperación por correo aún no está configurada." }, 503);
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND active = 1").bind(email).first();
  if (!user) return json({ ok: true });
  await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < ?").bind(user.id, new Date().toISOString()).run();
  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(rawToken));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)").bind(user.id, tokenHash, expiresAt).run();
  const link = new URL("/reset-password.html", request.url);
  link.searchParams.set("token", rawToken);
  const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.RESET_FROM, to: [email], subject: "Restablece tu contraseña", html: `<p>Solicitaste restablecer tu contraseña.</p><p><a href="${link.href}">Crear una contraseña nueva</a></p><p>Este enlace caduca en 15 minutos.</p>` }) });
  if (!sent.ok) return json({ error: "No se pudo enviar el correo de recuperación." }, 502);
  return json({ ok: true });
}
