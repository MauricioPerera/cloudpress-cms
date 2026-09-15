import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("plugin-admin.html", "utf8");
const baseAdmin = await readFile("admin.html", "utf8"), pluginContent = await readFile("plugin-content-admin.js", "utf8"), navigation = await readFile("plugin-navigation.js", "utf8");
for (const required of ["pluginTermIds", "async function trash", "/api/admin/trash/", "data-webhook", "/webhooks/", "async function diagnostics", "async function privacy", "CloudPressUI.confirm", "/api/admin/plugin-meta", "/api/admin/plugins/"]) assert.ok(html.includes(required), `La UI debe incluir ${required}.`);
assert.equal(/(?<!CloudPressUI\.)\b(alert|confirm|prompt)\(/.test(html), false, "La UI no debe usar diálogos nativos.");
for (const required of ["plugin-content-admin.js", "contentType="]) assert.ok(baseAdmin.includes(required) || navigation.includes(required), `La UI base debe incluir ${required}.`);
for (const required of ["data-plugin-nav", "setInterval(bind,2000)"]) assert.ok(navigation.includes(required), `La navegación debe retirar en caliente ${required}.`);
for (const required of ["/api/admin/content?contentType", "/api/admin/plugin-meta", "pluginTermIds", "/taxonomies/", "/revisions", "/api/admin/trash/", "CloudPressUI.confirm"]) assert.ok(pluginContent.includes(required), `El editor base de plugin debe incluir ${required}.`);
console.log(JSON.stringify({ ok: true, checks: ["content-editor", "taxonomy-assignment", "trash-restore-purge", "actions", "webhook-rotation", "diagnostics", "privacy", "web-messages"] }));
