import { bytesToBase64, sha256 } from "./_shared.js";

export async function issueAgentCapability(env, actorId, profileId, now = new Date()) {
  if (!/^[a-z][a-z0-9-]{2,47}$/.test(String(profileId || ""))) throw new Error("Selecciona un perfil de agente válido.");
  const profile = await env.DB.prepare("SELECT id FROM agent_profiles WHERE id=? AND owner_id=? AND status='active'").bind(profileId, actorId).first();
  if (!profile) throw new Error("El perfil de agente no está disponible para este usuario.");
  const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = bytesToBase64(await sha256(rawToken));
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_capabilities SET revoked_at=? WHERE actor_id=? AND revoked_at IS NULL").bind(createdAt, actorId),
    env.DB.prepare("INSERT INTO agent_capabilities(id,actor_id,profile_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)").bind(id, actorId, profileId, tokenHash, expiresAt, createdAt),
  ]);
  return { id, profileId, token: rawToken, expiresAt };
}

export async function listAgentCapabilities(env) {
  const result = await env.DB.prepare("SELECT agent_capabilities.id,users.username,agent_capabilities.profile_id,agent_capabilities.expires_at,agent_capabilities.created_at,agent_capabilities.revoked_at FROM agent_capabilities JOIN users ON users.id=agent_capabilities.actor_id ORDER BY agent_capabilities.created_at DESC LIMIT 100").all();
  const now = Date.now();
  return result.results.map((row) => ({
    id: row.id,
    username: row.username,
    profileId: row.profile_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status: row.revoked_at ? "revoked" : Date.parse(row.expires_at) <= now ? "expired" : "active",
  }));
}

export async function revokeAgentCapability(env, id, revokedAt = new Date().toISOString()) {
  const result = await env.DB.prepare("UPDATE agent_capabilities SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(revokedAt, id).run();
  return Boolean(result.meta.changes);
}
