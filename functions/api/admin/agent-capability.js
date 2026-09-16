import { bytesToBase64, json, requireAdmin, sha256 } from "../../_shared.js";

// This route is intentionally cookie-authenticated. It creates an opaque,
// revocable bearer capability which is handed directly to the local LSFA
// companion; it is never returned by any read endpoint.
export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(rawToken));
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO agent_capabilities(id,actor_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(id, admin.id, tokenHash, expiresAt, new Date().toISOString()).run();
  return json({ id, token: rawToken, expiresAt }, 201, { "Cache-Control": "no-store" });
}
