import { json, requireAdmin } from "../../_shared.js";
export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const [types, meta, actions, taxonomies, menus] = await env.DB.batch([
    env.DB.prepare("SELECT t.* FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.type_id"),
    env.DB.prepare("SELECT m.* FROM plugin_meta_definitions m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.scope,m.plugin_id,m.meta_key"),
    env.DB.prepare("SELECT a.* FROM plugin_actions a JOIN plugin_installations p ON p.plugin_id=a.plugin_id WHERE p.status='enabled' ORDER BY a.plugin_id,a.action_id"),
    env.DB.prepare("SELECT t.* FROM plugin_taxonomies t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.taxonomy_id"),
    env.DB.prepare("SELECT m.* FROM plugin_admin_menus m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.plugin_id,m.menu_id")
  ]);
  return json({ contentTypes: types.results, meta: meta.results, actions: actions.results, taxonomies: taxonomies.results, menus: menus.results }, 200, { "Cache-Control": "no-store" });
}
