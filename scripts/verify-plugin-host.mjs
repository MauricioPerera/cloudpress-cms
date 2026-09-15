import assert from "node:assert/strict";
import commerce from "../plugins/cloudpress-commerce/plugin.js";
import { generatedPluginRegistry } from "../functions/_plugins/generated-registry.js";

assert.equal(generatedPluginRegistry.get("cloudpress-commerce")?.manifest.id, "cloudpress-commerce", "El registro generado debe descubrir Commerce sin editar el core.");

const records = new Map();
const jobs = new Map();
const audits = [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const context = {
  actor: { id: 42, role: "user" },
  data: {
    async get(collection, key) { const row = records.get(`${collection}:${key}`); return row ? clone(row) : null; },
    async list(collection) { return [...records.entries()].filter(([key]) => key.startsWith(`${collection}:`)).map(([, value]) => clone(value)); },
    async put(collection, key, value, { subjectUserId = null } = {}) { const row = { key, value: clone(value), subjectUserId }; records.set(`${collection}:${key}`, row); return clone(row); },
    async remove(collection, key) { return { removed: records.delete(`${collection}:${key}`) }; }
  },
  async enqueue(taskId, payload, { dedupeKey }) { const key = `${taskId}:${dedupeKey}`; const queued = !jobs.has(key); if (queued) jobs.set(key, clone(payload)); return { queued, dedupeKey }; },
  async audit(action, details) { audits.push({ action, details: clone(details) }); }
};

const product = await commerce.actions["create-product"](context, { sku: "QA-SKU-1", name: "Producto QA", price: 25, stock: 5 });
assert.deepEqual(product, { sku: "qa-sku-1", name: "Producto QA", price: 25, stock: 5, status: "active" });
await assert.rejects(() => commerce.actions["create-product"](context, { sku: "QA-SKU-1", name: "Duplicado", price: 1, stock: 1 }), /SKU ya existe/);
const adjusted = await commerce.actions["adjust-inventory"](context, { sku: "QA-SKU-1", delta: 2 });
assert.equal(adjusted.stock, 7);
assert.equal(jobs.size, 1, "El ajuste debe crear una sola tarea diferida.");
const duplicateJob = await context.enqueue("inventory-reconciled", { sku: "qa-sku-1", stock: 7 }, { dedupeKey: "qa-sku-1-7" });
assert.equal(duplicateJob.queued, false, "La misma tarea debe ser idempotente.");
await commerce.actions["add-cart-item"](context, { sku: "QA-SKU-1", quantity: 3 });
const order = await commerce.actions["create-order"](context, {});
assert.equal(order.status, "pending");
assert.equal(order.total, 75);
assert.equal((await context.data.get("products", "qa-sku-1")).value.stock, 4);
assert.equal(await context.data.get("carts", "user-42"), null, "El pedido debe vaciar el carrito.");
await commerce.tasks["inventory-reconciled"](context, [...jobs.values()][0]);
assert.equal((await context.data.get("events", "inventory-qa-sku-1-7")).value.type, "inventory-reconciled");
await assert.rejects(() => commerce.actions["adjust-inventory"](context, { sku: "QA-SKU-1", delta: -9 }), /Inventario insuficiente/);
assert.ok(audits.some((entry) => entry.action === "commerce_order_created"));
console.log(JSON.stringify({ ok: true, checks: ["product", "duplicate-sku", "inventory", "idempotent-job", "cart", "order", "task", "insufficient-stock", "audit"] }, null, 2));
