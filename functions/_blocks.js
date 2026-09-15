import { sanitizeHtml } from "./_shared.js";
import { enabledPlugin, validateInput } from "./_plugins/host.js";

const text = (value, limit = 12000) => String(value ?? "").trim().slice(0, limit);
const escape = (value) => text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const mediaPath = (value) => /^\/media\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,400}$/.test(String(value || ""));
const pluginBlockId = /^[a-z0-9][a-z0-9-]{2,47}--[a-z0-9][a-z0-9-]{1,47}$/;
const core = new Map([
  ["core/paragraph", { type: "core/paragraph", label: "Párrafo", icon: "¶", attributes: { type: "object", required: ["content"], additionalProperties: false, properties: { content: { type: "string", maxLength: 12000 } } } }],
  ["core/heading", { type: "core/heading", label: "Encabezado", icon: "H", attributes: { type: "object", required: ["content"], additionalProperties: false, properties: { content: { type: "string", maxLength: 500 }, level: { type: "number", minimum: 2, maximum: 3 } } } }],
  ["core/list", { type: "core/list", label: "Lista", icon: "≡", attributes: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "string", maxLength: 12000 }, ordered: { type: "boolean" } } } }],
  ["core/quote", { type: "core/quote", label: "Cita", icon: "❝", attributes: { type: "object", required: ["content"], additionalProperties: false, properties: { content: { type: "string", maxLength: 4000 }, citation: { type: "string", maxLength: 240 } } } }],
  ["core/image", { type: "core/image", label: "Imagen", icon: "▧", attributes: { type: "object", required: ["src", "alt"], additionalProperties: false, properties: { src: { type: "string", maxLength: 500 }, alt: { type: "string", maxLength: 500 }, caption: { type: "string", maxLength: 1000 } } } }],
  ["core/separator", { type: "core/separator", label: "Separador", icon: "—", attributes: { type: "object", additionalProperties: false, properties: {} } }],
  ["core/legacy", { type: "core/legacy", label: "Contenido HTML heredado", icon: "</>", attributes: { type: "object", required: ["html"], additionalProperties: false, properties: { html: { type: "string", maxLength: 50000 } } } }],
]);

export const emptyBlocksDocument = () => ({ version: 1, blocks: [{ id: crypto.randomUUID(), type: "core/paragraph", attributes: { content: "" } }] });

function coreHtml(type, attributes) {
  if (type === "core/paragraph") return `<p>${escape(attributes.content)}</p>`;
  if (type === "core/heading") return `<h${Number(attributes.level) === 3 ? 3 : 2}>${escape(attributes.content)}</h${Number(attributes.level) === 3 ? 3 : 2}>`;
  if (type === "core/list") { const tag = attributes.ordered ? "ol" : "ul"; const items = text(attributes.items).split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 100); return `<${tag}>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</${tag}>`; }
  if (type === "core/quote") return `<blockquote><p>${escape(attributes.content)}</p>${attributes.citation ? `<p>— ${escape(attributes.citation)}</p>` : ""}</blockquote>`;
  if (type === "core/image") return `<p><img src="${escape(attributes.src)}" alt="${escape(attributes.alt)}">${attributes.caption ? `<br><em>${escape(attributes.caption)}</em>` : ""}</p>`;
  if (type === "core/legacy") return sanitizeHtml(attributes.html);
  return "<p>***</p>";
}

function normalizedBlock(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.type !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(String(input.id || "")) || !input.attributes || typeof input.attributes !== "object" || Array.isArray(input.attributes)) throw new Error("Bloque inválido.");
  return { id: input.id, type: input.type, attributes: JSON.parse(JSON.stringify(input.attributes)) };
}

async function pluginDefinition(env, type) {
  const pluginId = type.split("--")[0];
  const plugin = await enabledPlugin(env, pluginId);
  const definition = plugin?.manifest.blocks?.find((item) => item.id === type);
  if (!definition || typeof plugin?.module?.blocks?.[definition.handler] !== "function") throw new Error("El bloque de plugin no está disponible.");
  return { plugin, definition };
}

