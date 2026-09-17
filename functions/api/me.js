import { bytesToBase64, cookieValue, json, sha256 } from "../_shared.js";
import { hasCorePermission } from "../_roles.js";
import { CORE_PERMISSIONS } from "../_roles.js";

export async function onRequestGet({ request, env }) {
  const token = cookieValue(request, "session");
  if (!token) return json({ authenticated: false }, 401, { "Cache-Control": "no-store" });
  const tokenHash = bytesToBase64(await sha256(token));
  const row = await env.DB.prepare("SELECT users.id, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now') AND users.active = 1")
    .bind(tokenHash).first();
  if (!row) return json({ authenticated: false }, 401, { "Cache-Control": "no-store" });
  const core = Object.fromEntries(await Promise.all(CORE_PERMISSIONS.map(async (permission) => [permission, await hasCorePermission(env, row, permission)])));
  const permissions = { adminAccess: core["dashboard:access"], rolesManage: core["roles:manage"], contentOwn: core["content:own"], core };
  return json({ authenticated: true, user: { ...row, permissions } }, 200, { "Cache-Control": "no-store" });
}
