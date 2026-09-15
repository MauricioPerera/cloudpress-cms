import { json, requireAdmin } from "../../../_shared.js";
import { validatePluginManifest } from "../../../_plugins/contract.js";
import { pluginRegistry } from "../../../_plugins/registry.js";
import { applyPluginMigrations, pluginAudit } from "../../../_plugins/host.js";

function available() { return [...pluginRegistry.values()].map(({ manifest }) => manifest); }
async function audit(db, id, action, actor, details = {}) { await db.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(id, action, actor, JSON.stringify(details)).run(); }

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const installed = await env.DB.prepare("SELECT plugin_id,status,installed_at,updated_at FROM plugin_installations ORDER BY plugin_id").all();
  return json({ contractVersion: "cloudpress-plugin/v1", available: available(), installed: installed.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env); if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const body = await request.json().catch(() => null); const id = String(body?.id || ""); const entry = pluginRegistry.get(id);
  if (!entry) return json({ error: "El plugin no está incluido en esta versión desplegada." }, 404);
  const verdict = validatePluginManifest(entry.manifest);
  if (!verdict.valid) { await audit(env.DB, id, "validation_failed", admin.id, { errors: verdict.errors }); return json({ error: "El contrato del plugin es inválido.", errors: verdict.errors }, 400); }
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO plugin_installations(plugin_id,manifest_json,status,installed_by,installed_at,updated_at) VALUES(?,?, 'enabled', ?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET manifest_json=excluded.manifest_json,status='enabled',installed_by=excluded.installed_by,updated_at=excluded.updated_at").bind(id, JSON.stringify(entry.manifest), admin.id, now, now).run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM plugin_content_types WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_meta_definitions WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_actions WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_taxonomies WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_admin_menus WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_capabilities WHERE plugin_id=?").bind(id),
    ...(entry.manifest.contentTypes || []).map((x) => env.DB.prepare("INSERT INTO plugin_content_types(plugin_id,type_id,label,supports_json) VALUES(?,?,?,?)").bind(id,x.id,x.label,JSON.stringify(x.supports))),
    ...(entry.manifest.contentMeta || []).map((x) => env.DB.prepare("INSERT INTO plugin_meta_definitions(plugin_id,scope,meta_key,value_type,required,schema_json) VALUES(?,?,?,?,?,?)").bind(id,'content',x.key,x.type,x.required?1:0,JSON.stringify(x.schema||{}))),
    ...(entry.manifest.userMeta || []).map((x) => env.DB.prepare("INSERT INTO plugin_meta_definitions(plugin_id,scope,meta_key,value_type,required,schema_json) VALUES(?,?,?,?,?,?)").bind(id,'user',x.key,x.type,x.required?1:0,JSON.stringify(x.schema||{}))),
    ...(entry.manifest.actions || []).map((x) => env.DB.prepare("INSERT INTO plugin_actions(plugin_id,action_id,label,entity_scope) VALUES(?,?,?,?)").bind(id,x.id,x.label,x.scope)),
    ...(entry.manifest.taxonomies || []).map((x) => env.DB.prepare("INSERT INTO plugin_taxonomies(plugin_id,taxonomy_id,label,hierarchical,object_types_json) VALUES(?,?,?,?,?)").bind(id,x.id,x.label,x.hierarchical?1:0,JSON.stringify(x.objectTypes))),
    ...(entry.manifest.menus || []).map((x) => env.DB.prepare("INSERT INTO plugin_admin_menus(plugin_id,menu_id,label,view_id,capability) VALUES(?,?,?,?,?)").bind(id,x.id,x.label,x.view,x.capability||'admin')),
    ...(entry.manifest.capabilities || []).flatMap((x) => [env.DB.prepare("INSERT INTO plugin_capabilities(plugin_id,capability_id,label) VALUES(?,?,?)").bind(id,x.id,x.label), ...x.defaultRoles.map((role) => env.DB.prepare("INSERT INTO plugin_role_capabilities(plugin_id,capability_id,role) VALUES(?,?,?)").bind(id,x.id,role))])
  ]);
  const migrations = await applyPluginMigrations(env, entry, admin);
  await audit(env.DB, id, "installed", admin.id, { version: entry.manifest.version });
  return json({ ok: true, id, status: "enabled", verdict, migrations }, 201);
}
