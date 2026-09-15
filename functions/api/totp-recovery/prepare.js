import { json, takeRateLimit } from "../../_shared.js";
import { newOpaqueToken, tokenHash } from "../../_totp.js";

export async function onRequestPost({ request, env }) {
  if (!await takeRateLimit(env, request, "totp-recovery-prepare", 60 * 1000)) return json({ error: "Espera un minuto antes de iniciar otra recuperación" }, 429, { "Retry-After": "60" });
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim().toLowerCase();
  const user = /^[a-z0-9_.-]{3,40}$/.test(username)
    ? await env.DB.prepare("SELECT users.id FROM users JOIN totp_credentials ON totp_credentials.user_id=users.id AND totp_credentials.state='active' WHERE users.username=? AND users.active=1").bind(username).first()
    : null;
  const requestId = crypto.randomUUID();
  const recoveryToken = newOpaqueToken();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM totp_recovery_requests WHERE expires_at < ?").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO totp_recovery_requests(id,user_id,token_hash,state,expires_at) VALUES(?,?,?,'pending',?)").bind(requestId, user?.id || null, await tokenHash(recoveryToken), expiresAt).run();
  return json({ ok: true, requestId, recoveryToken, expiresAt }, 200, { "Cache-Control": "no-store" });
}
