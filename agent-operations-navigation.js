(() => {
  if (typeof map !== "object" || map["agent-overview"]) return;
  const views = [
    ["agent-overview", "◉ Operaciones de agentes", "overview", false, "Resumen de ejecución, uso y coste de los agentes."],
    ["agent-tasks", "Tareas", "tasks", true, "Crea, ejecuta y revisa la evidencia de las tareas."],
    ["agent-profiles", "Perfiles", "profiles", true, "Define límites, herramientas y gobierno de cada agente."],
    ["agent-models", "Modelos", "models", true, "Configura los modelos autorizados y sus límites de coste."]
  ];
  const group = document.querySelector("aside .group:last-child");
  if (!group) return;
  for (const [view, label, tab, sub, description] of views) {
    map[view] = [`/agent-operations.html?tab=${tab}`, null, description];
    const button = document.createElement("button");
    button.className = `nav${sub ? " sub" : ""}`;
    button.dataset.view = view;
    button.textContent = label;
    button.onclick = () => open(view);
    group.append(button);
  }
})();
