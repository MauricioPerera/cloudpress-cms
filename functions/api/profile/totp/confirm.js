import { currentUser, json } from "../../../_shared.js";
import { decryptTotpSecret, newRecoveryCode, recoveryCodeHash, verifyTotp } from "../../../_totp.js";

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Se requiere iniciar sesión" }, 401);
  const body = await request.json().catch(() => null);
  const credential = await env.DB.prepare("SELECT secret_ciphertext,state,last_used_counter FROM totp_credentials WHERE user_id=?").bind(user.id).first();
  if (!credential || credential.state !== "pending") return json({ error: "No hay un autenticador pendiente" }, 400);
  try {
    const counter = await verifyTotp(await decryptTotpSecret(env, credential.secret_ciphertext), body?.code, { lastCounter: credential.last_used_counter });
    if (counter === null) return json({ error: "El código del autenticador no es válido" }, 400);
    const recoveryCodes = Array.from({ length: 10 }, newRecoveryCode);
    const inserts = [];
    for (const code of recoveryCodes) inserts.push(env.DB.prepare("INSERT INTO totp_recovery_codes(user_id,code_hash) VALUES(?,?)").bind(user.id, await recoveryCodeHash(code)));
    await env.DB.batch([
      env.DB.prepare("UPDATE totp_credentials SET state='active',last_used_counter=?,verified_at=? WHERE user_id=? AND state='pending'").bind(counter, new Date().toISOString(), user.id),
      env.DB.prepare("DELETE FROM totp_recovery_codes WHERE user_id=?").bind(user.id),
      ...inserts,
    ]);
    return json({ ok: true, recoveryCodes }, 200, { "Cache-Control": "no-store" });
  } catch { return json({ error: "No se pudo activar el autenticador" }, 503); }
}
