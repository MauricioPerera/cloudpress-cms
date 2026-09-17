import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/plugins/[pluginId]/[[path]].js";

const database = new DatabaseSync(":memory:");
database.exec(await readFile("schema.sql", "utf8"));
const wrap = (sql, values = []) => ({
  async first() { return database.prepare(sql).get(...values) ?? null; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
});
const DB = { prepare(sql) { return { bind(...values) { return wrap(sql, values); }, ...wrap(sql) }; } };
await database.prepare("INSERT INTO users(username,password_hash,password_salt,role) VALUES('admin','hash','salt','admin')").run();
await database.prepare("INSERT INTO plugin_installations(plugin_id,manifest_json,status,installed_by) VALUES(?,?,'enabled',1)").run("cloudpress-commerce", "{}");
await database.prepare("INSERT INTO plugin_records(plugin_id,collection_id,record_key,value_json) VALUES(?,?,?,?)").run("cloudpress-commerce", "products", "qa", JSON.stringify({ sku: "qa", name: "Producto QA", price: 10, stock: 2 }));
const env = { DB };
const catalog = await onRequest({ request: new Request("https://cms.example/api/plugins/cloudpress-commerce/catalog"), env, params: { pluginId: "cloudpress-commerce", path: ["catalog"] } });
assert.equal(catalog.status, 200, "La ruta GET declarada pública debe funcionar sin sesión.");
assert.equal((await catalog.json()).result.products[0].sku, "qa");
const cart = await onRequest({ request: new Request("https://cms.example/api/plugins/cloudpress-commerce/cart"), env, params: { pluginId: "cloudpress-commerce", path: ["cart"] } });
assert.equal(cart.status, 403, "Una ruta sin public:true debe continuar exigiendo sesión.");
database.close();
console.log(JSON.stringify({ ok: true, checks: ["public-plugin-get", "private-plugin-route-denied"] }));
