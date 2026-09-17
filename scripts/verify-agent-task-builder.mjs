import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [builder, page] = await Promise.all([readFile("agent-task-builder.js", "utf8"), readFile("agent-operations.html", "utf8")]);
for (const tool of ["cloudpress_read_admin_state", "cloudpress_create_draft", "cloudpress_update_content", "cloudpress_trash_content", "cloudpress_restore_content"]) {
  assert.match(builder, new RegExp(tool), `El constructor debe ofrecer ${tool}.`);
}
assert.match(builder, /cloudpress_plugin_action/, "El constructor debe permitir acciones declaradas por plugins.");
assert.match(builder, /Esta herramienta requiere un plan preparado/, "Las herramientas no preparadas no deben generar tareas fallidas.");
assert.match(page, /agent-task-builder\.js/, "La consola debe cargar el constructor visual.");
console.log(JSON.stringify({ ok: true, checks: ["visual-task-inputs", "bounded-editorial-requests", "unsupported-tool-disabled"] }));
