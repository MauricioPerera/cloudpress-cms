import { json, requireAdmin, sanitizeHtml } from "../../_shared.js";
import { defaults } from "../settings.js";

const slugify = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
const validUrl = (value) => /^\/(?!\/)|^https?:\/\//i.test(String(value || ""));
const validEmail = (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
const validDate = (value) => Boolean(value) && !Number.isNaN(Date.parse(value));
const asArray = (value) => Array.isArray(value) ? value : null;
const isoOr = (value, fallback) => validDate(value) ? new Date(value).toISOString() : fallback;
const settingLimits = { siteName: 80, tagline: 160, heroTitle: 160, heroText: 500, accentColor: 7 };

function cleanSetting(row) {
  const key = String(row?.setting_key || "");
  if (!Object.hasOwn(defaults, key) || !Object.hasOwn(settingLimits, key)) return null;
  const value = String(row?.setting_value || "").trim().slice(0, settingLimits[key]);
  if ((key === "siteName" || key === "heroTitle" || key === "heroText") && !value) return null;
  if (key === "accentColor" && !/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  return { key, value };
}

const cleanPayload = (payload) => {
  if (!payload || payload.format !== "cloudpress-export" || ![1, 2].includes(payload.version)) throw Error("El archivo no es una exportación CloudPress compatible.");
  const content = asArray(payload.content), terms = asArray(payload.terms), contentTerms = asArray(payload.contentTerms), menu = asArray(payload.menu);
  const comments = payload.version === 2 ? asArray(payload.comments) : [], revisions = payload.version === 2 ? asArray(payload.revisions) : [], rawSettings = payload.version === 2 ? asArray(payload.settings) : [];
  if (!content || !terms || !contentTerms || !menu || !comments || !revisions || !rawSettings) throw Error("La exportación no tiene la estructura esperada.");
  if (content.length > 200 || terms.length > 200 || contentTerms.length > 1000 || menu.length > 200 || comments.length > 1000 || revisions.length > 1000 || rawSettings.length > 5) throw Error("La exportación supera los límites de importación.");
  const contentSlugs = new Set(), termSlugs = new Set(), settingKeys = new Set(), settings = [];
  for (const item of content) {
    const slug = slugify(item?.slug || item?.title);
    if (!['post', 'page'].includes(item?.kind) || !String(item?.title || '').trim() || !slug) throw Error("Hay contenido inválido en la exportación.");
    if (contentSlugs.has(slug)) throw Error(`El slug de contenido '${slug}' está repetido en el archivo.`);
    contentSlugs.add(slug);
  }
  for (const term of terms) {
    const slug = slugify(term?.slug || term?.name);
    if (!['category', 'tag'].includes(term?.type) || !String(term?.name || '').trim() || !slug) throw Error("Hay términos inválidos en la exportación.");
    if (termSlugs.has(slug)) throw Error(`El slug de término '${slug}' está repetido en el archivo.`);
    termSlugs.add(slug);
  }
  for (const row of rawSettings) {
    const setting = cleanSetting(row);
    if (!setting) throw Error("Hay ajustes inválidos en la exportación.");
    if (settingKeys.has(setting.key)) throw Error(`El ajuste '${setting.key}' está repetido en el archivo.`);
    settingKeys.add(setting.key); settings.push(setting);
  }
  return { content, terms, contentTerms, menu, comments, revisions, settings };
};

async function availableSlug(db, table, seed, reserved) {
  let suffix = 0; let candidate = seed;
  while (reserved.has(candidate) || await db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(candidate).first()) {
    suffix += 1;
    candidate = `${seed.slice(0, Math.max(1, 96 - (`-importado-${suffix}`).length))}-importado-${suffix}`;
  }
  reserved.add(candidate);
  return candidate;
}

function validComment(row) {
  const name = String(row?.author_name || "").trim().slice(0, 80);
  const email = String(row?.author_email || "").trim().slice(0, 254);
  const body = String(row?.body || "").trim().slice(0, 2000);
  return name.length >= 2 && body.length >= 2 && validEmail(email) && ['pending', 'approved'].includes(row?.status) ? { name, email, body, status: row.status } : null;
}

function validRevision(row) {
  const title = String(row?.title || "").trim().slice(0, 180);
  const slug = slugify(row?.slug || title);
  if (!['post', 'page'].includes(row?.kind) || !title || !slug || !['draft', 'published'].includes(row?.status)) return null;
  return { kind: row.kind, title, slug, excerpt: String(row?.excerpt || "").slice(0, 500), body: sanitizeHtml(String(row?.body || "")).slice(0, 50000), status: row.status };
}

async function plan(env, payload) {
  const data = cleanPayload(payload); const contentMap = new Map(), termMap = new Map();
  const reservedContent = new Set(), reservedTerms = new Set();
  const result = { dryRun: true, created: { content: 0, terms: 0, menu: 0, relations: 0, comments: 0, revisions: 0, settings: data.settings.length }, reused: { terms: 0 }, renamed: { content: 0, terms: 0 }, skipped: { relations: 0, menu: 0, comments: 0, revisions: 0 }, details: [] };
  for (const term of data.terms) {
    const sourceSlug = slugify(term.slug || term.name);
    const existing = await env.DB.prepare("SELECT id, type, name, slug FROM taxonomy_terms WHERE slug = ?").bind(sourceSlug).first();
    if (existing && existing.type === term.type && existing.name === String(term.name).trim().slice(0, 120)) {
      termMap.set(sourceSlug, { id: existing.id, slug: existing.slug, create: false }); result.reused.terms += 1; continue;
    }
    const slug = await availableSlug(env.DB, "taxonomy_terms", sourceSlug, reservedTerms);
    termMap.set(sourceSlug, { slug, create: true, term }); result.created.terms += 1;
    if (slug !== sourceSlug) result.renamed.terms += 1;
  }
  for (const item of data.content) {
    const sourceSlug = slugify(item.slug || item.title); const slug = await availableSlug(env.DB, "content_items", sourceSlug, reservedContent);
    contentMap.set(sourceSlug, { slug, create: true, item }); result.created.content += 1;
    if (slug !== sourceSlug) result.renamed.content += 1;
  }
  for (const relation of data.contentTerms) {
    if (contentMap.has(slugify(relation?.content_slug)) && termMap.has(slugify(relation?.term_slug))) result.created.relations += 1;
    else result.skipped.relations += 1;
  }
  for (const item of data.menu) {
    if (String(item?.label || '').trim().slice(0, 120) && validUrl(item?.url)) result.created.menu += 1;
    else result.skipped.menu += 1;
  }
  for (const row of data.comments) {
    if (contentMap.has(slugify(row?.content_slug)) && validComment(row)) result.created.comments += 1;
    else result.skipped.comments += 1;
  }
  for (const row of data.revisions) {
    if (contentMap.has(slugify(row?.content_slug)) && validRevision(row)) result.created.revisions += 1;
    else result.skipped.revisions += 1;
  }
  return { result, data, contentMap, termMap };
}

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env, "import-export:manage");
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const payload = await request.json().catch(() => null);
  try {
    const { result, data, contentMap, termMap } = await plan(env, payload);
    if (payload?.dryRun) return json(result, 200, { "Cache-Control": "no-store" });
    const now = new Date().toISOString(), queries = [];
    for (const entry of termMap.values()) if (entry.create) queries.push(env.DB.prepare("INSERT INTO taxonomy_terms(type,name,slug) VALUES(?,?,?)").bind(entry.term.type, String(entry.term.name).trim().slice(0, 120), entry.slug));
    for (const entry of contentMap.values()) {
      const item = entry.item; const status = ['published', 'trash'].includes(item.status) ? item.status : 'draft';
      const publishedAt = status === 'published' ? isoOr(item.published_at, now) : null;
      const trashedFrom = status === 'trash' && ['draft', 'published'].includes(item.trashed_from_status) ? item.trashed_from_status : (status === 'trash' ? 'draft' : null);
      const trashedAt = status === 'trash' ? isoOr(item.trashed_at, now) : null;
      queries.push(env.DB.prepare("INSERT INTO content_items(kind,title,slug,excerpt,body,status,trashed_from_status,trashed_at,author_id,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(item.kind, String(item.title).trim().slice(0, 180), entry.slug, String(item.excerpt || '').slice(0, 500), sanitizeHtml(String(item.body || '')).slice(0, 50000), status, trashedFrom, trashedAt, admin.id, isoOr(item.created_at, now), isoOr(item.updated_at, now), publishedAt));
    }
    for (const relation of data.contentTerms) { const content = contentMap.get(slugify(relation?.content_slug)), term = termMap.get(slugify(relation?.term_slug)); if (content && term) queries.push(env.DB.prepare("INSERT OR IGNORE INTO content_terms(content_id,term_id) SELECT c.id,t.id FROM content_items c JOIN taxonomy_terms t WHERE c.slug=? AND t.slug=?").bind(content.slug, term.slug)); }
    for (const [index, item] of data.menu.entries()) if (String(item?.label || '').trim().slice(0, 120) && validUrl(item?.url)) queries.push(env.DB.prepare("INSERT INTO menu_items(label,url,position) VALUES(?,?,?)").bind(String(item.label).trim().slice(0, 120), String(item.url).trim().slice(0, 1000), Number.isInteger(item.position) ? item.position : index));
    for (const row of data.comments) {
      const content = contentMap.get(slugify(row?.content_slug)), comment = validComment(row);
      if (content && comment) queries.push(env.DB.prepare("INSERT INTO comments(content_id,author_name,author_email,body,status,created_at,updated_at) SELECT id,?,?,?,?,?,? FROM content_items WHERE slug=?").bind(comment.name, comment.email || null, comment.body, comment.status, isoOr(row.created_at, now), isoOr(row.updated_at, now), content.slug));
    }
    for (const row of data.revisions) {
      const content = contentMap.get(slugify(row?.content_slug)), revision = validRevision(row);
      if (content && revision) queries.push(env.DB.prepare("INSERT INTO content_revisions(content_id,kind,title,slug,excerpt,body,status,published_at,created_at) SELECT id,?,?,?,?,?,?,?,? FROM content_items WHERE slug=?").bind(revision.kind, revision.title, revision.slug, revision.excerpt, revision.body, revision.status, revision.status === 'published' ? isoOr(row.published_at, now) : null, isoOr(row.created_at, now), content.slug));
    }
    for (const setting of data.settings) queries.push(env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=excluded.updated_at").bind(setting.key, setting.value, now));
    if (queries.length) await env.DB.batch(queries);
    return json({ ...result, dryRun: false }, 201, { "Cache-Control": "no-store" });
  } catch (error) { return json({ error: error.message || "No se pudo importar el archivo." }, 400); }
}
