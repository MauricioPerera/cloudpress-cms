import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { bytesToBase64, requireAdmin } from "../functions/_shared.js";
import { onRequestGet as listRoles, onRequestPost as createRole } from "../functions/api/admin/roles/index.js";
import { onRequestDelete as deleteRole } from "../functions/api/admin/roles/[id].js";
import { onRequestPost as createUser } from "../functions/api/admin/users/index.js";
import { allowed } from "../functions/_plugins/execute.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const wrap = (sql, values = []) => ({
  async first() { return database.prepare(sql).get(...values) ?? null; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; },
});
const DB = { prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; }, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } };
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").run("admin", "hash", "salt", "admin");
const raw = "r".repeat(44), tokenHash = bytesToBase64(new TextEncoder().encode(raw));
// currentSessionUser hashes the opaque value; store the actual SHA-256 via the platform helper path instead.
const cryptoHash = bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
await database.prepare("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)").run(1, cryptoHash, new Date(Date.now() + 60_000).toISOString());
const env = { DB }, headers = { Cookie: `session=${raw}`, "content-type": "application/json" };

const initial = await listRoles({ request: new Request("https://cms.example/api/admin/roles", { headers }), env });
assert.equal(initial.status, 200);
assert.deepEqual((await initial.json()).roles.map((role) => role.id).sort(), ["admin", "author", "user"]);

const external = await createRole({ request: new Request("https://cms.example/api/admin/roles", { method: "POST", headers, body: JSON.stringify({ id: "vendedor", label: "Vendedor", scope: "external", permissions: [] }) }), env });
assert.equal(external.status, 201);
const blocked = await createRole({ request: new Request("https://cms.example/api/admin/roles", { method: "POST", headers, body: JSON.stringify({ id: "falso-admin", label: "Falso admin", scope: "external", permissions: ["dashboard:access"] }) }), env });
assert.equal(blocked.status, 422, "Un rol externo no puede abrir el panel.");
const manager = await createRole({ request: new Request("https://cms.example/api/admin/roles", { method: "POST", headers, body: JSON.stringify({ id: "operador", label: "Operador", scope: "management", permissions: ["dashboard:access"] }) }), env });
assert.equal(manager.status, 201);
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").run("operator", "hash", "salt", "operador");
const operator = { id: 2, username: "operator", role: "operador" };
assert.equal(Boolean(await requireAdmin(new Request("https://cms.example/api/admin/stats"), { DB: { ...DB, prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; } } })), false, "Una petición sin sesión sigue rechazada.");
assert.equal(Boolean(await (await import("../functions/_roles.js")).hasCorePermission(env, operator, "dashboard:access")), true, "Un rol de gestión obtiene sólo el permiso concedido.");
const operatorToken = "o".repeat(44), operatorHash = bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operatorToken))));
await database.prepare("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)").run(2, operatorHash, new Date(Date.now() + 60_000).toISOString());
const prohibitedAssignment = await createUser({ request: new Request("https://cms.example/api/admin/users", { method: "POST", headers: { Cookie: `session=${operatorToken}`, "content-type": "application/json" }, body: JSON.stringify({ username: "privileged-user", password: "valid-password-123", role: "admin" }) }), env });
assert.equal(prohibitedAssignment.status, 403, "Acceder al panel no permite asignar ni elevar roles.");
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").run("seller", "hash", "salt", "vendedor");
await database.prepare("INSERT INTO plugin_installations(plugin_id,manifest_json,status,installed_by) VALUES(?,?,?,?)").run("test-shop", "{}", "enabled", 1);
await database.prepare("INSERT INTO plugin_capabilities(plugin_id,capability_id,label) VALUES(?,?,?)").run("test-shop", "manage-orders", "Gestionar pedidos");
await database.prepare("INSERT INTO plugin_role_capabilities(plugin_id,capability_id,role) VALUES(?,?,?)").run("test-shop", "manage-orders", "vendedor");
assert.equal(await allowed(env, { id: 3, role: "vendedor" }, "test-shop", "manage-orders"), true, "Una capacidad de plugin puede concederse a un rol externo.");
assert.equal(await allowed(env, { id: 1, role: "user" }, "test-shop", "manage-orders"), false, "Una capacidad de plugin no se hereda a otros roles.");
const deletion = await deleteRole({ request: new Request("https://cms.example/api/admin/roles/vendedor", { method: "DELETE", headers }), env, params: { id: "vendedor" } });
assert.equal(deletion.status, 409, "No se elimina un rol mientras tenga usuarios asignados.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["built-in-roles", "external-role", "external-cannot-manage", "management-permission", "privilege-escalation-denied", "plugin-capability-external-role", "assigned-role-protected"] }));
