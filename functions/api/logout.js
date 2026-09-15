import { cookieValue, json, sha256, bytesToBase64 } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  const token = cookieValue(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(bytesToBase64(await sha256(token))).run();
  return json({ ok: true }, 200, { "Set-Cookie": "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", "Cache-Control": "no-store" });
}
