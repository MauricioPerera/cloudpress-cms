(() => {
  const views = {
    overview: { label: "Resumen", title: "Resumen de operaciones", description: "Uso, coste y estado agregado de los agentes.", headings: ["Observabilidad operacional"] },
    tasks: { label: "Tareas", title: "Tareas de agentes", description: "Crea, ejecuta y revisa la evidencia de cada tarea.", headings: ["Crear tarea", "Tareas"] },
    profiles: { label: "Perfiles", title: "Perfiles de agentes", description: "Define límites, herramientas y gobierno de cada agente.", headings: ["Crear perfil", "Perfiles"] },
    models: { label: "Modelos", title: "Modelos autorizados", description: "Configura modelos, residencia y límites de coste.", headings: ["Catálogo de modelos"] }
  };
  const requested = new URLSearchParams(location.search).get("tab");
  const active = views[requested] ? requested : "overview";
  const current = views[active];
  const style = document.createElement("style");
  style.textContent = ".agent-tabs{display:flex;gap:4px;margin:0 0 18px;border-bottom:1px solid var(--line);overflow:auto}.agent-tabs a{padding:10px 14px;color:#50575e;text-decoration:none;white-space:nowrap;border-bottom:3px solid transparent}.agent-tabs a:hover,.agent-tabs a:focus-visible{color:var(--blue)}.agent-tabs a.active{color:#1d2327;font-weight:600;border-bottom-color:var(--blue)}[data-agent-view][hidden]{display:none!important}";
  document.head.append(style);

  document.title = `${current.title} · CloudPress`;
  const heading = document.querySelector(".heading");
  const title = heading?.querySelector("h1");
  const description = title?.nextElementSibling;
  if (title) title.textContent = current.title;
  if (description) description.textContent = current.description;
  const topbar = document.querySelector(".topbar strong");
  if (topbar) topbar.textContent = current.title;

  const tabs = document.createElement("nav");
  tabs.className = "agent-tabs";
  tabs.setAttribute("aria-label", "Secciones de operaciones de agentes");
  for (const [id, view] of Object.entries(views)) {
    const link = document.createElement("a");
    link.href = `?tab=${id}`;
    link.textContent = view.label;
    link.classList.toggle("active", id === active);
    if (id === active) link.setAttribute("aria-current", "page");
    tabs.append(link);
  }
  heading?.after(tabs);

  for (const [id, view] of Object.entries(views)) {
    for (const headingText of view.headings) {
      const section = [...document.querySelectorAll(".card h2")].find(item => item.textContent.trim() === headingText)?.closest(".card");
      if (!section) continue;
      section.dataset.agentView = id;
      section.hidden = id !== active;
    }
  }

  const navigation = document.querySelector(".sidebar .nav");
  const root = [...navigation?.querySelectorAll("a") || []].find(link => link.textContent.includes("Operaciones de agentes"));
  if (navigation && root) {
    root.href = "/agent-operations.html?tab=overview";
    root.classList.toggle("active", active === "overview");
    root.toggleAttribute("aria-current", active === "overview");
    let after = root;
    for (const [id, view] of Object.entries(views)) {
      if (id === "overview") continue;
      const link = document.createElement("a");
      link.href = `/agent-operations.html?tab=${id}`;
      link.textContent = view.label;
      link.className = "sub";
      link.classList.toggle("active", id === active);
      if (id === active) link.setAttribute("aria-current", "page");
      after.after(link);
      after = link;
    }
  }
})();
