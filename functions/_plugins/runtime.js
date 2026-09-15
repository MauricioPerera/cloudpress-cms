import { pluginRegistry } from "./registry.js";

const allowedPatch = new Set(["title", "slug", "excerpt", "body", "status"]);

function cleanPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => allowedPatch.has(key) && typeof value === "string"));
}

export async function runPluginHook(env, hook, content) {
  const active = await env.DB.prepare("SELECT plugin_id FROM plugin_installations WHERE status = 'enabled' ORDER BY plugin_id").all();
  const patch = {};
  for (const { plugin_id: id } of active.results) {
    const plugin = pluginRegistry.get(id);
    const handler = plugin?.hooks?.[hook];
    if (!handler) continue;
    try {
      const result = await handler(Object.freeze({ ...content, ...patch }));
      if (result?.allow === false) return { allowed: false, error: `El plugin ${id} bloqueó esta operación.` };
      Object.assign(patch, cleanPatch(result?.patch));
    } catch {
      return { allowed: false, error: `El plugin ${id} no cumplió el contrato durante ${hook}.` };
    }
  }
  return { allowed: true, patch };
}
