import { json, requireAdmin } from "../../../../../_shared.js";

const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
async function taxonomy(env, pluginId, taxonomyId) { return env.DB.prepare("SELECT t.* FROM plugin_taxonomies t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.plugin_id=? AND t.taxonomy_id=?").bind(pluginId, taxonomyId).first(); }

export async function onRequestGet({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const pluginId = String(params.pluginId || ""), taxonomyId = String(params.taxonomyId || ""); if (!await taxonomy(env, pluginId, taxonomyId)) return json({ error: "Taxonomía no disponible." }, 404);
  const rows = await env.DB.prepare("SELECT id,name,slug,parent_id,created_at FROM plugin_terms WHERE plugin_id=? AND taxonomy_id=? ORDER BY name LIMIT 200").bind(pluginId, taxonomyId).all();
  return json({ items: rows.results }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env); if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const pluginId = String(params.pluginId || ""), taxonomyId = String(params.taxonomyId || ""), definition = await taxonomy(env, pluginId, taxonomyId); if (!definition) return json({ error: "Taxonomía no disponible." }, 404);
  const body = await request.json().catch(() => null), name = String(body?.name || "").trim().slice(0, 120), slug = slugify(body?.slug || name), parentId = Number(body?.parentId);
  if (!name || !slug) return json({ error: "Nombre o slug inválido." }, 400);
  if (parentId && !definition.hierarchical) return json({ error: "Esta taxonomía no admite jerarquía." }, 422);
  if (parentId) { const parent = await env.DB.prepare("SELECT 1 FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(parentId, pluginId, taxonomyId).first(); if (!parent) return json({ error: "Término padre inválido." }, 422); }
  try { const result = await env.DB.prepare("INSERT INTO plugin_terms(plugin_id,taxonomy_id,name,slug,parent_id) VALUES(?,?,?,?,?)").bind(pluginId, taxonomyId, name, slug, parentId || null).run(); return json({ ok: true, id: result.meta.last_row_id, name, slug, parentId: parentId || null }, 201); }
  catch { return json({ error: "El slug ya existe en esta taxonomía." }, 409); }
}
