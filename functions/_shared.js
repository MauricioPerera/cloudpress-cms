const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations = 100000) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

async function currentUser(request, env) {
  const token = cookieValue(request, "session");
  if (token) {
    const tokenHash = bytesToBase64(await sha256(token));
    return env.DB.prepare("SELECT users.id, users.username, users.role, users.active FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now') AND users.active = 1")
      .bind(tokenHash).first();
  }
  // An LSFA companion holds this opaque capability in the OS credential store.
  // Browser JavaScript and agents never receive it from CloudPress.
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9+/=_-]{32,256})$/.exec(authorization);
  if (!match) return null;
  const tokenHash = bytesToBase64(await sha256(match[1]));
  return env.DB.prepare("SELECT users.id, users.username, users.role, users.active FROM agent_capabilities JOIN users ON users.id = agent_capabilities.actor_id WHERE agent_capabilities.token_hash = ? AND agent_capabilities.revoked_at IS NULL AND agent_capabilities.expires_at > datetime('now') AND users.active = 1")
    .bind(tokenHash).first();
}

async function requireAdmin(request, env) {
  const user = await currentUser(request, env);
  return user?.role === "admin" ? user : null;
}

async function requireAuthor(request, env) {
  const user = await currentUser(request, env);
  return user?.role === "author" ? user : null;
}

async function takeRateLimit(env, request, action, intervalMs) {
  const client = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const fingerprint = bytesToBase64(await sha256(`${action}:${client}`));
  const now = new Date();
  const cutoff = new Date(now.getTime() - intervalMs).toISOString();
  const result = await env.DB.prepare("INSERT INTO action_rate_limits(action,fingerprint,last_created_at) VALUES(?,?,?) ON CONFLICT(action,fingerprint) DO UPDATE SET last_created_at=excluded.last_created_at WHERE action_rate_limits.last_created_at <= ?").bind(action, fingerprint, now.toISOString(), cutoff).run();
  return Boolean(result.meta.changes);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim()) && String(value).length <= 254;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, (tag) => {
    const close = /^<\/(p|strong|em|ul|ol|li|h2|h3|blockquote|a)>$/i.exec(tag);
    if (close) return `</${close[1].toLowerCase()}>`;
    const simple = /^<(p|br|strong|em|ul|ol|li|h2|h3|blockquote)\s*\/?\s*>$/i.exec(tag);
    if (simple) return `<${simple[1].toLowerCase()}>`;
    if (/^<a\b/i.test(tag)) {
      const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "";
      return /^(https?:\/\/|\/)/i.test(href) ? `<a href="${href.replace(/"/g, "&quot;")}" rel="noopener noreferrer">` : "";
    }
    if (/^<img\b/i.test(tag)) {
      const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "";
      const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || "";
      return src.startsWith("/media/") ? `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}">` : "";
    }
    return "";
  });
}

export { base64ToBytes, bytesToBase64, cookieValue, currentUser, equalBytes, json, normalizeEmail, pbkdf2, requireAdmin, requireAuthor, sanitizeHtml, sha256, takeRateLimit, validEmail };
