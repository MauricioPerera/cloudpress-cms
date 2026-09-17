import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { executeApproval, prepareApproval } from "../functions/_approvals.js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));

const DB = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() { return database.prepare(sql).get(...values) ?? null; },
          async all() { return { results: database.prepare(sql).all(...values) }; },
          async run() {
            const result = database.prepare(sql).run(...values);
            return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
          },
        };
      },
    };
  },
};
const env = { DB, MEDIA: { async head() { return null; }, async delete() {} } };

await DB.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES(?,?,?,?)").bind("admin", "hash", "salt", "admin").run();
await DB.prepare("INSERT INTO content_items(kind,content_type,title,slug,status,trashed_from_status,trashed_at,author_id) VALUES(?,?,?,?,?,?,?,?)").bind("post", "post", "Datos QA", "datos-qa", "trash", "draft", new Date().toISOString(), 1).run();

const prepared = await prepareApproval(env, { id: 1, role: "admin" }, { operation: "purge_content", contentId: 1 });
assert.equal(prepared.risk, "irreversible");
assert.equal(typeof prepared.executionToken, "string");
const stored = await DB.prepare("SELECT token_hash,state,payload_json FROM approval_requests WHERE id=?").bind(prepared.requestId).first();
assert.notEqual(stored.token_hash, prepared.executionToken, "El token nunca se almacena en texto plano.");
assert.equal(stored.state, "pending");

const executed = await executeApproval(env, prepared.requestId, prepared.executionToken);
assert.equal(executed.status, 200);
const executedPayload = await executed.json();
assert.deepEqual({ ok: executedPayload.ok, requestId: executedPayload.requestId, operation: executedPayload.operation, state: executedPayload.state, result: executedPayload.result }, { ok: true, requestId: prepared.requestId, operation: "purge_content", state: "accepted", result: { deleted: "content", id: 1 } });
assert.match(executedPayload.correlationId, /^[0-9a-f-]{36}$/i, "Una respuesta con requestId operativo expone correlationId.");
assert.equal(executed.headers.get("x-request-id"), executedPayload.correlationId);
assert.equal(await DB.prepare("SELECT id FROM content_items WHERE id=?").bind(1).first(), null, "La acción aprobada debe ejecutarse exactamente una vez.");

const replay = await executeApproval(env, prepared.requestId, prepared.executionToken);
assert.equal(replay.status, 409, "Un token consumido no puede ejecutar de nuevo la operación.");
const events = await DB.prepare("SELECT event FROM approval_events WHERE request_id=? ORDER BY id").bind(prepared.requestId).all();
assert.deepEqual(events.results.map((row) => row.event), ["prepared", "executing", "accepted"]);

await assert.rejects(() => prepareApproval(env, { id: 1, role: "admin" }, { operation: "delete_user", userId: 1 }), /No puedes eliminar esta cuenta/);
database.close();
console.log(JSON.stringify({ ok: true, checks: ["approval-token-hashed", "approved-action-executed", "single-use-consumption", "approval-audit", "self-delete-rejected"] }));
