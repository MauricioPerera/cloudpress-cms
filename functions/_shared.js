const encoder = new TextEncoder();
import { hasCorePermission } from "./_roles.js";
import { agentToolAllows } from "./_agent-tool-contracts.js";
import { activeAgentStep } from "./_agent-os.js";
// Cloudflare Workers rejects PBKDF2 counts above 100,000. Keeping this
// deployable prevents an uncaught NotSupportedError during login.
const PBKDF2_ITERATIONS = 100000;

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

async function verifyPassword(password, salt, passwordHash) {
  const expected = base64ToBytes(passwordHash);
  const current = await pbkdf2(password, salt);
  return { valid: equalBytes(current, expected), needsUpgrade: false };
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

const errorCodeForStatus = (status) => ({
  400: "invalid_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
  409: "conflict", 422: "validation_failed", 429: "rate_limited"
}[status] || (status >= 500 ? "internal_error" : "request_failed"));

function json(data, status = 200, headers = {}) {
  const requestId = crypto.randomUUID();
  const payload = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : data;
  // Some legacy flows already expose requestId as an operation identifier
  // (for example, a TOTP recovery ticket). Preserve that public contract and
  // place the HTTP correlation identifier in correlationId instead.
  if (payload && typeof payload === "object") {
    if (Object.hasOwn(payload, "requestId")) payload.correlationId = requestId;
    else payload.requestId = requestId;
  }
  if (payload?.error && !payload.code) payload.code = errorCodeForStatus(status);
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "x-request-id": requestId, ...headers } });
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

async function currentSessionUser(request, env) {
  const token = cookieValue(request, "session");
  if (!token) return null;
  const tokenHash = bytesToBase64(await sha256(token));
  return env.DB.prepare("SELECT users.id, users.username, users.role, users.active FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now') AND users.active = 1")
    .bind(tokenHash).first();
}

async function currentAgentCapabilityUser(request, env) {
  // An LSFA companion holds this opaque capability in the OS credential store.
  // Browser JavaScript and agents never receive it from CloudPress.
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9+/=_-]{32,256})$/.exec(authorization);
  if (!match) return null;
  const tokenHash = bytesToBase64(await sha256(match[1]));
  const user = await env.DB.prepare("SELECT users.id, users.username, users.role, users.active, agent_capabilities.id AS agent_capability_id, agent_capabilities.profile_id AS agent_profile_id FROM agent_capabilities JOIN users ON users.id = agent_capabilities.actor_id WHERE agent_capabilities.token_hash = ? AND agent_capabilities.revoked_at IS NULL AND agent_capabilities.expires_at > datetime('now') AND users.active = 1")
    .bind(tokenHash).first();
  if (!user?.agent_profile_id) return null;
  const profile = await env.DB.prepare("SELECT id FROM agent_profiles WHERE id=? AND owner_id=? AND status='active'").bind(user.agent_profile_id, user.id).first();
  return profile ? { ...user, auth_method: "agent_capability" } : null;
}

async function currentUser(request, env) {
  const sessionUser = await currentSessionUser(request, env);
  if (sessionUser) return sessionUser;
  const user = await currentAgentCapabilityUser(request, env);
  if (!user) return null;
  const grants = await env.DB.prepare("SELECT tool_name,risk FROM agent_profile_tools JOIN agent_profiles ON agent_profiles.id=agent_profile_tools.profile_id WHERE agent_profile_tools.profile_id=? AND agent_profiles.owner_id=? AND agent_profiles.status='active'").bind(user.agent_profile_id, user.id).all();
  const contract = await agentToolAllows(request, grants.results.map((grant) => ({ name: grant.tool_name, risk: grant.risk })));
  return contract ? { ...user, agent_tool_name: contract.name, agent_tool_risk: contract.risk, auth_method: "agent_capability" } : null;
}

async function currentTaskScopedUser(request, env) {
  const user = await currentUser(request, env);
  if (!user || user.auth_method !== "agent_capability") return user;
  const step = await activeAgentStep(env, user, request.headers.get("x-cloudpress-task-id"), Number(request.headers.get("x-cloudpress-step-ordinal")), user.agent_tool_name, user.agent_tool_risk);
  return step ? { ...user, agent_task_id: request.headers.get("x-cloudpress-task-id"), agent_step_id: step.id, agent_run_id: step.run_id, agent_trace_id: step.trace_id } : null;
}

async function auditAgentCapabilityUse(request, env, user) {
  if (user?.auth_method !== "agent_capability" || !user.agent_capability_id) return;
  try {
    const url = new URL(request.url);
    await env.DB.prepare("INSERT INTO agent_capability_events(capability_id,actor_id,method,path) VALUES(?,?,?,?)")
      .bind(user.agent_capability_id, user.id, request.method.toUpperCase(), url.pathname).run();
    // A capability event alone cannot reconstruct what happened in a task.
    // Add only the bounded routing facts to its correlated trace; never input,
    // response data, bearer material or other potentially sensitive values.
    if (user.agent_task_id && user.agent_run_id && user.agent_step_id && user.agent_trace_id) {
      await env.DB.prepare("INSERT INTO agent_trace_events(trace_id,task_id,run_id,step_id,actor_id,event,details_json) VALUES(?,?,?,?,?,?,?)")
        .bind(user.agent_trace_id, user.agent_task_id, user.agent_run_id, user.agent_step_id, user.id, "agent_tool_authorized", JSON.stringify({ method: request.method.toUpperCase(), path: url.pathname, tool: user.agent_tool_name, risk: user.agent_tool_risk })).run();
    }
  } catch { /* Authorization must remain available if observability storage is temporarily unavailable. */ }
}

async function requireAdmin(request, env, permission = "dashboard:access") {
  const user = await currentTaskScopedUser(request, env);
  await auditAgentCapabilityUse(request, env, user);
  return await hasCorePermission(env, user, permission) ? user : null;
}

async function requireBrowserAdmin(request, env, permission = "dashboard:access") {
  const user = await currentSessionUser(request, env);
  return await hasCorePermission(env, user, permission) ? user : null;
}

async function requireAuthor(request, env) {
  const user = await currentTaskScopedUser(request, env);
  await auditAgentCapabilityUse(request, env, user);
  return await hasCorePermission(env, user, "content:own") ? user : null;
}

async function requireRoleManager(request, env) {
  const user = await currentTaskScopedUser(request, env);
  await auditAgentCapabilityUse(request, env, user);
  return await hasCorePermission(env, user, "roles:manage") ? user : null;
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

export { base64ToBytes, bytesToBase64, cookieValue, currentAgentCapabilityUser, currentSessionUser, currentTaskScopedUser, currentUser, equalBytes, errorCodeForStatus, json, normalizeEmail, pbkdf2, requireAdmin, requireAuthor, requireBrowserAdmin, requireRoleManager, sanitizeHtml, sha256, takeRateLimit, validEmail, verifyPassword };
