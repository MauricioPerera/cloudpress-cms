const FIELDS = ["title", "altText", "caption", "description", "creator", "license", "sourceUrl"];
const LIMITS = { title: 180, altText: 280, caption: 500, description: 2000, creator: 160, license: 160, sourceUrl: 300 };

const text = (value, limit) => String(value ?? "").trim().slice(0, limit);

export async function ensureMediaMetadataTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS media_metadata (media_key TEXT PRIMARY KEY CHECK(media_key LIKE 'media/%'),title TEXT NOT NULL DEFAULT '',alt_text TEXT NOT NULL DEFAULT '',caption TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',creator TEXT NOT NULL DEFAULT '',license TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}

export function mediaNameFromKey(key) {
  return String(key || "").replace(/^media\//, "");
}

export function defaultMediaMetadata(name = "") {
  return { title: text(mediaNameFromKey(name).replace(/\.[^.]+$/, ""), LIMITS.title), altText: "", caption: "", description: "", creator: "", license: "", sourceUrl: "" };
}

export function normalizeMediaMetadata(input, defaults = {}) {
  if (input === null || input === undefined) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Los metadatos de la imagen no son válidos.");
  for (const key of Object.keys(input)) if (!FIELDS.includes(key)) throw new Error(`Metadato no permitido: ${key}.`);
  const metadata = {};
  for (const key of FIELDS) metadata[key] = text(input[key] ?? defaults[key], LIMITS[key]);
  if (metadata.sourceUrl) {
    let source;
    try { source = new URL(metadata.sourceUrl); }
    catch { throw new Error("La URL de fuente no es válida."); }
    if (!/^https?:$/.test(source.protocol)) throw new Error("La URL de fuente debe usar HTTP o HTTPS.");
  }
  return metadata;
}

export async function mediaMetadataByKey(env, keys) {
  await ensureMediaMetadataTable(env);
  const unique = [...new Set(keys.filter((key) => /^media\/[^/]+$/.test(key)))];
  const metadata = new Map();
  for (let index = 0; index < unique.length; index += 100) {
    const group = unique.slice(index, index + 100);
    const result = await env.DB.prepare(`SELECT media_key,title,alt_text,caption,description,creator,license,source_url FROM media_metadata WHERE media_key IN (${group.map(() => "?").join(",")})`).bind(...group).all();
    for (const row of result.results) metadata.set(row.media_key, { title: row.title, altText: row.alt_text, caption: row.caption, description: row.description, creator: row.creator, license: row.license, sourceUrl: row.source_url });
  }
  return metadata;
}

export async function saveMediaMetadata(env, key, metadata) {
  await ensureMediaMetadataTable(env);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO media_metadata(media_key,title,alt_text,caption,description,creator,license,source_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(media_key) DO UPDATE SET title=excluded.title,alt_text=excluded.alt_text,caption=excluded.caption,description=excluded.description,creator=excluded.creator,license=excluded.license,source_url=excluded.source_url,updated_at=excluded.updated_at")
    .bind(key, metadata.title, metadata.altText, metadata.caption, metadata.description, metadata.creator, metadata.license, metadata.sourceUrl, now, now).run();
}

export async function deleteMediaMetadata(env, key) {
  await ensureMediaMetadataTable(env);
  await env.DB.prepare("DELETE FROM media_metadata WHERE media_key=?").bind(key).run();
}
