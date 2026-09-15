import { pluginRegistry, pluginRelease } from "./registry.js";

const allowedPatch = new Set(["title", "slug", "excerpt", "body", "status"]);
const transformHooks = new Set(["content.beforeCreate", "content.beforeUpdate"]);
const blockingHooks = new Set(["content.beforeCreate", "content.beforeUpdate", "content.beforeTrash", "content.beforeRestore"]);

function cleanPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => allowedPatch.has(key) && typeof value === "string"));
}

async function auditHook(env, pluginId, action, content, details = {}) {
  try { await env.DB.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(pluginId, action, Number.isInteger(content?.authorId) ? content.authorId : null, JSON.stringify({ hook: details.hook, fields: details.fields || [] })).run(); }
  catch { /* A hook audit must never change the outcome of the core operation. */ }
}

export async function runPluginHook(env, hook, content) {
  let active;
  try {
    active = await env.DB.prepare("SELECT p.plugin_id,a.source_hash FROM plugin_installations p LEFT JOIN plugin_active_releases a ON a.plugin_id=p.plugin_id WHERE p.status='enabled' ORDER BY p.plugin_id").all();
  } catch {
    active = await env.DB.prepare("SELECT plugin_id,NULL AS source_hash FROM plugin_installations WHERE status = 'enabled' ORDER BY plugin_id").all();
  }
  const patch = {};
  const patchedBy = new Map();
  const plugins = active.results.map(({ plugin_id: id, source_hash: sourceHash }) => ({ id, plugin: sourceHash ? pluginRelease(id, sourceHash) : pluginRegistry.get(id) })).filter(({ plugin }) => plugin).sort((a, b) => (a.plugin.manifest.priority || 0) - (b.plugin.manifest.priority || 0) || a.id.localeCompare(b.id));
  for (const { id, plugin } of plugins) {
    const handler = plugin?.hooks?.[hook];
    if (!handler) continue;
    try {
      const result = await handler(Object.freeze({ ...content, ...patch }));
      if (blockingHooks.has(hook) && result?.allow === false) { await auditHook(env, id, "hook_blocked", content, { hook }); return { allowed: false, error: `El plugin ${id} bloqueó esta operación.` }; }
      if (transformHooks.has(hook)) {
        const nextPatch = cleanPatch(result?.patch);
        const conflicts = Object.keys(nextPatch).filter((field) => patchedBy.has(field) && patch[field] !== nextPatch[field]);
        if (conflicts.length) { await auditHook(env, id, "hook_conflict", content, { hook, fields: conflicts }); return { allowed: false, error: `El plugin ${id} entra en conflicto con ${patchedBy.get(conflicts[0])} durante ${hook}.` }; }
        for (const field of Object.keys(nextPatch)) patchedBy.set(field, id);
        Object.assign(patch, nextPatch);
      }
    } catch {
      await auditHook(env, id, "hook_failed", content, { hook });
      if (blockingHooks.has(hook)) return { allowed: false, error: `El plugin ${id} no cumplió el contrato durante ${hook}.` };
    }
  }
  return { allowed: true, patch };
}
