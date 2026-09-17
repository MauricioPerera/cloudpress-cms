import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWebMcpMock, withMockDocument } from "fastwebmcp";
import { registerCloudPressAdminTools } from "../webmcp/fastwebmcp-entry.js";

const mock = createWebMcpMock();
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const calls = [];
globalThis.window = { CloudPressUI: { toast() {} }, dispatchEvent() {} };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.fetch = async (path, init = {}) => {
  calls.push({ path: String(path), method: init.method || "GET", body: init.body });
  if (String(path).startsWith("/api/admin/entries") && (init.method || "GET") === "GET") return Response.json({ items: [] });
  if (path === "/api/admin/entries" && init.method === "POST") return Response.json({ id: 41 }, { status: 201 });
  if (path === "/api/admin/media" && init.method === "POST") {
    assert.ok(init.body instanceof FormData, "La carga debe usar multipart/form-data.");
    const file = init.body.get("file");
    assert.equal(file.name, "portada.png");
    assert.equal(file.type, "image/png");
    assert.ok(file.size > 0 && file.size <= 10 * 1024 * 1024);
    return Response.json({ key: "media/example-portada.png", url: "/media/example-portada.png" }, { status: 201 });
  }
  return Response.json({ error: "Ruta inesperada" }, { status: 404 });
};

try {
  await withMockDocument(mock, async () => {
    const controller = registerCloudPressAdminTools({ broker: { async request() { return { status: "failed", operation: "cloudpress_irreversible_action", error_code: "broker_unavailable" }; } } });
    for (const name of ["cloudpress_record_task_step", "cloudpress_read_admin_state", "cloudpress_create_draft", "cloudpress_upload_media", "cloudpress_sensitive_action"]) assert.equal(mock.hasTool(name), true, `${name} debe registrarse.`);
    const read = await mock.invokeTool("cloudpress_read_admin_state", { resource: "content" });
    assert.equal(read.note, "No hay contenido que coincida.");
    const draft = await mock.invokeTool("cloudpress_create_draft", { kind: "post", title: "Prueba" });
    assert.deepEqual(draft, { id: 41, status: "draft", title: "Prueba" });
    const uploaded = await mock.invokeTool("cloudpress_upload_media", {
      filename: "portada.png",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J0qAAAAAASUVORK5CYII=",
    });
    assert.deepEqual(uploaded, { key: "media/example-portada.png", name: "example-portada.png", url: "/media/example-portada.png", size: 68, contentType: "image/png" });
    await assert.rejects(() => mock.invokeTool("cloudpress_upload_media", { filename: "invalida.svg", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }));
    const sensitive = await mock.invokeTool("cloudpress_sensitive_action", { operation: "purge_content", contentId: 4 });
    assert.deepEqual(sensitive, { status: "failed", operation: "cloudpress_irreversible_action", error_code: "broker_unavailable" });
    controller.abort();
    assert.equal(mock.hasTool("cloudpress_read_admin_state"), false, "Las herramientas deben desregistrarse al salir de la página.");
  });
} finally {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.CustomEvent = originalCustomEvent;
}

assert.equal(calls.some((call) => call.path === "/api/admin/entries" && call.method === "POST"), true);
assert.equal(calls.some((call) => call.path === "/api/admin/media" && call.method === "POST"), true);
const toolSource = await readFile("webmcp/fastwebmcp-tools.js", "utf8");
const brokerSource = await readFile("webmcp/cloudpress-lsfa-broker.js", "utf8");
assert.match(toolSource, /currentAgentExecution/, "Las herramientas conservan el contexto del paso activo.");
assert.match(brokerSource, /execution/, "El companion recibe el contexto de tarea validable.");
console.log(JSON.stringify({ ok: true, checks: ["fastwebmcp-registration", "reversible-tool-execution", "task-execution-context-forwarding", "media-upload-validation", "lsfa-broker-fail-closed", "pagehide-unregister"] }));
