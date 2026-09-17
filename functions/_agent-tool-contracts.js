// The server is the authority for what an opaque agent capability may invoke.
// Do not infer a grant from a user's role: a bearer must match one named tool.
const plugin = "[a-z0-9][a-z0-9-]{2,47}";
const taxonomy = "[a-z0-9][a-z0-9-]{2,47}";
const numericId = "[1-9][0-9]*";

export const toolContracts = Object.freeze([
  { name: "cloudpress_read_admin_state", risk: "read", method: "GET", paths: [
    /^\/api\/admin\/(entries|users|taxonomies|menus|plugins|media|plugin-schema|plugin-meta|blocks)$/,
    new RegExp(`^/api/admin/plugins/${plugin}/taxonomies/${taxonomy}$`),
  ] },
  { name: "cloudpress_create_draft", risk: "reversible", method: "POST", paths: [/^\/api\/admin\/entries$/], body: (value) => value?.status === "draft" },
  { name: "cloudpress_update_content", risk: "reversible", method: "PATCH", paths: [new RegExp(`^/api/admin/entries/${numericId}$`), new RegExp(`^/api/admin/content/${numericId}$`)] },
  { name: "cloudpress_trash_content", risk: "reversible", method: "DELETE", paths: [new RegExp(`^/api/admin/entries/${numericId}$`)] },
  { name: "cloudpress_restore_content", risk: "reversible", method: "POST", paths: [new RegExp(`^/api/admin/trash/${numericId}$`)] },
  { name: "cloudpress_set_user_active", risk: "reversible", method: "POST", paths: [new RegExp(`^/api/admin/users/${numericId}/active$`)] },
  { name: "cloudpress_manage_navigation", risk: "reversible", method: "POST", paths: [/^\/api\/admin\/(taxonomies|menus)$/] },
  { name: "cloudpress_manage_navigation", risk: "reversible", method: "PUT", paths: [/^\/api\/admin\/(taxonomies|menus)$/] },
  { name: "cloudpress_manage_terms", risk: "reversible", method: "POST", paths: [new RegExp(`^/api/admin/plugins/${plugin}/taxonomies/${taxonomy}$`)] },
  { name: "cloudpress_manage_terms", risk: "reversible", method: "PUT", paths: [new RegExp(`^/api/admin/plugins/${plugin}/taxonomies/${taxonomy}/${numericId}$`)] },
  { name: "cloudpress_manage_meta", risk: "reversible", method: "PUT", paths: [/^\/api\/admin\/plugin-meta$/] },
  { name: "cloudpress_install_plugin", risk: "reversible", method: "POST", paths: [/^\/api\/admin\/plugins$/] },
  { name: "cloudpress_set_plugin_state", risk: "reversible", method: "PATCH", paths: [new RegExp(`^/api/admin/plugins/${plugin}$`)] },
  { name: "cloudpress_upload_media", risk: "reversible", method: "POST", paths: [/^\/api\/admin\/media-agent$/] },
  { name: "cloudpress_update_media_meta", risk: "reversible", method: "PATCH", paths: [/^\/api\/admin\/media\/[^/]+$/] },
  // Plugins opt in per action in their signed manifest. The generic route is
  // still constrained to one declared action and the active task step.
  { name: "cloudpress_plugin_action", risk: "read", method: "POST", paths: [new RegExp(`^/api/admin/plugins/${plugin}/actions/${plugin}$`)] },
  { name: "cloudpress_plugin_action", risk: "reversible", method: "POST", paths: [new RegExp(`^/api/admin/plugins/${plugin}/actions/${plugin}$`)] },
  { name: "cloudpress_sensitive_action", risk: "sensitive", method: "POST", paths: [/^\/api\/admin\/approvals$/] },
]);

export async function agentToolAllows(request, grants) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  let parsed, parsedOnce = false;
  for (const contract of toolContracts) {
    if (contract.method !== method || !contract.paths.some((pattern) => pattern.test(path))) continue;
    if (contract.body) {
      if (!parsedOnce) { parsedOnce = true; parsed = await request.clone().json().catch(() => null); }
      if (!contract.body(parsed)) continue;
    }
    if (grants.some((grant) => grant.name === contract.name && grant.risk === contract.risk)) return contract;
  }
  return null;
}

export const contractForTool = (name) => toolContracts.find((contract) => contract.name === name) || null;
