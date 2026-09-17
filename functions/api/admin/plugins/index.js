import { json, requireAdmin } from "../../../_shared.js";
import { validatePluginManifest } from "../../../_plugins/contract.js";
import { pluginRegistry, pluginRelease, pluginReleaseRegistry } from "../../../_plugins/registry.js";
import { applyPluginMigrations, ensurePluginReleaseTable, pluginAudit } from "../../../_plugins/host.js";
import { localizedManifest, requestedLocale } from "../../../_plugins/i18n.js";

function available(locale) { return [...pluginRegistry.values()].map(({ manifest }) => localizedManifest(manifest, locale)); }
function availableReleases() {
  return [...pluginReleaseRegistry.entries()].flatMap(([id, releases]) => [...releases.values()].map((entry) => ({
    id,
    version: entry.manifest.version,
    sourceHash: entry.verification.sourceHash,
    manifestHash: entry.verification.manifestHash,
    validatorVersion: entry.verification.validatorVersion,
    contractVersion: entry.manifest.contractVersion,
  }))).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}
async function audit(db, id, action, actor, details = {}) { await db.prepare("INSERT INTO plugin_audit_log(plugin_id,action,actor_id,details_json) VALUES(?,?,?,?)").bind(id, action, actor, JSON.stringify(details)).run(); }
async function conflicts(env, entry) {
  const collisions = [];
  for (const type of entry.manifest.contentTypes || []) {
    const core = await env.DB.prepare("SELECT type_id FROM core_content_types WHERE type_id=? LIMIT 1").bind(type.id).first();
    if (core) collisions.push({ kind: "contentType", id: type.id, source: "core" });
    const existing = await env.DB.prepare("SELECT plugin_id FROM plugin_content_types WHERE type_id=? AND plugin_id<>? LIMIT 1").bind(type.id, entry.manifest.id).first();
    if (existing) collisions.push({ kind: "contentType", id: type.id, pluginId: existing.plugin_id });
  }
  for (const meta of [...(entry.manifest.contentMeta || []).map((item) => ({ ...item, scope: "content" })), ...(entry.manifest.userMeta || []).map((item) => ({ ...item, scope: "user" }))]) {
    const existing = await env.DB.prepare("SELECT plugin_id FROM plugin_meta_definitions WHERE scope=? AND meta_key=? AND plugin_id<>? LIMIT 1").bind(meta.scope, meta.key, entry.manifest.id).first();
    if (existing) collisions.push({ kind: "meta", scope: meta.scope, key: meta.key, pluginId: existing.plugin_id });
  }
  return collisions;
}

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "plugins:manage")) return json({ error: "Se requiere permiso de plugins" }, 403);
  await ensurePluginReleaseTable(env);
  const installed = await env.DB.prepare("SELECT plugin_id,status,installed_at,updated_at FROM plugin_installations ORDER BY plugin_id").all();
  const releases = await env.DB.prepare("SELECT plugin_id,version,source_hash,manifest_hash,validator_version,installed_at FROM plugin_releases WHERE is_current=1 ORDER BY plugin_id").all();
  const activeReleases = await env.DB.prepare("SELECT a.plugin_id,a.source_hash,a.activated_by,a.activated_at,r.version,r.manifest_hash,r.validator_version FROM plugin_active_releases a LEFT JOIN plugin_releases r ON r.plugin_id=a.plugin_id AND r.source_hash=a.source_hash ORDER BY a.plugin_id").all();
  const locale = requestedLocale(new URL(request.url).searchParams.get("locale"));
  return json({ contractVersion: "cloudpress-plugin/v3", locale, available: available(locale), availableReleases: availableReleases(), installed: installed.results, releases: releases.results, activeReleases: activeReleases.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const body = await request.json().catch(() => null); const id = String(body?.id || ""); const requestedSourceHash = body?.sourceHash;
  if (requestedSourceHash !== undefined && (typeof requestedSourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(requestedSourceHash))) return json({ error: "sourceHash debe ser un hash SHA-256 atestado." }, 422);
  const current = pluginRegistry.get(id);
  if (!current) return json({ error: "El plugin no está incluido en esta versión desplegada." }, 404);
  const entry = requestedSourceHash ? pluginRelease(id, requestedSourceHash) : current;
  if (!entry) return json({ error: "La versión solicitada no está incluida y validada en este despliegue." }, 404);
  if (!entry.verification?.valid || entry.verification?.validatorVersion !== "cloudpress-plugin-validator/1" || !/^sha256:[a-f0-9]{64}$/.test(entry.verification?.sourceHash || "")) return json({ error: "El plugin no tiene una atestación de validación local válida; vuelve a compilar y desplegar." }, 409);
  const verdict = validatePluginManifest(entry.manifest);
  if (!verdict.valid) { await audit(env.DB, id, "validation_failed", admin.id, { errors: verdict.errors }); return json({ error: "El contrato del plugin es inválido.", errors: verdict.errors }, 400); }
  const declaredRoles = [...new Set((entry.manifest.capabilities || []).flatMap((capability) => capability.defaultRoles || []))];
  if (declaredRoles.length) {
    const knownRoles = new Set((await env.DB.prepare("SELECT id FROM roles").all()).results.map((role) => role.id));
    const missingRoles = declaredRoles.filter((role) => !knownRoles.has(role));
    if (missingRoles.length) return json({ error: "El plugin referencia roles que no existen.", missingRoles }, 422);
  }
  await ensurePluginReleaseTable(env);
  const previous = await env.DB.prepare("SELECT source_hash FROM plugin_active_releases WHERE plugin_id=?").bind(id).first();
  const collision = await conflicts(env, entry);
  if (collision.length) { await audit(env.DB, id, "installation_conflict", admin.id, { collision }); return json({ error: "El plugin entra en conflicto con una extensión instalada.", collision }, 409); }
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO plugin_installations(plugin_id,manifest_json,status,installed_by,installed_at,updated_at) VALUES(?,?, 'enabled', ?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET manifest_json=excluded.manifest_json,status='enabled',installed_by=excluded.installed_by,updated_at=excluded.updated_at").bind(id, JSON.stringify(entry.manifest), admin.id, now, now).run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM plugin_content_types WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_meta_definitions WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_actions WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_taxonomies WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_admin_menus WHERE plugin_id=?").bind(id), env.DB.prepare("DELETE FROM plugin_capabilities WHERE plugin_id=?").bind(id),
    ...(entry.manifest.contentTypes || []).map((x) => env.DB.prepare("INSERT INTO plugin_content_types(plugin_id,type_id,label,supports_json,public_api) VALUES(?,?,?,?,?)").bind(id,x.id,x.label,JSON.stringify(x.supports),x.publicApi ? 1 : 0)),
    ...(entry.manifest.contentMeta || []).map((x) => env.DB.prepare("INSERT INTO plugin_meta_definitions(plugin_id,scope,meta_key,value_type,required,schema_json) VALUES(?,?,?,?,?,?)").bind(id,'content',x.key,x.type,x.required?1:0,JSON.stringify(x.schema||{}))),
    ...(entry.manifest.userMeta || []).map((x) => env.DB.prepare("INSERT INTO plugin_meta_definitions(plugin_id,scope,meta_key,value_type,required,schema_json) VALUES(?,?,?,?,?,?)").bind(id,'user',x.key,x.type,x.required?1:0,JSON.stringify(x.schema||{}))),
    ...(entry.manifest.actions || []).map((x) => env.DB.prepare("INSERT INTO plugin_actions(plugin_id,action_id,label,entity_scope) VALUES(?,?,?,?)").bind(id,x.id,x.label,x.scope)),
    ...(entry.manifest.taxonomies || []).map((x) => env.DB.prepare("INSERT INTO plugin_taxonomies(plugin_id,taxonomy_id,label,hierarchical,object_types_json) VALUES(?,?,?,?,?)").bind(id,x.id,x.label,x.hierarchical?1:0,JSON.stringify(x.objectTypes))),
    ...(entry.manifest.menus || []).map((x) => env.DB.prepare("INSERT INTO plugin_admin_menus(plugin_id,menu_id,label,view_id,capability) VALUES(?,?,?,?,?)").bind(id,x.id,x.label,x.view,x.capability||'admin')),
    ...(entry.manifest.capabilities || []).flatMap((x) => [env.DB.prepare("INSERT INTO plugin_capabilities(plugin_id,capability_id,label) VALUES(?,?,?)").bind(id,x.id,x.label), ...x.defaultRoles.map((role) => env.DB.prepare("INSERT INTO plugin_role_capabilities(plugin_id,capability_id,role) VALUES(?,?,?)").bind(id,x.id,role))])
  ]);
  const migrations = await applyPluginMigrations(env, entry, admin);
  await env.DB.batch([
    env.DB.prepare("UPDATE plugin_releases SET is_current=0 WHERE plugin_id=?").bind(id),
    env.DB.prepare("INSERT INTO plugin_releases(plugin_id,source_hash,manifest_hash,validator_version,version,installed_by,installed_at,is_current) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(plugin_id,source_hash) DO UPDATE SET manifest_hash=excluded.manifest_hash,validator_version=excluded.validator_version,version=excluded.version,installed_by=excluded.installed_by,installed_at=excluded.installed_at,is_current=1").bind(id, entry.verification.sourceHash, entry.verification.manifestHash, entry.verification.validatorVersion, entry.manifest.version, admin.id, now),
    env.DB.prepare("INSERT INTO plugin_active_releases(plugin_id,source_hash,activated_by,activated_at) VALUES(?,?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET source_hash=excluded.source_hash,activated_by=excluded.activated_by,activated_at=excluded.activated_at").bind(id, entry.verification.sourceHash, admin.id, now)
  ]);
  const action = previous?.source_hash && previous.source_hash !== entry.verification.sourceHash ? "release_changed" : "installed";
  await audit(env.DB, id, action, admin.id, { version: entry.manifest.version, requestedSourceHash: requestedSourceHash || null, verification: entry.verification });
  return json({ ok: true, id, status: "enabled", verdict, verification: entry.verification, migrations, selectedRelease: { version: entry.manifest.version, sourceHash: entry.verification.sourceHash } }, 201);
}
