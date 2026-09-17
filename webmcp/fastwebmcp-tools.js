import { z } from "zod";

let agentApi = null;
export function useAgentApi(request) { agentApi = request; }
const api = async (path, method = "GET", body) => {
  if (agentApi) return agentApi(path, method, body);
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: "Respuesta inválida" }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};
const blockDocument = z.object({ version: z.literal(1), blocks: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), type: z.string().min(3).max(96), attributes: z.record(z.string(), z.unknown()) }).strict()).max(200) }).strict();

const visible = (message) => {
  window.CloudPressUI?.toast(message);
  window.dispatchEvent(new CustomEvent("cloudpress:webmcp-action", { detail: { message } }));
};

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_DATA_URL = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const mediaMetadataSchema = z.object({
  title: z.string().trim().max(180).optional(),
  altText: z.string().trim().max(280).optional(),
  caption: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  creator: z.string().trim().max(160).optional(),
  license: z.string().trim().max(160).optional(),
  sourceUrl: z.string().trim().max(300).regex(/^https?:\/\//, "La URL de fuente debe usar HTTP o HTTPS.").optional(),
}).strict();

function imageFileFromDataUrl(dataUrl, requestedName) {
  const match = MEDIA_DATA_URL.exec(dataUrl);
  if (!match) throw new Error("La imagen debe ser un data URL PNG, JPG, GIF o WebP codificado en Base64.");
  let binary;
  try { binary = atob(match[2]); }
  catch { throw new Error("La imagen Base64 no es válida."); }
  if (!binary.length || binary.length > MAX_MEDIA_BYTES) throw new Error("La imagen debe pesar entre 1 byte y 10 MB.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const name = String(requestedName || "imagen").trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "imagen";
  return new File([bytes], name, { type: match[1] });
}

async function uploadMedia({ filename, dataUrl, metadata }) {
  if (agentApi) {
    const data = await api("/api/admin/media-agent", "POST", { filename, dataUrl, metadata });
    const name = String(data.key || "").replace(/^media\//, "") || filename;
    visible(`Imagen subida a la biblioteca: ${name}.`);
    return { key: data.key, name, url: data.url, ...(data.metadata ? { metadata: data.metadata } : {}) };
  }
  const file = imageFileFromDataUrl(dataUrl, filename);
  const form = new FormData();
  form.append("file", file);
  if (metadata) form.append("metadata", JSON.stringify(metadata));
  const response = await fetch("/api/admin/media", { method: "POST", body: form });
  const data = await response.json().catch(() => ({ error: "Respuesta inválida" }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  const name = String(data.key || "").replace(/^media\//, "") || file.name;
  visible(`Imagen subida a la biblioteca: ${name}.`);
  return { key: data.key, name, url: data.url, size: file.size, contentType: file.type, ...(data.metadata ? { metadata: data.metadata } : {}) };
}

export const reversibleTools = [
  {
    name: "cloudpress_read_admin_state",
    title: "Consultar estado de CloudPress",
    description: "Consulta contenido, usuarios, medios, taxonomías, bloques disponibles, esquema activo de plugins o metadatos antes de proponer un cambio. Devuelve el estado actual y no modifica el sitio.",
    inputSchema: z.object({ resource: z.enum(["content", "users", "taxonomies", "menu", "plugins", "media", "plugin_schema", "blocks", "metadata"]), kind: z.enum(["post", "page"]).optional(), status: z.enum(["active", "trash"]).optional(), contentType: z.string().max(48).optional(), scope: z.enum(["content", "user"]).optional(), entityId: z.number().int().positive().optional() }).strict(),
    annotations: { readOnlyHint: true },
    async execute({ resource, kind, status, contentType, scope, entityId }) {
      if (resource === "content") {
        const params = new URLSearchParams(); if (kind) params.set("kind", kind); if (status === "trash") params.set("status", "trash"); if (contentType) params.set("contentType", contentType);
        const data = await api(`/api/admin/entries?${params}`); return { resource, items: data.items, note: data.items.length ? undefined : "No hay contenido que coincida." };
      }
      if (resource === "plugin_schema") return { resource, ...await api("/api/admin/plugin-schema") };
      if (resource === "blocks") return { resource, ...await api(`/api/admin/blocks${entityId ? `?contentId=${entityId}` : ""}`) };
      if (resource === "metadata") {
        if (!scope || !entityId) throw new Error("Indica scope y entityId para consultar metadatos.");
        return { resource, ...await api(`/api/admin/plugin-meta?scope=${encodeURIComponent(scope)}&id=${entityId}`) };
      }
      const routes = { users: "/api/admin/users", taxonomies: "/api/admin/taxonomies", menu: "/api/admin/menus", plugins: "/api/admin/plugins", media: "/api/admin/media" };
      return { resource, ...await api(routes[resource]) };
    },
  },
  {
    name: "cloudpress_create_draft",
    title: "Crear borrador",
    description: "Crea como borrador una entrada, página o tipo de contenido declarado por un plugin. Úsala para preparar contenido sin publicarlo; el usuario lo revisa y publica manualmente.",
    inputSchema: z.object({ kind: z.enum(["post", "page"]), contentType: z.string().max(48).optional(), title: z.string().min(1).max(180), slug: z.string().max(96).optional(), excerpt: z.string().max(500).optional(), body: z.string().max(50000).optional(), blocks: blockDocument.optional(), termIds: z.array(z.number().int().positive()).max(100).optional(), pluginTermIds: z.array(z.number().int().positive()).max(100).optional() }).strict(),
    async execute({ kind, contentType, title, slug, excerpt, body, blocks, termIds, pluginTermIds }) {
      const data = await api("/api/admin/entries", "POST", { kind, contentType, title, slug, excerpt, body, blocks, termIds, pluginTermIds, status: "draft" });
      visible(`Borrador creado: ${title}.`); return { id: data.id, status: "draft", title };
    },
  },
  {
    name: "cloudpress_update_content",
    title: "Actualizar contenido",
    description: "Actualiza cualquier entrada, página o tipo de contenido activo y conserva una revisión previa. Con status publicado y publishedAt futuro, programa la publicación. Úsala para correcciones que puedan revertirse desde CloudPress.",
    inputSchema: z.object({ id: z.number().int().positive(), kind: z.enum(["post", "page"]).optional(), contentType: z.string().max(48).optional(), title: z.string().min(1).max(180).optional(), slug: z.string().max(96).optional(), excerpt: z.string().max(500).optional(), body: z.string().max(50000).optional(), blocks: blockDocument.optional(), status: z.enum(["draft", "published"]).optional(), publishedAt: z.string().datetime({ offset: true }).nullable().optional(), termIds: z.array(z.number().int().positive()).max(100).optional(), pluginTermIds: z.array(z.number().int().positive()).max(100).optional() }).strict(),
    async execute({ id, ...changes }) {
      if (!Object.keys(changes).length) throw new Error("Indica al menos un cambio.");
      const data = await api(`/api/admin/entries/${id}`, "PATCH", changes); visible(data.scheduled ? `Contenido ${id} programado; hay una revisión previa disponible.` : `Contenido ${id} actualizado; hay una revisión previa disponible.`); return { id, updated: true, scheduled: Boolean(data.scheduled), publishedAt: data.publishedAt || null, reversibleVia: "revisiones" };
    },
  },
  {
    name: "cloudpress_trash_content",
    title: "Enviar contenido a Papelera",
    description: "Envía contenido a Papelera en lugar de borrarlo. Úsala cuando el usuario quiera retirar una entrada o página de forma reversible.",
    inputSchema: z.object({ id: z.number().int().positive() }),
    async execute({ id }) { const data = await api(`/api/admin/entries/${id}`, "DELETE"); visible(`Contenido ${id} enviado a Papelera.`); return { id, status: "trash", reversible: true, ...data }; },
  },
  {
    name: "cloudpress_restore_content",
    title: "Restaurar contenido de Papelera",
    description: "Restaura contenido que está en Papelera. Úsala cuando el usuario quiera recuperar una eliminación reversible.",
    inputSchema: z.object({ id: z.number().int().positive() }),
    async execute({ id }) { const data = await api(`/api/admin/trash/${id}`, "POST"); visible(`Contenido ${id} restaurado.`); return { id, restored: true, ...data }; },
  },
  {
    name: "cloudpress_set_user_active",
    title: "Activar o desactivar usuario",
    description: "Activa o desactiva una cuenta sin eliminarla. Úsala para retirar o devolver acceso de forma reversible.",
    inputSchema: z.object({ id: z.number().int().positive(), active: z.boolean() }),
    async execute({ id, active }) { await api(`/api/admin/users/${id}/active`, "POST", { active }); visible(`Usuario ${id} ${active ? "activado" : "desactivado"}.`); return { id, active, reversible: true }; },
  },
  {
    name: "cloudpress_manage_navigation",
    title: "Crear o editar taxonomía y menú",
    description: "Crea o edita categorías, etiquetas o enlaces de menú. No elimina registros.",
    inputSchema: z.object({ resource: z.enum(["taxonomy", "menu"]), action: z.enum(["create", "update"]), id: z.number().int().positive().optional(), type: z.enum(["category", "tag"]).optional(), name: z.string().min(1).max(120).optional(), label: z.string().min(1).max(80).optional(), url: z.string().min(1).max(300).optional(), position: z.number().optional() }),
    async execute(input) {
      const isTaxonomy = input.resource === "taxonomy";
      const path = isTaxonomy ? "/api/admin/taxonomies" : "/api/admin/menus";
      const body = isTaxonomy ? { type: input.type, name: input.name } : { label: input.label, url: input.url, position: input.position ?? 0 };
      if (input.action === "update") { if (!input.id) throw new Error("Se requiere id para editar."); await api(`${path}?id=${input.id}`, "PUT", body); visible(`${isTaxonomy ? "Taxonomía" : "Enlace"} actualizado.`); return { id: input.id, updated: true }; }
      const data = await api(path, "POST", body); visible(`${isTaxonomy ? "Taxonomía" : "Enlace"} creado.`); return { id: data.id, created: true };
    },
  },
  {
    name: "cloudpress_manage_terms",
    title: "Gestionar términos y taxonomías",
    description: "Consulta, crea o actualiza categorías, etiquetas y términos de taxonomías declaradas por plugins. Para eliminar un término, usa la acción sensible de CloudPress.",
    inputSchema: z.object({ scope: z.enum(["core", "plugin"]), action: z.enum(["list", "create", "update"]), id: z.number().int().positive().optional(), type: z.enum(["category", "tag"]).optional(), pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/).optional(), taxonomyId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/).optional(), name: z.string().min(1).max(120).optional(), slug: z.string().max(96).optional(), parentId: z.number().int().positive().nullable().optional() }).strict(),
    async execute(input) {
      if (input.scope === "core") {
        if (input.action === "list") return { scope: "core", ...await api("/api/admin/taxonomies") };
        if (!input.type || !input.name) throw new Error("Indica type y name para el término base.");
        const body = { type: input.type, name: input.name, slug: input.slug };
        if (input.action === "update") { if (!input.id) throw new Error("Se requiere id para editar."); await api(`/api/admin/taxonomies?id=${input.id}`, "PUT", body); visible("Término actualizado."); return { id: input.id, updated: true }; }
        const data = await api("/api/admin/taxonomies", "POST", body); visible("Término creado."); return { id: data.id, created: true };
      }
      if (!input.pluginId || !input.taxonomyId) throw new Error("Indica pluginId y taxonomyId para el término de plugin.");
      const base = `/api/admin/plugins/${encodeURIComponent(input.pluginId)}/taxonomies/${encodeURIComponent(input.taxonomyId)}`;
      if (input.action === "list") return { scope: "plugin", pluginId: input.pluginId, taxonomyId: input.taxonomyId, ...await api(base) };
      if (!input.name) throw new Error("Indica name para el término de plugin.");
      const body = { name: input.name, slug: input.slug, parentId: input.parentId };
      if (input.action === "update") { if (!input.id) throw new Error("Se requiere id para editar."); await api(`${base}/${input.id}`, "PUT", body); visible("Término de plugin actualizado."); return { id: input.id, updated: true }; }
      const data = await api(base, "POST", body); visible("Término de plugin creado."); return { id: data.id, created: true };
    },
  },
  {
    name: "cloudpress_manage_meta",
    title: "Gestionar metadatos declarados",
    description: "Consulta o actualiza un metadato de contenido o usuario declarado por un plugin activo. Consulta antes cloudpress_read_admin_state con plugin_schema para respetar su tipo y reglas. Para eliminar un valor, usa la acción sensible.",
    inputSchema: z.object({ action: z.enum(["list", "upsert"]), scope: z.enum(["content", "user"]), entityId: z.number().int().positive(), key: z.string().regex(/^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/).optional(), value: z.unknown().optional() }).strict(),
    async execute({ action, scope, entityId, key, value }) {
      if (action === "list") return { scope, entityId, ...await api(`/api/admin/plugin-meta?scope=${encodeURIComponent(scope)}&id=${entityId}`) };
      if (!key || value === undefined) throw new Error("Indica key y value para actualizar el metadato.");
      const data = await api("/api/admin/plugin-meta", "PUT", { scope, id: entityId, key, value });
      visible(`Metadato actualizado: ${key}.`);
      return data;
    },
  },
  {
    name: "cloudpress_install_plugin",
    title: "Instalar y activar plugin validado",
    description: "Instala y activa la versión actual o una versión archivada incluida estáticamente en el despliegue. Antes de indicar sourceHash, lee availableReleases en el estado administrativo y confirma que es el hash atestado deseado; no acepta URLs, ZIP ni código de terceros en tiempo de ejecución.",
    inputSchema: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional() }).strict(),
    async execute({ id, sourceHash }) {
      const data = await api("/api/admin/plugins", "POST", { id, ...(sourceHash ? { sourceHash } : {}) });
      visible(`Plugin ${id} instalado y activado.`);
      return { id: data.id, status: data.status, verification: data.verification, selectedRelease: data.selectedRelease, migrations: data.migrations, installed: true };
    },
  },
  {
    name: "cloudpress_set_plugin_state",
    title: "Activar o desactivar plugin",
    description: "Activa o desactiva un plugin instalado de forma reversible. No desinstala plugins.",
    inputSchema: z.object({ id: z.string().min(1).max(48), status: z.enum(["enabled", "disabled"]) }),
    async execute({ id, status }) { await api(`/api/admin/plugins/${encodeURIComponent(id)}`, "PATCH", { status }); visible(`Plugin ${id} ${status === "enabled" ? "activado" : "desactivado"}.`); return { id, status, reversible: true }; },
  },
  {
    name: "cloudpress_upload_media",
    title: "Subir imagen a la biblioteca",
    description: "Carga una imagen ya generada localmente a la biblioteca de CloudPress cuando el usuario haya aprobado usarla. Acepta sólo un data URL Base64 PNG, JPG, GIF o WebP de hasta 10 MB, con metadatos editoriales opcionales, y devuelve la URL publicada; el archivo queda almacenado hasta que se elimine.",
    inputSchema: z.object({
      filename: z.string().trim().min(1).max(100),
      dataUrl: z.string().min(32).max(14_000_000),
      metadata: mediaMetadataSchema.optional(),
    }).strict(),
    async execute(input) { return uploadMedia(input); },
  },
  {
    name: "cloudpress_update_media_meta",
    title: "Actualizar metadatos de imagen",
    description: "Actualiza los metadatos editoriales de una imagen ya presente en la biblioteca: título, texto alternativo, leyenda, descripción, creador, licencia o URL de fuente. Úsala para corregir accesibilidad o procedencia sin volver a cargar el archivo.",
    inputSchema: z.object({
      key: z.string().regex(/^media\/[^/]+$/),
      metadata: mediaMetadataSchema.partial().refine((value) => Object.keys(value).length > 0, "Indica al menos un metadato."),
    }).strict(),
    async execute({ key, metadata }) {
      const data = await api(`/api/admin/media/${encodeURIComponent(key.slice(6))}`, "PATCH", metadata);
      visible(`Metadatos actualizados: ${key.slice(6)}.`);
      return { key: data.key, name: data.name, metadata: data.metadata };
    },
  },
];

export const irreversibleActionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("purge_content"), contentId: z.number().int().positive() }),
  z.object({ operation: z.literal("delete_user"), userId: z.number().int().positive() }),
  z.object({ operation: z.literal("delete_media"), key: z.string().min(1).max(100) }),
  z.object({ operation: z.literal("uninstall_plugin"), pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/) }),
  z.object({ operation: z.literal("delete_metadata"), scope: z.enum(["content", "user"]), entityId: z.number().int().positive(), key: z.string().regex(/^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/) }),
  z.object({ operation: z.literal("delete_core_term"), termId: z.number().int().positive() }),
  z.object({ operation: z.literal("delete_plugin_term"), pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), taxonomyId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), termId: z.number().int().positive() }),
]);
