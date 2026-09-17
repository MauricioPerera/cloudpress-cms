import { json, requireAdmin } from "../../../../../../_shared.js";

const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
async function taxonomy(env, pluginId, taxonomyId) { return env.DB.prepare("SELECT t.* FROM plugin_taxonomies t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.plugin_id=? AND t.taxonomy_id=?").bind(pluginId, taxonomyId).first(); }

export async function onRequestPut({ request, env, params }) {
  if (!await requireAdmin(request, env, "taxonomies:manage")) return json({ error: "Se requiere permiso de taxonomías" }, 403);
  const id = Number(params.termId), pluginId = String(params.pluginId || ""), taxonomyId = String(params.taxonomyId || "");
  if (!Number.isInteger(id) || id < 1) return json({ error: "Término inválido." }, 400);
  const definition = await taxonomy(env, pluginId, taxonomyId); if (!definition) return json({ error: "Taxonomía no disponible." }, 404);
  const current = await env.DB.prepare("SELECT id,name,slug,parent_id FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(id, pluginId, taxonomyId).first();
  if (!current) return json({ error: "Término no encontrado." }, 404);
  const body = await request.json().catch(() => null), name = String(body?.name ?? current.name).trim().slice(0, 120), slug = slugify(body?.slug ?? name);
  const parentId = body?.parentId === undefined ? current.parent_id : body.parentId === null ? null : Number(body.parentId);
  if (!name || !slug || (parentId !== null && (!Number.isInteger(parentId) || parentId < 1 || parentId === id))) return json({ error: "Datos de término inválidos." }, 400);
  if (parentId && !definition.hierarchical) return json({ error: "Esta taxonomía no admite jerarquía." }, 422);
  if (parentId) { const parent = await env.DB.prepare("SELECT 1 FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(parentId, pluginId, taxonomyId).first(); if (!parent) return json({ error: "Término padre inválido." }, 422); }
  try { await env.DB.prepare("UPDATE plugin_terms SET name=?,slug=?,parent_id=? WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(name, slug, parentId, id, pluginId, taxonomyId).run(); return json({ ok: true, id, name, slug, parentId }); }
  catch { return json({ error: "El slug ya existe en esta taxonomía." }, 409); }
}

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env, "taxonomies:manage")) return json({ error: "Se requiere permiso de taxonomías" }, 403);
  const id = Number(params.termId), pluginId = String(params.pluginId || ""), taxonomyId = String(params.taxonomyId || "");
  if (!Number.isInteger(id) || id < 1) return json({ error: "Término inválido." }, 400);
  const result = await env.DB.prepare("DELETE FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(id, pluginId, taxonomyId).run();
  if (!result.meta.changes) return json({ error: "Término no encontrado." }, 404);
  return json({ ok: true, removed: true });
}