export async function renderBlocksDocument(env, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 200) throw new Error("El documento de bloques es inválido.");
  const blocks = []; const html = [];
  for (const raw of value.blocks) {
    const block = normalizedBlock(raw);
    if (core.has(block.type)) {
      const verdict = validateInput(core.get(block.type).attributes, block.attributes);
      if (!verdict.valid) throw new Error(`Bloque ${block.type}: ${verdict.error}`);
      if (block.type === "core/image" && !mediaPath(block.attributes.src)) throw new Error("Las imágenes de bloques deben venir de la biblioteca de medios.");
      blocks.push(block); html.push(coreHtml(block.type, block.attributes)); continue;
    }
    if (!pluginBlockId.test(block.type)) throw new Error("Tipo de bloque no permitido.");
    const { definition, plugin } = await pluginDefinition(env, block.type);
    const verdict = validateInput(definition.attributes, block.attributes);
    if (!verdict.valid) throw new Error(`Bloque ${block.type}: ${verdict.error}`);
    const output = await plugin.module.blocks[definition.handler](Object.freeze(JSON.parse(JSON.stringify(block.attributes))));
    const fragment = typeof output === "string" ? output : output?.html;
    if (typeof fragment !== "string" || fragment.length > 20000) throw new Error(`El bloque ${block.type} no devolvió HTML válido.`);
    blocks.push(block); html.push(sanitizeHtml(fragment));
  }
  return { document: { version: 1, blocks }, html: sanitizeHtml(html.join("")) };
}

export async function availableBlocks(env) {
  const definitions = [...core.values()].filter((definition) => definition.type !== "core/legacy").map((definition) => ({ ...definition, source: "core" }));
  const installed = await env.DB.prepare("SELECT plugin_id FROM plugin_installations WHERE status='enabled' ORDER BY plugin_id").all();
  for (const { plugin_id: id } of installed.results) {
    const plugin = await enabledPlugin(env, id);
    for (const definition of plugin?.manifest.blocks || []) definitions.push({ type: definition.id, label: definition.label, icon: definition.icon || "▦", attributes: definition.attributes, source: "plugin", pluginId: id });
  }
  return definitions;
}

export async function ensureBlockTables(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS content_documents (content_id INTEGER PRIMARY KEY, blocks_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS content_document_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, content_id INTEGER NOT NULL, blocks_json TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_content_document_revisions_content_created ON content_document_revisions(content_id, created_at DESC)").run();
}

export async function loadBlocksDocument(env, contentId) {
  await ensureBlockTables(env);
  const row = await env.DB.prepare("SELECT blocks_json,updated_at FROM content_documents WHERE content_id=?").bind(contentId).first();
  return row ? { document: JSON.parse(row.blocks_json), updatedAt: row.updated_at } : null;
}

export async function saveBlocksDocument(env, contentId, document) {
  await ensureBlockTables(env);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO content_documents(content_id,blocks_json,updated_at) VALUES(?,?,?) ON CONFLICT(content_id) DO UPDATE SET blocks_json=excluded.blocks_json,updated_at=excluded.updated_at").bind(contentId, JSON.stringify(document), now).run();
}

export async function replaceBlocksDocument(env, contentId, document) {
  await ensureBlockTables(env);
  const current = await env.DB.prepare("SELECT blocks_json FROM content_documents WHERE content_id=?").bind(contentId).first();
  if (current) await env.DB.prepare("INSERT INTO content_document_revisions(content_id,blocks_json,created_at) VALUES(?,?,?)").bind(contentId, current.blocks_json, new Date().toISOString()).run();
  if (document) await saveBlocksDocument(env, contentId, document);
  else await env.DB.prepare("DELETE FROM content_documents WHERE content_id=?").bind(contentId).run();
}
