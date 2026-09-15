import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("plugin-admin.html", "utf8");
for (const required of ["pluginTermIds", "async function trash", "/api/admin/trash/", "data-webhook", "/webhooks/", "async function diagnostics", "async function privacy", "CloudPressUI.confirm", "/api/admin/plugin-meta", "/api/admin/plugins/"]) assert.ok(html.includes(required), `La UI debe incluir ${required}.`);
assert.equal(/(?<!CloudPressUI\.)\b(alert|confirm|prompt)\(/.test(html), false, "La UI no debe usar diálogos nativos.");
console.log(JSON.stringify({ ok: true, checks: ["content-editor", "taxonomy-assignment", "trash-restore-purge", "actions", "webhook-rotation", "diagnostics", "privacy", "web-messages"] }));
