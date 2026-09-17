const CORE_PERMISSIONS = Object.freeze([
  "dashboard:access", "content:manage", "content:own", "media:manage",
  "comments:moderate", "taxonomies:manage", "navigation:manage", "settings:manage",
  "plugins:manage", "users:manage", "roles:manage", "import-export:manage", "scheduler:manage",
  "sensitive:approve",
]);
// Sólo existe para conservar roles creados antes de la granularización.
const LEGACY_ADMIN_ACCESS = "admin:access";
const ROLE_ID = /^[a-z][a-z0-9-]{2,47}$/;

function validRoleId(value) { return ROLE_ID.test(String(value || "")); }
function validRoleLabel(value) { const label = String(value || "").trim(); return label.length >= 2 && label.length <= 80; }

async function roleExists(env, roleId) {
  return Boolean(await env.DB.prepare("SELECT 1 FROM roles WHERE id=?").bind(roleId).first());
}

async function hasCorePermission(env, user, permission) {
  if (!user || !CORE_PERMISSIONS.includes(permission)) return false;
  // Compatibility with databases that have not yet received migration 0020.
  // The migration seeds these same grants, so this cannot broaden a custom role.
  if (user.role === "admin") return true;
  if (permission === "content:own" && user.role === "author") return true;
  return Boolean(await env.DB.prepare("SELECT 1 FROM role_permissions WHERE role_id=? AND permission IN (?,?)").bind(user.role, permission, LEGACY_ADMIN_ACCESS).first());
}

async function roleScope(env, roleId) {
  const row = await env.DB.prepare("SELECT scope FROM roles WHERE id=?").bind(roleId).first();
  return row?.scope || null;
}

export { CORE_PERMISSIONS, hasCorePermission, roleExists, roleScope, validRoleId, validRoleLabel };
