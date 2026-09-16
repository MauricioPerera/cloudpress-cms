import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { bytesToBase64, currentUser, sha256 } from "../functions/_shared.js";
import { onRequestPost as issue } from "../functions/api/admin/agent-capability.js";
import { onRequestGet as list } from "../functions/api/admin/agent-capabilities.js";
import { onRequestDelete as revoke } from "../functions/api/admin/agent-capabilities/[id].js";
import { onRequest as middleware } from "../functions/_middleware.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const wrap = (sql, values = []) => ({
  async first() { return database.prepare(sql).get(...values) ?? null; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; },
});
const DB = {
  prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; },
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
};
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").run("admin", "hash", "salt", "admin");
const session = "session-qa-000000000000000000000000000001";
const sessionHash = bytesToBase64(await sha256(session));
await database.prepare("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)").run(1, sessionHash, new Date(Date.now() + 60_000).toISOString());
await database.prepare("INSERT INTO agent_capabilities(id,actor_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run("old-capability", 1, "old-hash", new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
const env = { DB };
const cookie = { Cookie: `session=${session}` };

const bearerDenied = await issue({ request: new Request("https://cms.example/api/admin/agent-capability", { method: "POST", headers: { Authorization: `Bearer ${"A".repeat(44)}` } }), env });
assert.equal(bearerDenied.status, 403, "Una capacidad no puede emitir otras capacidades.");

const issuedResponse = await issue({ request: new Request("https://cms.example/api/admin/agent-capability", { method: "POST", headers: cookie }), env });
assert.equal(issuedResponse.status, 201);
const issued = await issuedResponse.json();
assert.match(issued.token, /^[A-Za-z0-9+/=]{40,}$/);
assert.equal(database.prepare("SELECT COUNT(*) AS total FROM agent_capabilities WHERE revoked_at IS NULL").get().total, 1, "Rotar debe dejar una sola capacidad activa.");
assert.ok(database.prepare("SELECT revoked_at FROM agent_capabilities WHERE id='old-capability'").get().revoked_at);

const listedResponse = await list({ request: new Request("https://cms.example/api/admin/agent-capabilities", { headers: cookie }), env });
const listed = await listedResponse.json();
assert.ok(listed.capabilities.some((item) => item.id === issued.id && item.status === "active"));
assert.equal(JSON.stringify(listed).includes("token_hash"), false, "El listado nunca expone hashes ni bearers.");

const revokedResponse = await revoke({ request: new Request(`https://cms.example/api/admin/agent-capabilities/${issued.id}`, { method: "DELETE", headers: cookie }), env, params: { id: issued.id } });
assert.equal(revokedResponse.status, 200);
assert.ok(database.prepare("SELECT revoked_at FROM agent_capabilities WHERE id=?").get(issued.id).revoked_at);

const raw = "J2P8KtCwXdeJY9Jca4dA6qHUlN5SgB1m0qVw7eRz3hQ=";
const hash = bytesToBase64(await sha256(raw));
await database.prepare("INSERT INTO agent_capabilities(id,actor_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run("scoped-capability", 1, hash, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
const auth = { Authorization: `Bearer ${raw}` };
assert.equal((await currentUser(new Request("https://cms.example/api/admin/users", { headers: auth }), env))?.id, 1);
assert.equal(await currentUser(new Request("https://cms.example/api/admin/export", { headers: auth }), env), null, "La capacidad no debe leer exportaciones administrativas.");
assert.equal(await currentUser(new Request("https://cms.example/api/admin/settings", { headers: auth }), env), null, "La capacidad no debe heredar futuros GET administrativos.");
assert.equal((await currentUser(new Request("https://cms.example/api/admin/trash/7", { method: "POST", headers: auth }), env))?.id, 1, "Restaurar desde Papelera debe permanecer permitido.");
const companionMutation = await middleware({ request: new Request("https://cms.example/api/admin/entries", { method: "POST", headers: auth }), env, next: async () => new Response(null, { status: 204 }) });
assert.equal(companionMutation.status, 204, "El middleware debe aceptar al companion no-browser y dejar la autorización final a la ruta.");

database.close();
console.log(JSON.stringify({ ok: true, checks: ["browser-only-issuance", "single-active-rotation", "safe-listing", "operational-revocation", "server-side-scope", "non-browser-companion"] }));
