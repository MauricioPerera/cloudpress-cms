(() => {
  if (location.pathname !== "/perfil" && location.pathname !== "/perfil.html") return;

  const api = async (path, method = "GET", body) => {
    const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({ error: "Respuesta inválida" }));
    if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
    return data;
  };

  async function render() {
    const profile = await api("/api/profile");
    if (profile.profile.role !== "admin" || document.querySelector("#cloudpress-agent-access")) return;
    const section = document.createElement("section");
    section.id = "cloudpress-agent-access";
    section.className = "card";
    section.innerHTML = "<h2>Acceso para agente local</h2><p>CloudPress usa el enrolamiento LSFA ya configurado en este equipo y tu sesión Admin actual. Nunca comparte tu contraseña ni la cookie del navegador.</p><p class=\"muted\" role=\"status\">Comprobando el companion local…</p>";
    const message = section.querySelector("p:last-child");
    document.querySelector("main")?.append(section);
    try {
      const statusResponse = await fetch("http://127.0.0.1:9463/v1/cloudpress/agent-status", { mode: "cors", credentials: "omit" });
      const status = await statusResponse.json();
      if (!statusResponse.ok || !status.ok) throw new Error("No se pudo comprobar el companion local.");
      if (!status.enrolled) {
        message.textContent = "El companion está activo, pero aún no tiene un enrolamiento LSFA local.";
        return;
      }
      if (status.linked) {
        message.textContent = "Agente local vinculado. La capacidad se guarda en el almacén seguro del sistema.";
        return;
      }
      message.textContent = "Vinculando el agente local con la sesión Admin existente…";
      try {
        const capability = await api("/api/admin/agent-capability", "POST");
        const response = await fetch("http://127.0.0.1:9463/v1/cloudpress/agent-capabilities", {
          method: "POST", mode: "cors", credentials: "omit", headers: { "content-type": "application/json" },
          body: JSON.stringify({ protocol: "lsfa", version: "0.2", origin: location.origin, capability: { id: capability.id, token: capability.token, expires_at: capability.expiresAt } }),
        });
        const result = await response.json();
        if (!response.ok || result.status !== "accepted") throw new Error(result.error_code || "El companion no confirmó la vinculación.");
        message.textContent = "Agente local vinculado. La capacidad se guarda en el almacén seguro del sistema.";
      } catch (error) {
        message.textContent = error.message || "No se pudo vincular el agente.";
      }
    } catch (error) {
      message.textContent = error.message || "No se pudo comprobar el companion local.";
    }
  }

  render().catch(() => {});
})();
