import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

const next = async () => new Response(null, { status: 204 });

async function request(url, headers = {}) {
  return onRequest({ request: new Request(url, { method: "POST", headers }), env: {}, next });
}

const rejected = await request("https://cloudpress.example/api/admin/entries", { Origin: "https://attacker.example" });
assert.equal(rejected.status, 403, "Una mutación de otro origen debe rechazarse antes de llegar a la API.");
assert.match(rejected.headers.get("content-security-policy") || "", /frame-ancestors 'self'/, "Los rechazos deben permitir sólo framing del mismo origen.");

const metadataRejected = await request("https://cloudpress.example/api/admin/entries", { "Sec-Fetch-Site": "cross-site" });
assert.equal(metadataRejected.status, 403, "La metadata que identifica una petición cross-site debe rechazarse.");

const accepted = await request("https://cloudpress.example/api/admin/entries", { Origin: "https://cloudpress.example" });
assert.equal(accepted.status, 204, "Una mutación originada en CloudPress debe continuar.");
assert.equal(accepted.headers.get("x-content-type-options"), "nosniff");
assert.match(accepted.headers.get("strict-transport-security") || "", /max-age=31536000/);

const metadataAccepted = await request("https://cloudpress.example/api/comments", { "Sec-Fetch-Site": "same-origin" });
assert.equal(metadataAccepted.status, 204, "Las mutaciones same-origin sin Origin deben continuar.");

const webhookAccepted = await request("https://cloudpress.example/api/plugins/cloudpress-commerce/webhooks/commerce-event", { "x-cloudpress-webhook-token": "test-token" });
assert.equal(webhookAccepted.status, 204, "Los webhooks autenticados deben poder llegar a su validador de token.");

const approvalAccepted = await request("https://cloudpress.example/api/admin/approvals/test/execute", { "x-cloudpress-approval-token": "test-token" });
assert.equal(approvalAccepted.status, 204, "La ejecución con token debe poder llegar al validador de aprobación de un solo uso.");
const recoveryAccepted = await request("https://cloudpress.example/api/totp-recovery/test/complete", { "x-cloudpress-recovery-token": "test-token" });
assert.equal(recoveryAccepted.status, 204, "La ejecución TOTP con capacidad de recuperación debe poder llegar a su validador.");

console.log(JSON.stringify({ ok: true, checks: ["cross-origin-rejected", "security-headers", "cross-site-metadata-rejected", "same-origin-accepted", "fetch-metadata-accepted", "webhook-token-exempt", "approval-token-exempt", "recovery-token-exempt"] }));
