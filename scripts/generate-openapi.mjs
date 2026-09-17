import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";

const apiRoot = "functions/api";
const output = "docs/openapi.json";
const methods = ["get", "post", "put", "patch", "delete"];

async function routeFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? routeFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  }))).flat();
}

function pathFor(file) {
  const parts = relative(apiRoot, file).split(sep).map((part) => part.replace(/\.js$/, ""));
  const mapped = parts.filter((part) => part !== "index").map((part) => part === "[[path]]" ? "{path}" : part.replace(/^\[([^\]]+)\]$/, "{$1}"));
  return `/api/${mapped.join("/")}`.replace(/\/$/, "");
}

function securityFor(path) {
  if (path.startsWith("/api/admin/") || path.startsWith("/api/editor/") || path === "/api/profile" || path.startsWith("/api/profile/")) return [{ sessionCookie: [] }];
  return [];
}

function agentAccessFor(path, method) {
  const numeric = "{id}";
  if (method === "get" && ["/api/admin/entries", "/api/admin/users", "/api/admin/taxonomies", "/api/admin/menus", "/api/admin/plugins", "/api/admin/media", "/api/admin/plugin-schema", "/api/admin/plugin-meta", "/api/admin/blocks", "/api/admin/content", "/api/admin/content-types", "/api/admin/content-fields"].includes(path)) return "scoped";
  if (method === "post" && ["/api/admin/entries", "/api/admin/taxonomies", "/api/admin/menus", "/api/admin/plugins", "/api/admin/media-agent", "/api/admin/approvals", "/api/admin/content"].includes(path)) return "scoped";
  if (method === "patch" && ["/api/admin/entries/{id}", "/api/admin/content/{id}"].includes(path)) return "scoped";
  if (method === "put" && ["/api/admin/taxonomies", "/api/admin/menus", "/api/admin/plugin-meta"].includes(path)) return "scoped";
  if (method === "delete" && path === "/api/admin/entries/{id}") return "scoped";
  return path.startsWith("/api/admin/") ? "none" : undefined;
}

const jsonResponse = (schema, description = "Respuesta correcta en JSON.") => ({ description, content: { "application/json": { schema } } });
const parameter = (name, description, schema, required = false) => ({ name, in: "query", required, description, schema });
function contractFor(path, method) {
  if (path === "/api/content" && method === "get") return { parameters: [parameter("kind", "Tipo base publicado.", { type: "string", enum: ["post", "page"] }), parameter("contentType", "Tipo propio marcado publicApi.", { type: "string", maxLength: 48 }), parameter("page", "Página desde 1.", { type: "integer", minimum: 1, maximum: 1000 }), parameter("pageSize", "Elementos por página.", { type: "integer", minimum: 1, maximum: 50 })], response: { $ref: "#/components/schemas/PublicContentCollection" } };
  if (path === "/api/comments" && method === "get") return { parameters: [parameter("contentId", "Identificador del contenido.", { type: "integer", minimum: 1 }, true), parameter("page", "Página desde 1.", { type: "integer", minimum: 1, maximum: 1000 }), parameter("pageSize", "Elementos por página.", { type: "integer", minimum: 1, maximum: 100 })], response: { $ref: "#/components/schemas/PublicCommentCollection" } };
  if (path === "/api/comments" && method === "post") return { request: { $ref: "#/components/schemas/CommentSubmission" }, response: { $ref: "#/components/schemas/CommentAccepted" } };
  if (path === "/api/search" && method === "get") return { parameters: [parameter("q", "Texto a buscar; mínimo dos caracteres.", { type: "string", minLength: 2, maxLength: 100 }, true), parameter("page", "Página desde 1.", { type: "integer", minimum: 1, maximum: 100 }), parameter("pageSize", "Elementos por página.", { type: "integer", minimum: 1, maximum: 50 })], response: { $ref: "#/components/schemas/SearchCollection" } };
  if (path === "/api/login" && method === "post") return { request: { $ref: "#/components/schemas/LoginRequest" }, response: { $ref: "#/components/schemas/LoginResponse" } };
  if (path === "/api/admin/content" && method === "post") return { request: { $ref: "#/components/schemas/ContentWrite" }, response: { $ref: "#/components/schemas/ContentMutation" } };
  if (path === "/api/admin/content/{id}" && method === "patch") return { request: { $ref: "#/components/schemas/ContentWrite" }, response: { $ref: "#/components/schemas/ContentMutation" } };
  if (path === "/api/plugins/{pluginId}/{path}" && method === "get") return { response: { $ref: "#/components/schemas/PluginRouteResponse" } };
  return {};
}

