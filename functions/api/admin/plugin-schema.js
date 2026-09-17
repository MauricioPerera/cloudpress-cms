import { json, requireAdmin } from "../../_shared.js";
import { enabledPlugin } from "../../_plugins/host.js";
import { requestedLocale, translatePlugin } from "../../_plugins/i18n.js";
export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "content:manage")) return json({ error: "Se requiere permiso de contenido" }, 403);
  const locale = requestedLocale(new URL(request.url).searchParams.get("locale"));
  const [types, coreTypes, meta, actions, taxonomies, menus] = await env.DB.batch([
    env.DB.prepare("SELECT t.* FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.type_id"),
    env.DB.prepare("SELECT type_id,label,supports_json,created_at,updated_at FROM core_content_types ORDER BY label COLLATE NOCASE"),
    env.DB.prepare("SELECT m.* FROM plugin_meta_definitions m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.scope,m.plugin_id,m.meta_key"),
    env.DB.prepare("SELECT a.* FROM plugin_actions a JOIN plugin_installations p ON p.plugin_id=a.plugin_id WHERE p.status='enabled' ORDER BY a.plugin_id,a.action_id"),
    env.DB.prepare("SELECT t.* FROM plugin_taxonomies t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' ORDER BY t.plugin_id,t.taxonomy_id"),
    env.DB.prepare("SELECT m.* FROM plugin_admin_menus m JOIN plugin_installations p ON p.plugin_id=m.plugin_id WHERE p.status='enabled' ORDER BY m.plugin_id,m.menu_id")
  ]);
  const ids = new Set([types, meta, actions, taxonomies, menus].flatMap((result) => result.results.map((row) => row.plugin_id)));
  const plugins = new Map(await Promise.all([...ids].map(async (id) => [id, await enabledPlugin(env, id)])));
  const label = (row, section, idKey) => translatePlugin(plugins.get(row.plugin_id)?.manifest, locale, `${section}.${row[idKey]}`, row.label);
  const pluginTypes = types.results.map((row) => ({ ...row, source: "plugin", label: label(row, "contentTypes", "type_id") }));
  const ownTypes = coreTypes.results.map((row) => ({ ...row, source: "core", supports: JSON.parse(row.supports_json) }));
  return json({ locale, contentTypes: [...pluginTypes, ...ownTypes], meta: meta.results, actions: actions.results.map((row) => ({ ...row, label: label(row, "actions", "action_id") })), taxonomies: taxonomies.results.map((row) => ({ ...row, label: label(row, "taxonomies", "taxonomy_id") })), menus: menus.results.map((row) => ({ ...row, label: label(row, "menus", "menu_id") })) }, 200, { "Cache-Control": "no-store" });
}
