const key = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "");

async function product(context, sku) {
  return context.data.get("products", key(sku));
}

export default {
  async "content.beforeCreate"(content) {
    if (content.contentType !== "product") return { allow: true };
    return content.excerpt?.trim() ? { allow: true } : { allow: true, patch: { excerpt: "Producto de CloudPress Commerce." } };
  },
  actions: {
    async "create-product"(context, input) {
      const sku = key(input.sku); if (!sku || input.price < 0 || input.stock < 0) throw new Error("Producto inválido.");
      if (await product(context, sku)) throw new Error("El SKU ya existe.");
      const value = { sku, name: input.name.trim(), price: input.price, stock: input.stock, status: "active" };
      await context.data.put("products", sku, value);
      await context.audit("commerce_product_created", { sku });
      return value;
    },
    async "create-customer"(context, input) {
      const email = String(input.email || "").trim().toLowerCase();
      const name = String(input.name || "").trim();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Cliente inválido.");
      const customerKey = key(email); if (await context.data.get("customers", customerKey)) throw new Error("El cliente ya existe.");
      const value = { id: crypto.randomUUID(), name, email, createdAt: new Date().toISOString() };
      await context.data.put("customers", customerKey, value); await context.audit("commerce_customer_created", { customerKey });
      return value;
    },
    async "adjust-inventory"(context, input) {
      const sku = key(input.sku), row = await product(context, sku); if (!row) throw new Error("Producto no encontrado.");
      const stock = row.value.stock + input.delta; if (stock < 0) throw new Error("Inventario insuficiente.");
      const value = { ...row.value, stock }; await context.data.put("products", sku, value);
      await context.enqueue("inventory-reconciled", { sku, stock }, { dedupeKey: `${sku}-${stock}` });
      await context.audit("commerce_inventory_adjusted", { sku, delta: input.delta, stock });
      return value;
    },
    async "add-cart-item"(context, input) {
      if (!context.actor.id) throw new Error("Se requiere autenticación.");
      const sku = key(input.sku), item = await product(context, sku); if (!item || item.value.stock < input.quantity || input.quantity < 1) throw new Error("Producto o cantidad inválidos.");
      const cartKey = `user-${context.actor.id}`, cart = await context.data.get("carts", cartKey), items = cart?.value.items || [];
      const existing = items.find((entry) => entry.sku === sku); if (existing) existing.quantity += input.quantity; else items.push({ sku, quantity: input.quantity });
      const value = { items, updatedAt: new Date().toISOString() }; await context.data.put("carts", cartKey, value, { subjectUserId: context.actor.id });
      return value;
    },
    async "create-order"(context) {
      if (!context.actor.id) throw new Error("Se requiere autenticación.");
      const cart = await context.data.get("carts", `user-${context.actor.id}`); if (!cart?.value.items?.length) throw new Error("El carrito está vacío.");
      const lines = []; let total = 0;
      for (const item of cart.value.items) { const current = await product(context, item.sku); if (!current || current.value.stock < item.quantity) throw new Error(`Inventario insuficiente para ${item.sku}.`); const updated = { ...current.value, stock: current.value.stock - item.quantity }; await context.data.put("products", item.sku, updated); lines.push({ sku: item.sku, quantity: item.quantity, unitPrice: current.value.price }); total += current.value.price * item.quantity; }
      const id = crypto.randomUUID(), value = { id, customerId: context.actor.id, lines, total, status: "pending", createdAt: new Date().toISOString() };
      await context.data.put("orders", id, value, { subjectUserId: context.actor.id }); await context.data.remove("carts", `user-${context.actor.id}`); await context.audit("commerce_order_created", { id, total });
      return value;
    }
  },
  routes: {
    async catalog(context) { return { products: (await context.data.list("products")).map((row) => row.value) }; },
    async cart(context) { return { cart: context.actor.id ? await context.data.get("carts", `user-${context.actor.id}`) : null }; }
  },
  webhooks: {
    async "commerce-event"(context, { body }) {
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.event !== "string" || !body.event.trim()) throw new Error("Evento de Commerce inválido.");
      const id = crypto.randomUUID(), value = { id, event: body.event.trim(), payload: body.payload ?? null, receivedAt: new Date().toISOString() };
      await context.data.put("events", `webhook-${id}`, value);
      await context.audit("commerce_webhook_received", { event: value.event });
      return { received: true, id, event: value.event };
    }
  },
  tasks: {
    async "inventory-reconciled"(context, payload) { await context.data.put("events", `inventory-${payload.sku}-${payload.stock}`, { type: "inventory-reconciled", ...payload }); return { reconciled: true, ...payload }; }
  },
  diagnostics: async (context) => ({ products: (await context.data.list("products")).length, orders: (await context.data.list("orders")).length })
};
