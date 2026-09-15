const CONTRACT_VERSION = "cloudpress-plugin/v1";
const CONTRACT_VERSION_V2 = "cloudpress-plugin/v2";
const HOOKS = new Set(["content.beforeCreate", "content.afterCreate"]);
const PERMISSIONS = new Set(["content:read", "content:transform", "content-types:define", "content-meta:define", "user-meta:define", "actions:register", "taxonomies:define", "admin-ui:register", "storage:read", "storage:write", "routes:register", "jobs:enqueue", "privacy:manage", "diagnostics:read", "capabilities:define"]);
const idPattern = /^[a-z0-9][a-z0-9-]{2,47}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function uniqueStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === "string") && new Set(value).size === value.length; }
function declarations(value, permission, validator, label, errors) { if (value === undefined) return; if (!Array.isArray(value) || value.some((item) => !validator(item))) errors.push(`${label} inválido.`); if (!value?.length || !permission) return; }
function requires(input, key, permission, errors) { if (input[key]?.length && !input.permissions?.includes(permission)) errors.push(`${key} exige ${permission}.`); }
const validRole = (value) => ["admin", "author", "user"].includes(value || "admin");
const validCapability = (value) => validRole(value) || idPattern.test(String(value || ""));

export function validatePluginManifest(input) {
  const errors = [];
  if (!isObject(input)) return { valid: false, errors: ["El manifiesto debe ser un objeto JSON."] };
  if (![CONTRACT_VERSION, CONTRACT_VERSION_V2].includes(input.contractVersion)) errors.push(`contractVersion debe ser ${CONTRACT_VERSION} o ${CONTRACT_VERSION_V2}.`);
  if (!idPattern.test(String(input.id || ""))) errors.push("id debe usar minúsculas, números y guiones (3-48 caracteres).");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) errors.push("name es obligatorio y no puede exceder 80 caracteres.");
  if (!semverPattern.test(String(input.version || ""))) errors.push("version debe ser SemVer, por ejemplo 1.0.0.");
  if (typeof input.description !== "string" || input.description.length > 280) errors.push("description es obligatorio y no puede exceder 280 caracteres.");
  if (!uniqueStrings(input.hooks) || !input.hooks.length) errors.push("hooks debe contener al menos un hook único.");
  else for (const hook of input.hooks) if (!HOOKS.has(hook)) errors.push(`Hook no permitido: ${hook}.`);
  if (!uniqueStrings(input.permissions) || !input.permissions.length) errors.push("permissions debe contener permisos únicos.");
  else for (const permission of input.permissions) if (!PERMISSIONS.has(permission)) errors.push(`Permiso no permitido: ${permission}.`);
  if (Array.isArray(input.hooks) && input.hooks.includes("content.beforeCreate") && !input.permissions?.includes("content:transform")) errors.push("content.beforeCreate exige el permiso content:transform.");
  if (input.settingsSchema !== undefined && (!isObject(input.settingsSchema) || JSON.stringify(input.settingsSchema).length > 4000)) errors.push("settingsSchema debe ser un objeto de hasta 4 KB.");
  if (input.uninstallPolicy !== undefined && !["preserve-content-purge-plugin-storage", "purge-all-plugin-data"].includes(input.uninstallPolicy)) errors.push("uninstallPolicy inválida.");
  const validType = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && x.label.length <= 80 && uniqueStrings(x.supports) && x.supports.every((v) => ["title","body","excerpt"].includes(v));
  const validMeta = (x) => isObject(x) && typeof x.key === "string" && /^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/.test(x.key) && ["string","number","boolean","json"].includes(x.type) && typeof x.required === "boolean";
  const validAction = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && ["content","user","site"].includes(x.scope);
  declarations(input.contentTypes, "content-types:define", validType, "contentTypes", errors); declarations(input.contentMeta, "content-meta:define", validMeta, "contentMeta", errors); declarations(input.userMeta, "user-meta:define", validMeta, "userMeta", errors); declarations(input.actions, "actions:register", validAction, "actions", errors);
  if (input.contentTypes?.length && !input.permissions?.includes("content-types:define")) errors.push("contentTypes exige content-types:define.");
  if (input.contentMeta?.length && !input.permissions?.includes("content-meta:define")) errors.push("contentMeta exige content-meta:define.");
  if (input.userMeta?.length && !input.permissions?.includes("user-meta:define")) errors.push("userMeta exige user-meta:define.");
  if (input.actions?.length && !input.permissions?.includes("actions:register")) errors.push("actions exige actions:register.");
  if (input.contractVersion === CONTRACT_VERSION_V2 && input.actions?.some((action) => typeof action?.handler !== "string" || !idPattern.test(action.handler) || !validCapability(action.capability))) errors.push("Cada acción v2 exige handler y capability válidos.");
  const validRoute = (x) => isObject(x) && typeof x.path === "string" && /^\/[a-z0-9/_-]{0,120}$/.test(x.path) && uniqueStrings(x.methods) && x.methods.length && x.methods.every((method) => ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) && typeof x.handler === "string" && idPattern.test(x.handler) && validCapability(x.capability);
  const validTask = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && typeof x.handler === "string" && idPattern.test(x.handler);
  const validMenu = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && typeof x.view === "string" && idPattern.test(x.view) && validCapability(x.capability);
  const validTaxonomy = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && typeof x.hierarchical === "boolean" && uniqueStrings(x.objectTypes) && x.objectTypes.every((item) => idPattern.test(item));
  const validMigration = (x) => isObject(x) && idPattern.test(x.id) && uniqueStrings(x.collections) && x.collections.every((item) => idPattern.test(item));
  const validCapabilityDefinition = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && uniqueStrings(x.defaultRoles) && x.defaultRoles.every(validRole);
  declarations(input.routes, "routes:register", validRoute, "routes", errors); declarations(input.tasks, "jobs:enqueue", validTask, "tasks", errors); declarations(input.menus, "admin-ui:register", validMenu, "menus", errors); declarations(input.taxonomies, "taxonomies:define", validTaxonomy, "taxonomies", errors); declarations(input.migrations, "storage:write", validMigration, "migrations", errors); declarations(input.capabilities, "capabilities:define", validCapabilityDefinition, "capabilities", errors);
  requires(input, "routes", "routes:register", errors); requires(input, "tasks", "jobs:enqueue", errors); requires(input, "menus", "admin-ui:register", errors); requires(input, "taxonomies", "taxonomies:define", errors); requires(input, "migrations", "storage:write", errors); requires(input, "capabilities", "capabilities:define", errors);
  if (input.contractVersion === CONTRACT_VERSION && ["routes", "tasks", "menus", "taxonomies", "migrations"].some((key) => input[key]?.length)) errors.push("Estas declaraciones requieren cloudpress-plugin/v2.");
  return { valid: errors.length === 0, errors };
}

export { CONTRACT_VERSION, CONTRACT_VERSION_V2, HOOKS, PERMISSIONS };
