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
  if (["/api/admin/agent-execution", "/api/admin/agent-runtime"].includes(path)) return [{ agentCapability: [] }];
  if (path.startsWith("/api/admin/") || path.startsWith("/api/editor/") || path === "/api/profile" || path.startsWith("/api/profile/")) return [{ sessionCookie: [] }];
  return [];
}

function agentAccessFor(path, method) {
  const numeric = "{id}";
  if (method === "post" && ["/api/admin/agent-execution", "/api/admin/agent-runtime"].includes(path)) return "capability-runtime";
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
  if (path === "/api/admin/agent-runtime" && method === "post") return { request: { $ref: "#/components/schemas/AgentRuntimeRequest" }, response: { $ref: "#/components/schemas/AgentRuntimeResponse" } };
  if (path === "/api/admin/agent-observability" && method === "get") return { response: { $ref: "#/components/schemas/AgentObservability" } };
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
      sessionCookie: { type: "apiKey", in: "cookie", name: "session", description: "Sesión de CloudPress para el panel administrativo." },
      agentCapability: { type: "http", scheme: "bearer", bearerFormat: "CloudPress agent capability", description: "Capacidad opaca, revocable y vinculada a un perfil, conservada por el companion LSFA; nunca se expone al JavaScript del navegador." }
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
      AgentRuntimeRequest: { description: "Una sola operación de runtime, autenticada con una capacidad de agente ligada a un perfil activo.", oneOf: [
        { type: "object", required: ["action"], properties: { action: { const: "claim" } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId"], properties: { action: { const: "heartbeat" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "checkpoint"], properties: { action: { const: "checkpoint" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, checkpoint: { type: "object", description: "Progreso sin secretos; CloudPress lo sanea y hashea." } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "usage"], properties: { action: { const: "record_model_usage" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, usage: { $ref: "#/components/schemas/AgentModelUsageInput" } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "estimatedInputTokens", "estimatedOutputTokens"], properties: { action: { const: "route_model" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, modelId: { type: "string", maxLength: 120 }, estimatedInputTokens: { type: "integer", minimum: 0, maximum: 10000000 }, estimatedOutputTokens: { type: "integer", minimum: 0, maximum: 10000000 } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "estimatedInputTokens", "estimatedOutputTokens", "prompt"], properties: { action: { const: "invoke_model" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, modelId: { type: "string", maxLength: 120 }, estimatedInputTokens: { type: "integer", minimum: 0, maximum: 10000000 }, estimatedOutputTokens: { type: "integer", minimum: 0, maximum: 10000000 }, prompt: { type: "string", minLength: 1, maxLength: 16000 } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "memory"], properties: { action: { const: "write_memory" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, memory: { type: "object", required: ["summary", "provenance"], properties: { classification: { enum: ["public", "internal", "restricted"] }, summary: { type: "object" }, provenance: { type: "object" }, expiresAt: { type: ["string", "null"], format: "date-time" } } } }, additionalProperties: false },
        { type: "object", required: ["action"], properties: { action: { const: "recall_memories" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
        { type: "object", required: ["action", "jobId", "leaseId", "recipientProfileId", "message"], properties: { action: { const: "send_message" }, jobId: { type: "string", format: "uuid" }, leaseId: { type: "string", format: "uuid" }, recipientProfileId: { type: "string", pattern: "^[a-z][a-z0-9-]{2,47}$" }, classification: { enum: ["public", "internal", "restricted"] }, message: { type: "object" } }, additionalProperties: false },
        { type: "object", required: ["action"], properties: { action: { const: "receive_messages" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
        { type: "object", required: ["action", "parentTaskId", "profileId", "objective", "plan", "context", "expected"], properties: { action: { const: "delegate_task" }, parentTaskId: { type: "string", format: "uuid" }, profileId: { type: "string", pattern: "^[a-z][a-z0-9-]{2,47}$" }, objective: { type: "string", minLength: 1, maxLength: 1000 }, plan: { type: "array", maxItems: 200 }, context: { type: "object" }, expected: { type: "object" } }, additionalProperties: false }
      ] },
      AgentModelUsageInput: { type: "object", required: ["providerId", "modelId", "inputTokens", "outputTokens"], properties: { providerId: { enum: ["external-webmcp", "cloudflare-workers-ai"] }, modelId: { type: "string", maxLength: 120 }, inputTokens: { type: "integer", minimum: 0, maximum: 100000000 }, outputTokens: { type: "integer", minimum: 0, maximum: 100000000 }, costMicrounits: { type: "integer", minimum: 0, maximum: 100000000, description: "Ignorado para el cálculo: el servidor usa el catálogo." } }, additionalProperties: false },
      AgentRuntimeResponse: { type: "object", description: "El campo depende de action: assignment, lease, checkpoint, usage, model, inference, memory, memories, message, messages o task.", additionalProperties: true },
      AgentObservability: { type: "object", required: ["runtime", "modelUsage", "recentUsage"], properties: { runtime: { type: "array", items: { type: "object", required: ["state", "total"], properties: { state: { type: "string" }, total: { type: "integer" } } } }, modelUsage: { type: "array", items: { type: "object", required: ["provider_id", "model_id", "input_tokens", "output_tokens", "cost_microunits", "invocations"], properties: { provider_id: { type: "string" }, model_id: { type: "string" }, evidence_level: { type: "string" }, input_tokens: { type: "integer" }, output_tokens: { type: "integer" }, cost_microunits: { type: "integer" }, invocations: { type: "integer" } } } }, recentUsage: { type: "array", items: { type: "object", properties: { task_id: { type: "string", format: "uuid" }, run_id: { type: "string", format: "uuid" }, provider_id: { type: "string" }, model_id: { type: "string" }, input_tokens: { type: "integer" }, output_tokens: { type: "integer" }, cost_microunits: { type: "integer" }, evidence_level: { type: "string" }, created_at: { type: "string", format: "date-time" } } } } } },
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
