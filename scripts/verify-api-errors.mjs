import assert from "node:assert/strict";
import { json } from "../functions/_shared.js";
import { onRequest } from "../functions/_middleware.js";

const invalid = json({ error: "Datos inválidos" }, 400);
const invalidPayload = await invalid.json();
assert.equal(invalidPayload.error, "Datos inválidos");
assert.equal(invalidPayload.code, "invalid_request");
assert.match(invalidPayload.requestId, /^[0-9a-f-]{36}$/i);
assert.equal(invalid.headers.get("x-request-id"), invalidPayload.requestId);

const limited = json({ error: "Espera" }, 429, { "Retry-After": "60" });
const limitedPayload = await limited.json();
assert.equal(limitedPayload.code, "rate_limited");
assert.equal(limited.headers.get("retry-after"), "60");

const rejected = await onRequest({ request: new Request("https://cms.example/api/admin/content", { method: "POST", headers: { Origin: "https://attacker.example" } }), env: {}, next: async () => new Response(null, { status: 204 }) });
const rejectedPayload = await rejected.json();
assert.equal(rejected.status, 403);
assert.equal(rejectedPayload.code, "forbidden");
assert.equal(rejected.headers.get("x-request-id"), rejectedPayload.requestId);

const plain = await onRequest({ request: new Request("https://cms.example/health"), env: {}, next: async () => new Response("ok", { status: 200 }) });
assert.match(plain.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i, "Incluso respuestas no JSON llevan correlación.");
console.log(JSON.stringify({ ok: true, checks: ["stable-error-codes", "json-request-id", "rate-limit-contract", "middleware-request-id"] }));
