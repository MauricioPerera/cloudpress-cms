(() => {
  if (location.pathname !== "/perfil" && location.pathname !== "/perfil.html") return;
  const CHANNEL_KEY = "cloudpress.lsfa.channel.v1";

  const api = async (path, method = "GET", body) => {
    const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({ error: "Respuesta inválida" }));
    if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
    return data;
  };

  const channelHeaders = () => {
    const token = localStorage.getItem(CHANNEL_KEY);
    return token ? { "x-lsfa-channel-token": token } : {};
  };

  async function renderCapabilities(container) {
    const data = await api("/api/admin/agent-capabilities");
    container.replaceChildren();
    for (const capability of data.capabilities) {
      const row = document.createElement("div");
      row.className = "agent-capability-row";
      const detail = document.createElement("span");
      const expiration = new Date(capability.expiresAt).toLocaleString();
      detail.textContent = `${capability.username} · ${capability.status} · vence ${expiration}`;
      row.append(detail);
      if (capability.status === "active") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.textContent = "Revocar este acceso";
        revoke.addEventListener("click", async () => {
          const approved = await window.CloudPressUI.confirm({ title: "Revocar acceso del agente", message: `Se invalidará el acceso de ${capability.username} que vence ${expiration}. Para volver a usarlo habrá que vincularlo nuevamente.`, confirmLabel: "Revocar acceso", destructive: true });
          if (!approved) return;
          revoke.disabled = true;
          try {
            await api(`/api/admin/agent-capabilities/${encodeURIComponent(capability.id)}`, "DELETE");
            localStorage.removeItem(CHANNEL_KEY);
            await renderCapabilities(container);
          } catch (error) {
            revoke.disabled = false;
            window.CloudPressUI.toast(error.message || "No se pudo revocar el acceso.", "error");
          }
        });
        row.append(revoke);
      }
      container.append(row);
    }
    if (!data.capabilities.length) container.textContent = "No hay accesos de agente registrados.";
  }

  async function render() {
    const profile = await api("/api/profile");
    if (profile.profile.role !== "admin" || document.querySelector("#cloudpress-agent-access")) return;
    const section = document.createElement("section");
    section.id = "cloudpress-agent-access";
    section.className = "card";
    section.innerHTML = "<h2>Acceso para agente local</h2><p>CloudPress usa el enrolamiento LSFA ya configurado en este equipo y tu sesión Admin actual. Nunca comparte tu contraseña ni la cookie del navegador.</p><p class=\"muted\" role=\"status\">Comprobando el companion local…</p><h3>Accesos emitidos</h3><div class=\"agent-capability-list\"></div>";
    const message = section.querySelector("p[role=status]");
    const list = section.querySelector(".agent-capability-list");
    document.querySelector("main")?.append(section);
    await renderCapabilities(list);
    try {
      const statusResponse = await fetch("http://127.0.0.1:9463/v1/cloudpress/agent-status", { mode: "cors", credentials: "omit", headers: channelHeaders() });
      const status = await statusResponse.json();
      if (!statusResponse.ok || !status.ok) throw new Error("No se pudo comprobar el companion local.");
      if (!status.enrolled) {
        message.textContent = "El companion está activo, pero aún no tiene un enrolamiento LSFA local.";
        return;
      }
      if (status.linked && status.authorized) {
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
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(result.channel_token || "")) throw new Error("El companion no devolvió una credencial de canal válida.");
        localStorage.setItem(CHANNEL_KEY, result.channel_token);
        message.textContent = "Agente local vinculado. La capacidad se guarda en el almacén seguro del sistema.";
        await renderCapabilities(list);
      } catch (error) {
        message.textContent = error.message || "No se pudo vincular el agente.";
      }
    } catch (error) {
      message.textContent = error.message || "No se pudo comprobar el companion local.";
    }
  }

  render().catch(() => {});
})();
