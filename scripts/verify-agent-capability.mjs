import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { bytesToBase64, currentUser, sha256 } from "../functions/_shared.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const DB = { prepare(sql) { return { bind(...values) { return { async first() { return database.prepare(sql).get(...values) ?? null; }, async all() { return { results: database.prepare(sql).all(...values) }; } }; } }; } };
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").run("admin", "hash", "salt", "admin");
await database.prepare("INSERT INTO agent_profiles(id,owner_id,label,purpose,status,max_active_runs,max_steps_per_run,data_policy_json) VALUES(?,?,?,?,?,?,?,?)").run("reader-agent", 1, "Lector", "Sólo lectura", "active", 1, 2, JSON.stringify({ maximumClassification: "public", allowSensitive: false }));
await database.prepare("INSERT INTO agent_profile_tools(profile_id,tool_name,risk) VALUES(?,?,?)").run("reader-agent", "cloudpress_read_admin_state", "read");
const raw = "J2P8KtCwXdeJY9Jca4dA6qHUlN5SgB1m0qVw7eRz3hQ=";
const hash = bytesToBase64(await sha256(raw));
await database.prepare("INSERT INTO agent_capabilities(id,actor_id,profile_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)").run("capability-qa-0001", 1, "reader-agent", hash, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());

const authorized = await currentUser(new Request("https://cms.example/api/admin/entries", { headers: { Authorization: `Bearer ${raw}` } }), { DB });
assert.equal(authorized.id, 1);
assert.equal(authorized.username, "admin");
assert.equal(authorized.role, "admin");
assert.equal(authorized.active, 1);
assert.equal(await currentUser(new Request("https://cms.example/api/admin/entries", { headers: { Authorization: "Bearer invalid" } }), { DB }), null);
await database.prepare("UPDATE agent_capabilities SET revoked_at=? WHERE id=?").run(new Date().toISOString(), "capability-qa-0001");
assert.equal(await currentUser(new Request("https://cms.example/api/admin/entries", { headers: { Authorization: `Bearer ${raw}` } }), { DB }), null, "Una capacidad revocada no autentica al agente.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["agent-capability-hashed", "agent-capability-authenticates", "revoked-capability-rejected"] }));
