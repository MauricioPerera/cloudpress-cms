import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePluginManifest } from "../functions/_plugins/contract.js";

const folder = process.argv[2];
if (!folder) throw new Error("Uso: node scripts/validate-plugin.mjs plugins/<id>");

const manifest = JSON.parse(await readFile(resolve(folder, "manifest.json"), "utf8"));
const source = await readFile(resolve(folder, "plugin.js"), "utf8");
const verdict = validatePluginManifest(manifest);
const errors = [...verdict.errors];

for (const token of ["eval(", "new Function", "import(", "fetch(", "process.", "env.", "D1", "__proto__"]) {
  if (source.includes(token)) errors.push(`Código prohibido: ${token}`);
}
for (const hook of manifest.hooks || []) {
  if (!source.includes(`\"${hook}\"`) && !source.includes(`'${hook}'`)) errors.push(`Falta el manejador ${hook}.`);
}

if (errors.length) {
  console.error(JSON.stringify({ valid: false, id: manifest.id || null, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ valid: true, id: manifest.id, contractVersion: manifest.contractVersion, hooks: manifest.hooks, permissions: manifest.permissions }, null, 2));
