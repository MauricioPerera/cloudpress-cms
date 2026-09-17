(() => {
  if (["/roles.html", "/roles", "/content-types.html", "/content-types"].includes(location.pathname)) return;
  const api = async () => { const response = await fetch("/api/admin/roles"); if (!response.ok) return null; return response.json(); };
  const pruneRestrictedNavigation = async () => {
    const response = await fetch("/api/me"); const data = response.ok ? await response.json() : null; const core = data?.user?.permissions?.core;
    if (!core) return;
    const rules = [["content:manage", /Entradas|Páginas|Añadir entrada/i], ["media:manage", /Medios/i], ["comments:moderate", /Comentarios/i], ["taxonomies:manage", /Categorías y etiquetas|Organización/i], ["navigation:manage", /Menús/i], ["settings:manage", /Ajustes|Apariencia/i], ["plugins:manage", /Plugins/i], ["users:manage", /Usuarios/i]];
    document.querySelectorAll("a,button").forEach((element) => { const text = element.textContent || ""; if (rules.some(([permission, pattern]) => !core[permission] && pattern.test(text))) element.hidden = true; });
  };
  const addNavigation = async () => {
    const data = await api(); if (!data) return;
    const nav = ["/wp-admin", "/wp-admin.html"].includes(location.pathname) ? null : document.querySelector(".nav");
    if (nav && !nav.querySelector("[data-cloudpress-roles]")) { const button = document.createElement("button"); button.dataset.cloudpressRoles = "1"; button.textContent = "⚿ Roles"; button.onclick = () => location.href = "/roles.html"; nav.insertBefore(button, nav.querySelectorAll("small")[1] || null); }
    const permissions = (await fetch("/api/me").then((response) => response.ok ? response.json() : null).catch(() => null))?.user?.permissions?.core;
    if (nav && permissions?.["content:manage"] && !nav.querySelector("[data-cloudpress-content-types]")) { const button = document.createElement("button"); button.dataset.cloudpressContentTypes = "1"; button.textContent = "⌗ Tipos de contenido"; button.onclick = () => location.href = "/content-types.html"; nav.insertBefore(button, nav.querySelectorAll("small")[1] || null); }
    const hydrateSelect = (select) => {
      const selected = select.value || select.dataset.cloudpressRole;
      if (select.dataset.cloudpressRolesReady === "1") return;
      select.dataset.cloudpressRolesReady = "1";
      select.replaceChildren(...data.roles.map((role) => { const option = document.createElement("option"); option.value = role.id; option.textContent = `${role.label} (${role.scope === "management" ? "gestión" : "externo"})`; return option; }));
      select.value = selected || "user"; select.dataset.cloudpressRole = select.value;
    };
    const scan = () => document.querySelectorAll("#user-form select[name=role]").forEach(hydrateSelect);
    scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  };
  const start = () => { addNavigation().catch(() => {}); pruneRestrictedNavigation().catch(() => {}); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
