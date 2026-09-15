import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parse } from "acorn";
import { validatePluginManifest } from "../../functions/_plugins/contract.js";

export const PLUGIN_VALIDATOR_VERSION = "cloudpress-plugin-validator/1";

const forbiddenRoots = new Set([
  "process", "Deno", "Bun", "require", "module", "exports", "global", "globalThis",
  "window", "document", "navigator", "location", "localStorage", "sessionStorage", "caches",
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker",
  "importScripts", "eval", "Function", "AsyncFunction", "WebAssembly", "D1", "R2", "DB",
  "setTimeout", "setInterval",
]);
const forbiddenProperties = new Set(["__proto__", "prototype", "constructor", "env"]);
const safeConstructors = new Set(["Date", "Error", "TypeError", "RangeError", "SyntaxError", "Map", "Set"]);
const handlerGroups = [
  ["actions", "actions"],
  ["routes", "routes"],
  ["tasks", "tasks"],
  ["webhooks", "webhooks"],
  ["blocks", "blocks"],
];

function hash(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function propertyName(property) {
  if (!property || property.computed) return null;
  if (property.key?.type === "Identifier") return property.key.name;
  return typeof property.key?.value === "string" ? property.key.value : null;
}
function isFunction(value) { return value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression"; }
function isObject(value) { return value?.type === "ObjectExpression"; }
function rootIdentifier(node) {
  let cursor = node;
  while (cursor?.type === "MemberExpression") cursor = cursor.object;
  return cursor?.type === "Identifier" ? cursor.name : null;
}
function walk(node, visitor, parent = null) {
  if (!node || typeof node !== "object") return;
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["start", "end", "loc", "raw"].includes(key) || value === parent) continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child, visitor, node);
    } else if (value?.type) {
      walk(value, visitor, node);
    }
  }
}
function containsLoadTimeEffect(node) {
  let found = false;
  const inspect = (current) => {
    if (!current || typeof current !== "object" || found) return;
    if (isFunction(current)) return;
    if (["CallExpression", "NewExpression", "AssignmentExpression", "UpdateExpression", "AwaitExpression", "TaggedTemplateExpression"].includes(current.type)) { found = true; return; }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value?.type) inspect(value);
    }
  };
  inspect(node);
  return found;
}
function objectProperties(object, label, errors) {
  if (!isObject(object)) { errors.push(`${label} debe ser un objeto literal.`); return new Map(); }
  const properties = new Map();
  for (const property of object.properties) {
    const name = propertyName(property);
    if (property.type !== "Property" || !name || properties.has(name)) { errors.push(`${label} no admite propiedades dinámicas, spreads ni duplicados.`); continue; }
    properties.set(name, property);
  }
  return properties;
}
function validateExports(ast, manifest, errors) {
  const defaultExports = ast.body.filter((statement) => statement.type === "ExportDefaultDeclaration");
  if (defaultExports.length !== 1) { errors.push("plugin.js debe tener exactamente un export default."); return; }
  if (ast.body.some((statement) => ["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(statement.type))) errors.push("plugin.js no admite imports ni exports adicionales.");
  for (const statement of ast.body) {
    if (["ExportDefaultDeclaration", "VariableDeclaration", "FunctionDeclaration"].includes(statement.type)) continue;
    errors.push("plugin.js sólo puede contener helpers locales y export default.");
  }
  for (const statement of ast.body.filter((item) => item.type === "VariableDeclaration")) {
    if (statement.kind !== "const" || statement.declarations.some((declaration) => !declaration.id || containsLoadTimeEffect(declaration.init))) errors.push("Las constantes de módulo no pueden ejecutar código al cargar el plugin.");
  }
  const root = defaultExports[0].declaration;
  const properties = objectProperties(root, "El export default", errors);
  const expected = new Map((manifest.hooks || []).map((hook) => [hook, "hook"]));
  for (const [group, declaration] of handlerGroups) if (manifest[declaration]?.length) expected.set(group, group);
  if (manifest.permissions?.includes("diagnostics:read")) expected.set("diagnostics", "diagnostics");
  for (const [name, property] of properties) {
    if (!expected.has(name)) errors.push(`El export default declara ${name}, que no está permitido por el manifiesto.`);
    if (expected.get(name) === "hook" || expected.get(name) === "diagnostics") {
      if (!isFunction(property.value)) errors.push(`${name} debe ser una función.`);
    }
  }
  for (const [name, type] of expected) {
    const property = properties.get(name);
    if (!property) { errors.push(`Falta el manejador ${name}.`); continue; }
    if (type === "hook" || type === "diagnostics") continue;
    const handlers = objectProperties(property.value, name, errors);
    const declared = new Set((manifest[type] || []).map((item) => item.handler));
    for (const handler of declared) if (!handlers.has(handler) || !isFunction(handlers.get(handler).value)) errors.push(`Falta el handler de ${type}: ${handler}.`);
    for (const handler of handlers.keys()) if (!declared.has(handler)) errors.push(`${type}.${handler} no está declarado en el manifiesto.`);
  }
}
function validateStaticPolicy(ast, errors) {
  walk(ast, (node, parent) => {
    if (["ImportExpression", "WithStatement", "DebuggerStatement", "ThisExpression", "ClassDeclaration", "ClassExpression"].includes(node.type)) errors.push(`Sintaxis no permitida: ${node.type}.`);
    if (node.type === "NewExpression" && (node.callee.type !== "Identifier" || !safeConstructors.has(node.callee.name))) errors.push("new sólo permite constructores seguros.");
    if (node.type === "MemberExpression") {
      const property = node.computed ? (typeof node.property?.value === "string" ? node.property.value : null) : node.property?.name;
      if (forbiddenRoots.has(rootIdentifier(node))) errors.push(`Acceso prohibido a ${rootIdentifier(node)}.`);
      if (forbiddenProperties.has(property)) errors.push(`Propiedad prohibida: ${property}.`);
    }
    if (node.type === "Property" && forbiddenProperties.has(propertyName(node))) errors.push(`Propiedad prohibida: ${propertyName(node)}.`);
    if (node.type === "Identifier" && forbiddenRoots.has(node.name)) {
      const isStaticProperty = (parent?.type === "Property" && parent.key === node && !parent.computed) || (parent?.type === "MemberExpression" && parent.property === node && !parent.computed);
      if (!isStaticProperty) errors.push(`Identificador prohibido: ${node.name}.`);
    }
  });
}
function unique(errors) { return [...new Set(errors)]; }

export function validatePluginSource({ manifest, source, folderName = manifest?.id }) {
  const contract = validatePluginManifest(manifest);
  const errors = [...contract.errors];
  if (manifest?.id !== folderName) errors.push("El id del manifiesto no coincide con su directorio.");
  if (typeof source !== "string" || !source.trim()) errors.push("plugin.js está vacío.");
  if (Buffer.byteLength(source || "", "utf8") > 200 * 1024) errors.push("plugin.js excede el límite de 200 KB.");
  let ast;
  if (!errors.length) {
    try { ast = parse(source, { ecmaVersion: "latest", sourceType: "module" }); }
    catch (error) { errors.push(`plugin.js no es JavaScript ESM válido: ${error.message}`); }
  }
  if (ast) { validateStaticPolicy(ast, errors); validateExports(ast, manifest, errors); }
  const verification = {
    valid: errors.length === 0,
    validatorVersion: PLUGIN_VALIDATOR_VERSION,
    sourceHash: typeof source === "string" ? hash(source) : null,
    manifestHash: manifest ? hash(canonical(manifest)) : null,
    policy: "static-ast-no-execution",
  };
  return { valid: verification.valid, id: manifest?.id || null, errors: unique(errors), manifest, verification };
}

export async function validatePluginPackage(folder) {
  const absoluteFolder = resolve(folder);
  let manifest;
  let source;
  try { manifest = JSON.parse(await readFile(resolve(absoluteFolder, "manifest.json"), "utf8")); }
  catch (error) { return { valid: false, id: null, errors: [`No se pudo leer manifest.json: ${error.message}`], verification: { valid: false, validatorVersion: PLUGIN_VALIDATOR_VERSION, sourceHash: null, manifestHash: null, policy: "static-ast-no-execution" } }; }
  try { source = await readFile(resolve(absoluteFolder, "plugin.js"), "utf8"); }
  catch (error) { return { valid: false, id: manifest?.id || null, errors: [`No se pudo leer plugin.js: ${error.message}`], manifest, verification: { valid: false, validatorVersion: PLUGIN_VALIDATOR_VERSION, sourceHash: null, manifestHash: hash(canonical(manifest)), policy: "static-ast-no-execution" } }; }
  const parent = dirname(absoluteFolder);
  // Archived packages are still owned by their plugin id, not by the SemVer directory.
  const folderName = basename(parent) === "releases" ? basename(dirname(parent)) : basename(absoluteFolder);
  return validatePluginSource({ manifest, source, folderName });
}
