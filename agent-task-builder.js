(() => {
  const task = document.querySelector("#task");
  if (!task || document.querySelector("#task-step-config")) return;
  const configs = document.createElement("div");
  configs.id = "task-step-config";
  configs.className = "task-step-config";
  document.querySelector("#task-tools")?.after(configs);
  const notice = (message, error = false) => {
    const element = document.querySelector("#notice");
    if (!element) return;
    element.textContent = message;
    element.className = `notice${error ? " error" : ""}`;
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const selected = () => Array.from(task.querySelectorAll('input[name="step"]:checked')).map((input, index) => {
    const [tool, risk] = input.value.split("|"); return { tool, risk, index };
  });
  const fields = ({ tool, index }) => {
    const name = (field) => `data-step-${index}-${field}`;
    if (tool === "cloudpress_read_admin_state") return `<label class="field">Recurso a consultar<select ${name("resource")}><option value="content">Entradas y páginas</option><option value="users">Usuarios</option><option value="taxonomies">Taxonomías</option><option value="menus">Menús</option><option value="plugins">Plugins</option><option value="media">Medios</option><option value="blocks">Bloques</option></select></label>`;
    if (tool === "cloudpress_create_draft") return `<label class="field">Título<input ${name("title")} maxlength="180" required></label><label class="field">Slug opcional<input ${name("slug")} maxlength="96"></label><label class="field">Extracto<textarea ${name("excerpt")} maxlength="500"></textarea></label><label class="field">Contenido<textarea ${name("body")} maxlength="50000"></textarea></label>`;
    if (tool === "cloudpress_update_content") return `<label class="field">ID del contenido<input ${name("id")} type="number" min="1" required></label><label class="field">Nuevo título opcional<input ${name("title")} maxlength="180"></label><label class="field">Nuevo extracto opcional<textarea ${name("excerpt")} maxlength="500"></textarea></label><label class="field">Nuevo contenido opcional<textarea ${name("body")} maxlength="50000"></textarea></label>`;
    if (tool === "cloudpress_trash_content" || tool === "cloudpress_restore_content") return `<label class="field">ID del contenido<input ${name("id")} type="number" min="1" required></label>`;
    return `<p class="muted">Esta herramienta requiere un plan preparado por un proveedor gobernado y no se puede enviar manualmente todavía.</p>`;
  };
  const render = () => {
    const steps = selected();
    configs.innerHTML = steps.length ? `<h3>Datos de ejecución</h3>${steps.map((step) => `<section class="task-step-card" data-tool="${esc(step.tool)}"><h4>Paso ${step.index + 1}: ${esc(step.tool)}</h4>${fields(step)}</section>`).join("")}` : "";
    task.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = steps.some((step) => !["cloudpress_read_admin_state", "cloudpress_create_draft", "cloudpress_update_content", "cloudpress_trash_content", "cloudpress_restore_content"].includes(step.tool)); });
  };
  const value = (index, field) => task.querySelector(`[data-step-${index}-${field}]`)?.value;
  const plan = () => selected().map((step) => {
    const expected = { verified: true };
    let input = {};
    if (step.tool === "cloudpress_read_admin_state") expected.resource = value(step.index, "resource");
    if (step.tool === "cloudpress_create_draft") input = { operation: "create_draft", title: value(step.index, "title"), slug: value(step.index, "slug"), excerpt: value(step.index, "excerpt"), body: value(step.index, "body") };
    if (step.tool === "cloudpress_update_content") input = { operation: "update_content", id: Number(value(step.index, "id")), title: value(step.index, "title"), excerpt: value(step.index, "excerpt"), body: value(step.index, "body") };
    if (step.tool === "cloudpress_trash_content") input = { operation: "trash_content", id: Number(value(step.index, "id")) };
    if (step.tool === "cloudpress_restore_content") input = { operation: "restore_content", id: Number(value(step.index, "id")) };
    return { tool: step.tool, risk: step.risk, preconditions: { authorized: true }, expected, input };
  });
  task.addEventListener("change", render);
  task.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(task), steps = plan();
    if (!steps.length) return notice("Selecciona al menos un paso.", true);
    const estimated = form.get("estimatedCost");
    const payload = { action: "create_task", profileId: form.get("profileId"), objective: form.get("objective"), plan: steps, context: { classification: form.get("classification"), admission: { estimatedCost: estimated === "" ? steps.length : Number(estimated), dependencies: String(form.get("dependencies") || "").split(/\s+/).filter(Boolean), phase: "implementation" } }, expected: { verified: true } };
    try {
      const response = await fetch("/api/admin/agent-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      task.reset(); render(); notice("Tarea creada y preparada para el runner."); document.querySelector("#refresh")?.click();
    } catch (error) { notice(error.message || "No se pudo crear la tarea.", true); }
  };
  render();
})();
