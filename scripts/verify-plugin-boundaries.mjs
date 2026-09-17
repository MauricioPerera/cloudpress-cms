import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [contract, prompt, status, schema, commerceManifest] = await Promise.all([
  readFile("plugins/CONTRACT.md", "utf8"),
  readFile("plugins/LLM_PLUGIN_PROMPT.md", "utf8"),
  readFile("docs/GOAL_STATUS.md", "utf8"),
  readFile("schema.sql", "utf8"),
  readFile("plugins/cloudpress-commerce/manifest.json", "utf8")
]);

for (const [name, text] of [["contract", contract], ["prompt", prompt], ["goal status", status]]) {
  assert.match(text, /comercio|commerce/i, `${name} debe definir Commerce como plugin.`);
  assert.match(text, /multilingü|idiomas/i, `${name} debe definir idiomas como plugin.`);
}

const commerce = JSON.parse(commerceManifest);
assert.equal(commerce.id, "cloudpress-commerce");
assert.ok(commerce.contentTypes?.length, "Commerce debe declarar sus tipos a través del contrato.");
assert.ok(commerce.actions?.length, "Commerce debe declarar sus acciones a través del contrato.");
assert.doesNotMatch(schema, /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:commerce|product|cart|order|inventory)[_\s(]/i, "El esquema del core no debe contener tablas de dominio Commerce.");

console.log(JSON.stringify({
  ok: true,
  checks: ["commerce-plugin", "languages-plugin", "core-schema-without-commerce-domain-tables"]
}, null, 2));
