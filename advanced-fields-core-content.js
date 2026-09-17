(() => {
  window.addEventListener("load", async () => {
    if (!location.pathname.endsWith("/core-content.html") && !location.pathname.endsWith("/core-content")) return;
    const type = new URLSearchParams(location.search).get("type"), form = document.querySelector("#form"), area = document.querySelector("#fields"), message = document.querySelector("#message");
    if (!type || !form || !area || !window.CloudPressAdvancedFields) return;
    try {
      const groups = await CloudPressAdvancedFields.load(type);
      if (groups.length) area.insertAdjacentHTML("beforeend", CloudPressAdvancedFields.markup(groups));
      form.addEventListener("submit", async (event) => {
        if (!groups.length) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const customFields = Object.fromEntries([...form.querySelectorAll("[name^='custom:']")].map((field) => {
          const value = field.type === "checkbox" ? field.checked : field.type === "number" && field.value !== "" ? Number(field.value) : field.value;
          return [field.name.slice(7), value];
        }));
        try {
          const response = await fetch("/api/admin/content", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "post", contentType: type, title: form.elements.title.value, slug: form.elements.slug.value, body: form.elements.body?.value || "", status: "draft", customFields, advancedFields: CloudPressAdvancedFields.collect(form) }) });
          const data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || "No se pudo guardar el contenido.");
          form.reset(); message.textContent = "Borrador guardado."; location.reload();
        } catch (error) { message.textContent = error.message; }
      }, true);
    } catch (error) { console.error("CloudPress advanced fields", error); }
  });
})();
