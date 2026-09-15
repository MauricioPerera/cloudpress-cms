import { bytesToBase64, json, pbkdf2, takeRateLimit } from "../../../_shared.js";
import { tokenHash } from "../../../_totp.js";

export async function onRequestPost({ request, env, params }) {
  if (!await takeRateLimit(env, request, "totp-recovery-complete", 15 * 1000)) return json({ error: "Espera antes de intentar otra recuperación" }, 429, { "Retry-After": "15" });
  const token = String(request.headers.get("x-cloudpress-recovery-token") || "");
  const body = await request.json().catch(() => null);
  const password = String(body?.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(String(params.id || "")) || !token || password.length < 10) return json({ error: "Solicitud inválida o contraseña demasiado corta" }, 400);
  const recovery = await env.DB.prepare("SELECT id,user_id,state,expires_at FROM totp_recovery_requests WHERE id=? AND token_hash=?").bind(params.id, await tokenHash(token)).first();
  if (!recovery || recovery.state !== "verified" || Date.parse(recovery.expires_at) <= Date.now() || !recovery.user_id) return json({ error: "Solicitud de recuperación inválida o expirada" }, 400);
  const claim = await env.DB.prepare("UPDATE totp_recovery_requests SET state='executing' WHERE id=? AND state='verified'").bind(recovery.id).run();
  if (!claim.meta.changes) return json({ error: "La solicitud ya fue usada" }, 409);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").bind(bytesToBase64(hash), bytesToBase64(salt), recovery.user_id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(recovery.user_id),
      env.DB.prepare("UPDATE totp_recovery_requests SET state='used',completed_at=? WHERE id=? AND state='executing'").bind(new Date().toISOString(), recovery.id),
    ]);
    return json({ ok: true, state: "used" }, 200, { "Cache-Control": "no-store" });
  } catch {
    await env.DB.prepare("UPDATE totp_recovery_requests SET state='unknown' WHERE id=? AND state='executing'").bind(recovery.id).run();
    return json({ error: "No se pudo completar la recuperación" }, 503);
  }
}
