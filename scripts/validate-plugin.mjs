import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePluginManifest } from "../functions/_plugins/contract.js";

const folder = process.argv[2];
if (!folder) throw new Error("Uso: node scripts/validate-plugin.mjs plugins/<id>");

const manifest = JSON.parse(await readFile(resolve(folder, "manifest.json"), "utf8"));
const source = await readFile(resolve(folder, "plugin.js"), "utf8");
const module = (await import(pathToFileURL(resolve(folder, "plugin.js")).href)).default;
const verdict = validatePluginManifest(manifest);
const errors = [...verdict.errors];

for (const token of ["eval(", "new Function", "import(", "fetch(", "process.", "env.", "D1", "__proto__"]) {
  if (source.includes(token)) errors.push(`Código prohibido: ${token}`);
}
for (const hook of manifest.hooks || []) {
  if (typeof module?.[hook] !== "function") errors.push(`Falta el manejador ${hook}.`);
}
for (const action of manifest.actions || []) if (typeof module?.actions?.[action.handler] !== "function") errors.push(`Falta el handler de acción ${action.handler}.`);
for (const route of manifest.routes || []) if (typeof module?.routes?.[route.handler] !== "function") errors.push(`Falta el handler de ruta ${route.handler}.`);
for (const task of manifest.tasks || []) if (typeof module?.tasks?.[task.handler] !== "function") errors.push(`Falta el handler de tarea ${task.handler}.`);
for (const webhook of manifest.webhooks || []) if (typeof module?.webhooks?.[webhook.handler] !== "function") errors.push(`Falta el handler de webhook ${webhook.handler}.`);
if (manifest.permissions?.includes("diagnostics:read") && typeof module?.diagnostics !== "function") errors.push("diagnostics:read exige module.diagnostics.");

if (errors.length) {
  console.error(JSON.stringify({ valid: false, id: manifest.id || null, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ valid: true, id: manifest.id, contractVersion: manifest.contractVersion, hooks: manifest.hooks, permissions: manifest.permissions }, null, 2));
