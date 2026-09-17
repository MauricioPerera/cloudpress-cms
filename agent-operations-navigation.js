(() => {
  const view = "agent-operations";
  if (typeof map !== "object" || map[view]) return;
  map[view] = ["/agent-operations.html", null, "Supervisa y controla tareas de agentes."];
  const add = () => {
    if (document.querySelector(`[data-view="${view}"]`)) return;
    const button = document.createElement("button");
    button.className = "nav";
    button.dataset.view = view;
    button.textContent = "◉ Operaciones de agentes";
    button.onclick = () => open(view);
    document.querySelector("aside .group:last-child")?.append(button);
  };
  add();
})();
