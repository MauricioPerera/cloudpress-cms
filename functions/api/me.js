import { bytesToBase64, cookieValue, json, sha256 } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  const token = cookieValue(request, "session");
  if (!token) return json({ authenticated: false }, 401, { "Cache-Control": "no-store" });
  const tokenHash = bytesToBase64(await sha256(token));
  const row = await env.DB.prepare("SELECT users.id, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now') AND users.active = 1")
    .bind(tokenHash).first();
  if (!row) return json({ authenticated: false }, 401, { "Cache-Control": "no-store" });
  return json({ authenticated: true, user: row }, 200, { "Cache-Control": "no-store" });
}
