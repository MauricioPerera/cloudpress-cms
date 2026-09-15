(() => {
  let definitions = null;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const id = () => crypto.randomUUID();
  const fallback = (item) => ({ version: 1, blocks: [{ id: id(), type: "core/legacy", attributes: { html: item.body || "" } }] });
  const blank = () => ({ version: 1, blocks: [{ id: id(), type: "core/paragraph", attributes: { content: "" } }] });
  const notify = (message, error = false) => window.CloudPressUI?.toast ? CloudPressUI.toast(message, error ? "error" : undefined) : alert(message);
  const definition = (type) => definitions?.find((item) => item.type === type);
  const defaultAttributes = (item) => Object.fromEntries(Object.entries(item.attributes?.properties || {}).map(([key, rule]) => [key, rule.type === "boolean" ? false : rule.type === "number" ? (rule.minimum ?? (key === "level" ? 2 : 0)) : ""]));
  const toLocalDateTime = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; };
  const scheduled = (item) => item.status === "draft" && item.published_at && new Date(item.published_at).getTime() > Date.now();
  const remember = (root, item) => { const form = root.querySelector("#content-form"); if (form) item._draft = { title: form.title.value, slug: form.slug.value, excerpt: form.excerpt.value, status: form.status.value, publishedAt: form.publishedAt.value, terms: [...root.querySelectorAll(".term:checked")].map((input) => Number(input.value)) }; };
  const field = (block, key, rule) => {
    const value = block.attributes[key] ?? "", label = key === "items" ? "Elementos (uno por línea)" : key === "src" ? "URL de medio" : key === "alt" ? "Texto alternativo" : key === "content" ? "Contenido" : key;
    if (rule.type === "boolean") return `<label class="cp-block-field"><input data-block="${block.id}" data-key="${key}" type="checkbox" ${value ? "checked" : ""}> ${esc(label)}</label>`;
    if (key === "content" || key === "items" || key === "html") return `<label class="cp-block-field">${esc(label)}<textarea data-block="${block.id}" data-key="${key}" rows="${key === "html" ? 7 : 4}">${esc(value)}</textarea></label>`;
    return `<label class="cp-block-field">${esc(label)}<input data-block="${block.id}" data-key="${key}" type="${rule.type === "number" ? "number" : "text"}" value="${esc(value)}" ${rule.minimum !== undefined ? `min="${rule.minimum}"` : ""} ${rule.maximum !== undefined ? `max="${rule.maximum}"` : ""}></label>`;
  };
  const blockCard = (block, index) => {
    const spec = definition(block.type) || (block.type === "core/legacy" ? { label: "Contenido HTML heredado", icon: "</>", attributes: { properties: { html: { type: "string" } } } } : null);
    if (!spec) return `<article class="cp-block cp-block-error">Bloque no disponible: ${esc(block.type)}</article>`;
    return `<article class="cp-block" data-card="${block.id}"><header><span>${esc(spec.icon || "▦")} ${esc(spec.label)}</span><span class="cp-block-actions"><button type="button" data-move="up" data-id="${block.id}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-move="down" data-id="${block.id}" ${index === state.editing.item.blocks.blocks.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-remove="${block.id}" aria-label="Eliminar bloque">×</button></span></header><div class="cp-block-fields">${Object.entries(spec.attributes?.properties || {}).map(([key, rule]) => field(block, key, rule)).join("")}${block.type === "core/image" ? '<p class="help">Usa una URL que empiece por <code>/media/</code> desde la biblioteca.</p>' : ""}</div></article>`;
  };
  const editor = (item) => {
    if (!item.blocks || !definitions) return '<div class="card">Cargando editor de bloques…</div>';
    const draft = item._draft || {}, terms = state.terms.map((term) => `<label><input class="term" type="checkbox" value="${term.id}" ${draft.terms?.includes(term.id) || (!draft.terms && (item.terms || []).some((current) => current.id === term.id)) ? "checked" : ""}> ${esc(term.name)} <small>${term.type === "category" ? "Categoría" : "Etiqueta"}</small></label>`).join("<br>") || '<small>No hay categorías ni etiquetas.</small>';
    const isScheduled = scheduled(item), scheduledAt = draft.publishedAt ?? (isScheduled ? toLocalDateTime(item.published_at) : "");
    return `<div class="layout"><form id="content-form" class="card"><div class="editor-field"><label>Título</label><input class="title-input" name="title" required value="${esc(draft.title ?? item.title ?? "")}"></div><div class="editor-field"><label>Slug</label><input name="slug" value="${esc(draft.slug ?? item.slug ?? "")}" placeholder="se-genera-desde-el-titulo"></div><div class="editor-field"><label>Extracto</label><textarea name="excerpt" style="min-height:82px">${esc(draft.excerpt ?? item.excerpt ?? "")}</textarea></div><div class="editor-field"><label>Bloques</label><div class="cp-inserter">${definitions.map((spec) => `<button type="button" data-add="${spec.type}" title="Añadir ${esc(spec.label)}">${esc(spec.icon || "▦")} ${esc(spec.label)}</button>`).join("")}</div><div id="blocks-canvas" class="cp-canvas">${item.blocks.blocks.map(blockCard).join("")}</div></div><div class="toolbar"><button class="button">${item.id ? "Actualizar" : "Guardar"}</button><button type="button" class="button secondary" id="cancel-editor">Cancelar</button></div></form><aside class="card"><h2 class="panel-title">Publicar</h2><div class="editor-field"><label>Estado</label><select name="status" form="content-form"><option value="draft" ${draft.status === "draft" || (!draft.status && item.status !== "published" && !isScheduled) ? "selected" : ""}>Borrador</option><option value="published" ${draft.status === "published" || (!draft.status && (item.status === "published" || isScheduled)) ? "selected" : ""}>Publicado</option></select></div><div class="editor-field"><label>Programar publicación <small>(opcional)</small></label><input name="publishedAt" form="content-form" type="datetime-local" value="${esc(scheduledAt)}"><p class="help">Con estado Publicado y una fecha futura, se conserva como borrador hasta que el scheduler lo publique. Borra la fecha para publicar ahora.</p></div><div class="editor-field"><label>Clasificación</label>${terms}</div><p class="help">Los bloques se guardan como documento estructurado y se convierten a HTML saneado al publicar.</p></aside></div>`;
  };
  async function load(root, kind) {
    const item = state.editing.item;
    try {
      const response = await api(`/api/admin/blocks${item.id ? `?contentId=${item.id}` : ""}`);
      definitions = response.definitions;
      item.blocks = response.document?.document || (item.id ? fallback(item) : blank());
      renderContent(kind);
    } catch (error) { notify(error.message, true); state.editing = null; renderContent(kind); }
  }
  function bind(root, kind) {
    const item = state.editing.item;
    if (!item.blocks || !definitions) { load(root, kind); return; }
    const form = root.querySelector("#content-form");
    root.querySelectorAll("[data-add]").forEach((button) => button.onclick = () => { remember(root, item); const spec = definition(button.dataset.add); item.blocks.blocks.push({ id: id(), type: spec.type, attributes: defaultAttributes(spec) }); renderContent(kind); });
    root.querySelectorAll("[data-remove]").forEach((button) => button.onclick = () => { if (item.blocks.blocks.length === 1) return notify("El documento debe tener al menos un bloque.", true); remember(root, item); item.blocks.blocks = item.blocks.blocks.filter((block) => block.id !== button.dataset.remove); renderContent(kind); });
    root.querySelectorAll("[data-move]").forEach((button) => button.onclick = () => { remember(root, item); const index = item.blocks.blocks.findIndex((block) => block.id === button.dataset.id), next = button.dataset.move === "up" ? index - 1 : index + 1; if (next < 0 || next >= item.blocks.blocks.length) return; [item.blocks.blocks[index], item.blocks.blocks[next]] = [item.blocks.blocks[next], item.blocks.blocks[index]]; renderContent(kind); });
    root.querySelectorAll("[data-block][data-key]").forEach((input) => input.oninput = () => { const block = item.blocks.blocks.find((entry) => entry.id === input.dataset.block), spec = definition(block.type) || { attributes: { properties: { html: { type: "string" } } } }, rule = spec.attributes.properties[input.dataset.key]; block.attributes[input.dataset.key] = rule?.type === "boolean" ? input.checked : rule?.type === "number" ? Number(input.value) : input.value; });
    root.querySelector("#cancel-editor").onclick = () => { state.editing = null; renderContent(kind); };
    form.onsubmit = async (event) => { event.preventDefault(); const scheduledAt = form.publishedAt.value ? new Date(form.publishedAt.value).toISOString() : null; const payload = { kind, title: form.title.value, slug: form.slug.value, excerpt: form.excerpt.value, status: form.status.value, publishedAt: scheduledAt, blocks: item.blocks, termIds: [...root.querySelectorAll(".term:checked")].map((input) => Number(input.value)) }; try { const result = item.id ? await api(`/api/admin/entries/${item.id}`, "PATCH", payload) : await api("/api/admin/entries", "POST", payload); await loadContent(kind); state.editing = null; renderContent(kind); await loadOverview(); notify(result.scheduled ? "Contenido programado." : "Contenido guardado."); } catch (error) { notify(error.message, true); } };
  }
  const style = document.createElement("style");
  style.textContent = ".cp-inserter{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 12px}.cp-inserter button,.cp-block-actions button{border:1px solid #c3c4c7;background:#fff;border-radius:4px;padding:5px 8px;cursor:pointer}.cp-inserter button:hover{border-color:#2271b1;color:#135e96}.cp-canvas{display:grid;gap:10px}.cp-block{background:#fff;border:1px solid #c3c4c7;border-radius:6px}.cp-block header{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f6f7f7;font-weight:650}.cp-block-actions{display:flex;gap:4px}.cp-block-actions button:last-child{color:#b32d2e}.cp-block-fields{padding:12px;display:grid;gap:10px}.cp-block-field{display:grid;gap:5px;font-weight:600}.cp-block-field input,.cp-block-field textarea{font-weight:400}.cp-block-field:has(input[type=checkbox]){display:block}.cp-block-error{border-color:#b32d2e;color:#b32d2e;padding:12px}";
  document.head.append(style);
  contentEditor = editor;
  bindContentEditor = bind;
})();
