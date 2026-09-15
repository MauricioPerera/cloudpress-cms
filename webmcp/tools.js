import { defineTool } from "@nekuda/webmcp-sdk";

const api = async (path, method = "GET", body) => {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: "Respuesta inválida" }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};

const visible = (message) => {
  window.CloudPressUI?.toast(message);
  window.dispatchEvent(new CustomEvent("cloudpress:webmcp-action", { detail: { message } }));
};

export const readAdminState = defineTool({
  stableKey: "cloudpress.read-admin-state",
  name: "cloudpress_read_admin_state",
  title: "Consultar estado de CloudPress",
  description: "Consulta contenido, usuarios, taxonomías, menú o plugins de CloudPress. Úsala antes de proponer o ejecutar un cambio; devuelve datos actuales y no modifica el sitio.",
  inputSchema: { type: "object", properties: { resource: { type: "string", enum: ["content", "users", "taxonomies", "menu", "plugins"] }, kind: { type: "string", enum: ["post", "page"] }, status: { type: "string", enum: ["active", "trash"] } }, required: ["resource"], additionalProperties: false },
  annotations: { readOnlyHint: true },
  async execute({ resource, kind, status }) {
    if (resource === "content") {
      const params = new URLSearchParams(); if (kind) params.set("kind", kind); if (status === "trash") params.set("status", "trash");
      const data = await api(`/api/admin/entries?${params}`); return { resource, items: data.items, note: data.items.length ? undefined : "No hay contenido que coincida." };
    }
    const routes = { users: "/api/admin/users", taxonomies: "/api/admin/taxonomies", menu: "/api/admin/menus", plugins: "/api/admin/plugins" };
    const data = await api(routes[resource]);
    return { resource, ...data };
  },
});

export const createDraft = defineTool({
  stableKey: "cloudpress.create-draft",
  name: "cloudpress_create_draft",
  title: "Crear borrador",
  description: "Crea una entrada o página como borrador en CloudPress. Úsala para preparar contenido sin publicarlo; el usuario revisa y publica manualmente desde la interfaz.",
  inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["post", "page"] }, title: { type: "string", minLength: 1, maxLength: 180 }, slug: { type: "string", maxLength: 96 }, excerpt: { type: "string", maxLength: 500 }, body: { type: "string", maxLength: 50000 } }, required: ["kind", "title"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ kind, title, slug, excerpt, body }) {
    const data = await api("/api/admin/entries", "POST", { kind, title, slug, excerpt, body, status: "draft" });
    visible(`Borrador creado: ${title}.`); return { id: data.id, status: "draft", title };
  },
});

export const updateContent = defineTool({
  stableKey: "cloudpress.update-content",
  name: "cloudpress_update_content",
  title: "Actualizar contenido",
  description: "Actualiza una entrada o página existente en CloudPress. Úsala para corregir contenido; CloudPress guarda una revisión previa para que el usuario pueda revertir manualmente.",
  inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 180 }, slug: { type: "string", maxLength: 96 }, excerpt: { type: "string", maxLength: 500 }, body: { type: "string", maxLength: 50000 }, status: { type: "string", enum: ["draft", "published"] } }, required: ["id"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ id, ...changes }) {
    if (!Object.keys(changes).length) throw new Error("Indica al menos un cambio.");
    await api(`/api/admin/entries/${id}`, "PATCH", changes); visible(`Contenido ${id} actualizado; hay una revisión previa disponible.`); return { id, updated: true, reversibleVia: "revisiones" };
  },
});

export const moveContentToTrash = defineTool({
  stableKey: "cloudpress.move-content-to-trash",
  name: "cloudpress_move_content_to_trash",
  title: "Enviar contenido a Papelera",
  description: "Envía una entrada o página a la Papelera de CloudPress. Úsala en vez de borrar: el usuario puede restaurarla manualmente desde Papelera.",
  inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ id }) { const data = await api(`/api/admin/entries/${id}`, "DELETE"); visible(`Contenido ${id} enviado a Papelera.`); return { id, status: "trash", reversible: true, ...data }; },
});

export const restoreContent = defineTool({
  stableKey: "cloudpress.restore-content",
  name: "cloudpress_restore_content",
  title: "Restaurar contenido de Papelera",
  description: "Restaura una entrada o página que está en la Papelera de CloudPress. Úsala cuando el usuario quiera recuperar una eliminación reversible.",
  inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ id }) { const data = await api(`/api/admin/trash/${id}`, "POST"); visible(`Contenido ${id} restaurado.`); return { id, restored: true, ...data }; },
});

export const setUserActive = defineTool({
  stableKey: "cloudpress.set-user-active",
  name: "cloudpress_set_user_active",
  title: "Activar o desactivar usuario",
  description: "Activa o desactiva una cuenta de usuario en CloudPress sin eliminarla. Úsala para retirar acceso de forma reversible; el usuario puede reactivarla manualmente.",
  inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 }, active: { type: "boolean" } }, required: ["id", "active"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ id, active }) { await api(`/api/admin/users/${id}`, "PATCH", { active }); visible(`Usuario ${id} ${active ? "activado" : "desactivado"}.`); return { id, active, reversible: true }; },
});

export const manageNavigation = defineTool({
  stableKey: "cloudpress.manage-navigation",
  name: "cloudpress_manage_navigation",
  title: "Crear o editar taxonomía y menú",
  description: "Crea o edita categorías, etiquetas o enlaces de menú de CloudPress. Úsala para organizar contenido o navegación; no elimina registros.",
  inputSchema: { type: "object", properties: { resource: { type: "string", enum: ["taxonomy", "menu"] }, action: { type: "string", enum: ["create", "update"] }, id: { type: "integer", minimum: 1 }, type: { type: "string", enum: ["category", "tag"] }, name: { type: "string", minLength: 1, maxLength: 120 }, label: { type: "string", minLength: 1, maxLength: 80 }, url: { type: "string", minLength: 1, maxLength: 300 }, position: { type: "number" } }, required: ["resource", "action"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute(input) {
    const isTaxonomy = input.resource === "taxonomy";
    const path = isTaxonomy ? "/api/admin/taxonomies" : "/api/admin/menus";
    const body = isTaxonomy ? { type: input.type, name: input.name } : { label: input.label, url: input.url, position: input.position ?? 0 };
    if (input.action === "update") { if (!input.id) throw new Error("Se requiere id para editar."); await api(`${path}?id=${input.id}`, "PUT", body); visible(`${isTaxonomy ? "Taxonomía" : "Enlace"} actualizado.`); return { id: input.id, updated: true }; }
    const data = await api(path, "POST", body); visible(`${isTaxonomy ? "Taxonomía" : "Enlace"} creado.`); return { id: data.id, created: true };
  },
});

export const setPluginState = defineTool({
  stableKey: "cloudpress.set-plugin-state",
  name: "cloudpress_set_plugin_state",
  title: "Activar o desactivar plugin",
  description: "Activa o desactiva un plugin ya instalado de CloudPress. Úsala para cambiar su estado de forma reversible; no desinstala plugins.",
  inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1 }, status: { type: "string", enum: ["enabled", "disabled"] } }, required: ["id", "status"], additionalProperties: false },
  annotations: { readOnlyHint: false },
  async execute({ id, status }) { await api(`/api/admin/plugins/${encodeURIComponent(id)}`, "PATCH", { status }); visible(`Plugin ${id} ${status === "enabled" ? "activado" : "desactivado"}.`); return { id, status, reversible: true }; },
});
