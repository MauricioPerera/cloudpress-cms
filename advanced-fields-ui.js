(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const input = (field, values) => {
    const key = `${field.group_id}.${field.field_id}`, value = values?.[key] ?? "", required = field.required ? " required" : "";
    if (field.value_type === "boolean") return `<label class="cp-advanced-field"><input data-advanced="${esc(key)}" type="checkbox" ${value ? "checked" : ""}> ${esc(field.label)}</label>`;
    if (field.value_type === "textarea") return `<label class="cp-advanced-field">${esc(field.label)}${field.required ? " *" : ""}<textarea data-advanced="${esc(key)}"${required}>${esc(value)}</textarea></label>`;
    if (field.value_type === "select") return `<label class="cp-advanced-field">${esc(field.label)}${field.required ? " *" : ""}<select data-advanced="${esc(key)}"${required}><option value="">Selecciona…</option>${field.settings.options.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    const type = field.value_type === "number" || field.value_type === "reference" ? "number" : ["date", "email", "url"].includes(field.value_type) ? field.value_type : "text";
    return `<label class="cp-advanced-field">${esc(field.label)}${field.required ? " *" : ""}<input data-advanced="${esc(key)}" type="${type}" value="${esc(value)}"${field.settings.maxLength ? ` maxlength="${field.settings.maxLength}"` : ""}${type === "number" && field.value_type === "reference" ? " min=\"1\" step=\"1\"" : ""}${required}></label>`;
  };
  window.CloudPressAdvancedFields = {
    async load(contentType) { const response = await fetch(`/api/admin/advanced-fields?contentType=${encodeURIComponent(contentType)}`); const data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || "No se pudieron cargar los metadatos."); return data.groups || []; },
    markup(groups, values = {}) { return groups.length ? `<section class="cp-advanced-fields"><h2>Metadatos personalizados</h2>${groups.map((group) => `<fieldset class="cp-advanced-group"><legend>${esc(group.title)}</legend>${group.fields.map((field) => input({ ...field, group_id: group.group_id }, values)).join("")}</fieldset>`).join("")}</section>` : ""; },
    collect(root) { return Object.fromEntries([...root.querySelectorAll("[data-advanced]")].map((field) => [field.dataset.advanced, field.type === "checkbox" ? field.checked : field.type === "number" && field.value !== "" ? Number(field.value) : field.value])); }
  };
})();