const files = await routeFiles(apiRoot);
const paths = {};
for (const file of files) {
  const source = await readFile(file, "utf8");
  const path = pathFor(file);
  const declared = methods.filter((method) => new RegExp(`onRequest${method[0].toUpperCase()}${method.slice(1)}`).test(source));
  const supported = declared.length ? declared : /onRequest\s*\(/.test(source) ? methods : [];
  if (!supported.length) throw new Error(`No se encontró handler HTTP en ${file}`);
  paths[path] ??= {};
  for (const method of supported) paths[path][method] = {
    operationId: `${method}_${path.replaceAll("/", "_").replace(/[{}]/g, "")}`.replace(/[^a-zA-Z0-9_]/g, "_"),
    summary: `Implementado por ${file.replaceAll("\\", "/")}`,
    security: securityFor(path),
    ...(agentAccessFor(path, method) ? { "x-cloudpress-agent-access": agentAccessFor(path, method) } : {}),
    parameters: [[...path.matchAll(/\{([^}]+)\}/g)].map((match) => { return { name: match[1], in: "path", required: true, schema: { type: "string" } }; }), ...(contractFor(path, method).parameters || [])],
    ...(contractFor(path, method).request ? { requestBody: { required: true, content: { "application/json": { schema: contractFor(path, method).request } } } } : {}),
    responses: {
      "200": jsonResponse(contractFor(path, method).response || { type: "object" }),
      "400": { ...jsonResponse({ $ref: "#/components/schemas/Error" }, "Solicitud inválida."), headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } } },
      "403": { ...jsonResponse({ $ref: "#/components/schemas/Error" }, "Autorización insuficiente."), headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } } },
      "422": { ...jsonResponse({ $ref: "#/components/schemas/Error" }, "Entrada válida sintácticamente pero rechazada por reglas de negocio."), headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } } }
    }
  };
}

const document = {
  openapi: "3.1.0",
  info: { title: "CloudPress API", version: "1.1.0", description: "Contrato generado desde Pages Functions. Las mutaciones de navegador requieren mismo origen; los permisos se aplican en servidor." },
  servers: [{ url: "https://{site}", variables: { site: { default: "example.invalid" } } }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "session", description: "Sesión de CloudPress. Las rutas LSFA aceptan únicamente capacidades con alcance de ruta y método definido por el servidor." }
    },
    schemas: {
      Error: { type: "object", required: ["error", "code", "requestId"], properties: { error: { type: "string" }, code: { type: "string", enum: ["invalid_request", "unauthenticated", "forbidden", "not_found", "conflict", "validation_failed", "rate_limited", "internal_error", "request_failed"] }, requestId: { type: "string", format: "uuid", description: "Identificador seguro para correlación y soporte." } } },
      PublicContent: { type: "object", required: ["id", "kind", "content_type", "title", "slug", "body", "published_at", "terms"], properties: { id: { type: "integer" }, kind: { type: "string", enum: ["post", "page"] }, content_type: { type: "string" }, title: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, body: { type: "string" }, published_at: { type: "string", format: "date-time" }, terms: { type: "array", items: { $ref: "#/components/schemas/Term" } } } },
      Term: { type: "object", required: ["id", "type", "name", "slug"], properties: { id: { type: "integer" }, type: { type: "string" }, name: { type: "string" }, slug: { type: "string" } } },
      PublicContentCollection: { type: "object", required: ["page", "pageSize", "total", "items"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, items: { type: "array", items: { $ref: "#/components/schemas/PublicContent" } } } },
      PublicComment: { type: "object", required: ["id", "author_name", "body", "created_at"], properties: { id: { type: "integer" }, author_name: { type: "string" }, body: { type: "string" }, created_at: { type: "string", format: "date-time" } } },
      PublicCommentCollection: { type: "object", required: ["page", "pageSize", "total", "comments"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, comments: { type: "array", items: { $ref: "#/components/schemas/PublicComment" } } } },
      CommentSubmission: { type: "object", required: ["contentId", "author", "body"], properties: { contentId: { type: "integer", minimum: 1 }, author: { type: "string", minLength: 2, maxLength: 80 }, email: { type: "string", format: "email", maxLength: 254 }, body: { type: "string", minLength: 2, maxLength: 2000 }, website: { type: "string", description: "Honeypot; debe permanecer vacío." } } },
      CommentAccepted: { type: "object", required: ["ok", "message"], properties: { ok: { type: "boolean" }, message: { type: "string" } } },
      SearchCollection: { type: "object", required: ["query", "page", "pageSize", "total", "items"], properties: { query: { type: "string" }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, items: { type: "array", items: { $ref: "#/components/schemas/PublicContent" } } } },
      LoginRequest: { type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string", writeOnly: true }, totp: { type: "string", writeOnly: true, description: "Requerido sólo si el usuario activó TOTP." } } },
      LoginResponse: { type: "object", required: ["ok", "user"], properties: { ok: { type: "boolean" }, user: { type: "object", properties: { username: { type: "string" }, role: { type: "string" }, permissions: { type: "object" } } } } },
      ContentWrite: { type: "object", properties: { kind: { type: "string", enum: ["post", "page"] }, contentType: { type: "string" }, title: { type: "string", maxLength: 180 }, slug: { type: "string", maxLength: 96 }, excerpt: { type: "string", maxLength: 500 }, body: { type: "string", maxLength: 50000 }, status: { type: "string", enum: ["draft", "published"] }, publishedAt: { type: ["string", "null"], format: "date-time" }, customFields: { type: "object", additionalProperties: true } } },
      ContentMutation: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "integer" }, scheduled: { type: "boolean" }, publishedAt: { type: ["string", "null"], format: "date-time" } } },
      PluginRouteResponse: { type: "object", required: ["ok", "result"], properties: { ok: { type: "boolean" }, result: {} } }
    },
    headers: { RequestId: { description: "Identificador de correlación de la respuesta.", schema: { type: "string", format: "uuid" } } }
  }
};
const serialized = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const existing = await readFile(output, "utf8").catch(() => "");
  if (existing !== serialized) throw new Error("docs/openapi.json no está sincronizado; ejecuta npm run openapi:build.");
} else await writeFile(output, serialized);
console.log(JSON.stringify({ ok: true, output, paths: Object.keys(paths).length }));
