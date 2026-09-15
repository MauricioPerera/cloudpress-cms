import { json, takeRateLimit } from "../../../_shared.js";
import { decryptTotpSecret, normalizeRecoveryCode, recoveryCodeHash, tokenHash, verifyTotp } from "../../../_totp.js";

export async function onRequestPost({ request, env, params }) {
  if (!await takeRateLimit(env, request, "totp-recovery-verify", 15 * 1000)) return json({ error: "Espera antes de intentar otro código" }, 429, { "Retry-After": "15" });
  const token = String(request.headers.get("x-cloudpress-recovery-token") || "");
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f-]{36}$/i.test(String(params.id || "")) || !token) return json({ error: "Solicitud de recuperación inválida" }, 400);
  const recovery = await env.DB.prepare("SELECT r.id,r.user_id,r.state,r.expires_at,c.secret_ciphertext,c.last_used_counter FROM totp_recovery_requests r LEFT JOIN totp_credentials c ON c.user_id=r.user_id AND c.state='active' WHERE r.id=? AND r.token_hash=?").bind(params.id, await tokenHash(token)).first();
  if (!recovery || recovery.state !== "pending" || Date.parse(recovery.expires_at) <= Date.now() || !recovery.user_id) return json({ error: "Solicitud de recuperación inválida o expirada" }, 400);
  try {
    let verified = false, counter = null;
    const code = String(body?.code || "");
    if (code) {
      counter = await verifyTotp(await decryptTotpSecret(env, recovery.secret_ciphertext), code, { lastCounter: recovery.last_used_counter });
      verified = counter !== null;
    } else {
      const backup = normalizeRecoveryCode(body?.recoveryCode);
      if (/^[A-Z2-7]{12}$/.test(backup)) {
        const found = await env.DB.prepare("SELECT id FROM totp_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").bind(recovery.user_id, await recoveryCodeHash(backup)).first();
        if (found) { await env.DB.prepare("UPDATE totp_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL").bind(new Date().toISOString(), found.id).run(); verified = true; }
      }
    }
    if (!verified) return json({ error: "El código no es válido" }, 400);
    const claimed = await env.DB.prepare("UPDATE totp_recovery_requests SET state='verified',verified_at=? WHERE id=? AND state='pending'").bind(new Date().toISOString(), recovery.id).run();
    if (!claimed.meta.changes) return json({ error: "La solicitud ya no está disponible" }, 409);
    if (counter !== null) await env.DB.prepare("UPDATE totp_credentials SET last_used_counter=? WHERE user_id=? AND (last_used_counter IS NULL OR last_used_counter < ?)").bind(counter, recovery.user_id, counter).run();
    return json({ ok: true, state: "verified" }, 200, { "Cache-Control": "no-store" });
  } catch { return json({ error: "No se pudo verificar el autenticador" }, 503); }
}
