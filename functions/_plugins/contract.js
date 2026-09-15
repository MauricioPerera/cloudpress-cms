const CONTRACT_VERSION = "cloudpress-plugin/v1";
const HOOKS = new Set(["content.beforeCreate", "content.afterCreate"]);
const PERMISSIONS = new Set(["content:read", "content:transform", "content-types:define", "content-meta:define", "user-meta:define", "actions:register"]);
const idPattern = /^[a-z0-9][a-z0-9-]{2,47}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function uniqueStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === "string") && new Set(value).size === value.length; }
function declarations(value, permission, validator, label, errors) { if (value === undefined) return; if (!Array.isArray(value) || value.some((item) => !validator(item))) errors.push(`${label} inválido.`); if (!value?.length || !permission) return; }

export function validatePluginManifest(input) {
  const errors = [];
  if (!isObject(input)) return { valid: false, errors: ["El manifiesto debe ser un objeto JSON."] };
  if (input.contractVersion !== CONTRACT_VERSION) errors.push(`contractVersion debe ser ${CONTRACT_VERSION}.`);
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
  const validType = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && x.label.length <= 80 && uniqueStrings(x.supports) && x.supports.every((v) => ["title","body","excerpt"].includes(v));
  const validMeta = (x) => isObject(x) && typeof x.key === "string" && /^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/.test(x.key) && ["string","number","boolean","json"].includes(x.type) && typeof x.required === "boolean";
  const validAction = (x) => isObject(x) && idPattern.test(x.id) && typeof x.label === "string" && ["content","user","site"].includes(x.scope);
  declarations(input.contentTypes, "content-types:define", validType, "contentTypes", errors); declarations(input.contentMeta, "content-meta:define", validMeta, "contentMeta", errors); declarations(input.userMeta, "user-meta:define", validMeta, "userMeta", errors); declarations(input.actions, "actions:register", validAction, "actions", errors);
  if (input.contentTypes?.length && !input.permissions?.includes("content-types:define")) errors.push("contentTypes exige content-types:define.");
  if (input.contentMeta?.length && !input.permissions?.includes("content-meta:define")) errors.push("contentMeta exige content-meta:define.");
  if (input.userMeta?.length && !input.permissions?.includes("user-meta:define")) errors.push("userMeta exige user-meta:define.");
  if (input.actions?.length && !input.permissions?.includes("actions:register")) errors.push("actions exige actions:register.");
  return { valid: errors.length === 0, errors };
}

export { CONTRACT_VERSION, HOOKS, PERMISSIONS };
