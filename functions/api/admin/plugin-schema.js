import { json, requireAdmin } from "../../_shared.js";
import { pluginRegistry } from "../../_plugins/registry.js";
import { requestedLocale, translatePlugin } from "../../_plugins/i18n.js";
export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const locale = requestedLocale(new URL(request.url).searchParams.get("locale"));
  const label = (row, section, idKey) => translatePlugin(pluginRegistry.get(row.plugin_id)?.manifest, locale, `${section}.${row[idKey]}`, row.label);
  const [types, meta, actions, taxonomies, menus] = await env.DB.batch([
    env.DB.prepare("SELECT t.* FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.type_id"),
    env.DB.prepare("SELECT m.* FROM plugin_meta_definitions m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.scope,m.plugin_id,m.meta_key"),
    env.DB.prepare("SELECT a.* FROM plugin_actions a JOIN plugin_installations p ON p.plugin_id=a.plugin_id WHERE p.status='enabled' ORDER BY a.plugin_id,a.action_id"),
    env.DB.prepare("SELECT t.* FROM plugin_taxonomies t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.taxonomy_id"),
    env.DB.prepare("SELECT m.* FROM plugin_admin_menus m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.plugin_id,m.menu_id")
  ]);
  return json({ locale, contentTypes: types.results.map((row) => ({ ...row, label: label(row, "contentTypes", "type_id") })), meta: meta.results, actions: actions.results.map((row) => ({ ...row, label: label(row, "actions", "action_id") })), taxonomies: taxonomies.results.map((row) => ({ ...row, label: label(row, "taxonomies", "taxonomy_id") })), menus: menus.results.map((row) => ({ ...row, label: label(row, "menus", "menu_id") })) }, 200, { "Cache-Control": "no-store" });
}
