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

  const copy = async (value) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const field = document.createElement("textarea");
    field.value = value; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
  };

  const onboardingPrompt = () => {
    const origin = location.origin;
    return `Configura un agente local para CloudPress.\n\nSitio exacto: ${origin}\n\nEste prompt fue copiado desde Perfil después de que CloudPress validó una sesión administradora activa en este navegador. No pidas, recibas ni escribas usuario, contraseña, cookies, tokens ni códigos del autenticador. CloudPress seguirá comprobando la autorización en cada operación.\n\n1. Abre ${origin}/agent.html en un navegador compatible con WebMCP.\n2. Lee y sigue exactamente ${origin}/agent-setup/prompt.md.\n3. Si el agente local aún no está vinculado, vuelve a Perfil de CloudPress para completar la vinculación LSFA.\n4. Para cambios reversibles usa las herramientas de CloudPress; para acciones irreversibles espera el formulario local de confirmación.\n\nNo inventes rutas, permisos ni datos de autenticación.`;
  };

  async function renderCapabilities(container) {
    const data = await api("/api/admin/agent-capabilities");
    container.replaceChildren();
    for (const capability of data.capabilities) {
      const row = document.createElement("div");
      row.className = "agent-capability-row";
      const detail = document.createElement("span");
      const expiration = new Date(capability.expiresAt).toLocaleString();
      detail.textContent = `${capability.username} · perfil ${capability.profileId || "sin perfil"} · ${capability.status} · vence ${expiration}`;
      row.append(detail);
      if (capability.revocable) {
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
    return data.capabilities;
  }

  async function render() {
    const profile = await api("/api/profile");
    if (profile.profile.role !== "admin" || document.querySelector("#cloudpress-agent-access")) return;
    const section = document.createElement("section");
    section.id = "cloudpress-agent-access";
    section.className = "card";
    section.innerHTML = "<h2>Acceso para agente local</h2><p>CloudPress usa el enrolamiento LSFA ya configurado en este equipo y tu sesión Admin actual. Nunca comparte tu contraseña ni la cookie del navegador.</p><label class=\"field\">Perfil que recibirá el agente<select id=\"cloudpress-agent-profile\" required><option value=\"\">Cargando perfiles…</option></select></label><p class=\"muted\">La credencial sólo podrá usar las herramientas y la clasificación de datos del perfil elegido.</p><button type=\"button\" id=\"cloudpress-link-agent\" disabled>Vincular agente local</button><button type=\"button\" id=\"cloudpress-copy-agent-prompt\">Copiar instrucciones para mi agente</button><p class=\"muted\" id=\"cloudpress-agent-prompt-status\" role=\"status\"></p><p class=\"muted\" id=\"cloudpress-companion-status\" role=\"status\">Comprobando el companion local…</p><h3>Accesos emitidos</h3><div class=\"agent-capability-list\"></div>";
    const message = section.querySelector("#cloudpress-companion-status");
    const list = section.querySelector(".agent-capability-list");
    const copyButton = section.querySelector("#cloudpress-copy-agent-prompt");
    const linkButton = section.querySelector("#cloudpress-link-agent");
    const copyStatus = section.querySelector("#cloudpress-agent-prompt-status");
    const profileSelect = section.querySelector("#cloudpress-agent-profile");
    copyButton.addEventListener("click", async () => {
      copyButton.disabled = true;
      try {
        await copy(onboardingPrompt());
        copyStatus.textContent = "Instrucciones personalizadas copiadas. Pégalas en tu agente de IA.";
      } catch {
        copyStatus.textContent = "No se pudieron copiar las instrucciones.";
      } finally {
        copyButton.disabled = false;
      }
    });
    document.querySelector("main")?.append(section);
    const capabilities = await renderCapabilities(list);
    let activeCapability = null;
    try {
      const profiles = (await api("/api/admin/agent-tasks")).profiles.filter((item) => item.status === "active");
      profileSelect.replaceChildren(...profiles.map((item) => new Option(`${item.label} · hasta ${item.dataPolicy.maximumClassification}`, item.id)));
      if (!profiles.length) {
        message.textContent = "Primero crea un perfil en Operaciones de agentes.";
        return;
      }
      activeCapability = capabilities.find((item) => item.status === "active" && item.profileId && profiles.some((profile) => profile.id === item.profileId));
      if (activeCapability) profileSelect.value = activeCapability.profileId;
      linkButton.disabled = false;
    } catch (error) {
      message.textContent = error.message || "No se pudieron cargar los perfiles de agente.";
      return;
    }
    try {
      const statusResponse = await fetch("http://127.0.0.1:9463/v1/cloudpress/agent-status", { mode: "cors", credentials: "omit", headers: channelHeaders() });
      const status = await statusResponse.json();
      if (!statusResponse.ok || !status.ok) throw new Error("No se pudo comprobar el companion local.");
      if (!status.enrolled) {
        message.textContent = "El companion está activo, pero aún no tiene un enrolamiento LSFA local.";
        return;
      }
      if (status.linked && status.authorized && activeCapability) message.textContent = "Agente local vinculado. Puedes renovar el acceso o cambiar de perfil de forma explícita.";
      else if (status.linked && status.authorized) message.textContent = "La credencial local no está ligada a un perfil activo de CloudPress. Vincúlala de nuevo antes de usar el agente.";
      else message.textContent = "El companion está listo. Selecciona un perfil y vincula el agente local.";
    } catch (error) {
      message.textContent = error.message || "No se pudo comprobar el companion local.";
    }

    linkButton.addEventListener("click", async () => {
      if (!profileSelect.value) { message.textContent = "Selecciona el perfil que recibirá el agente local."; return; }
      const approved = await window.CloudPressUI.confirm({ title: "Vincular agente local", message: "Se creará una capacidad revocable ligada exclusivamente al perfil seleccionado y se sustituirá cualquier acceso anterior de este usuario.", confirmLabel: "Vincular agente", destructive: false });
      if (!approved) return;
      linkButton.disabled = true;
      message.textContent = "Vinculando el agente local con el perfil seleccionado…";
      let capability = null;
      try {
        capability = await api("/api/admin/agent-capability", "POST", { profileId: profileSelect.value });
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
        // A failed handoff must not leave a usable bearer active for a week.
        if (capability?.id) {
          try { await api(`/api/admin/agent-capabilities/${encodeURIComponent(capability.id)}`, "DELETE"); }
          catch { /* The user can still revoke it from the displayed capability list. */ }
        }
        message.textContent = error.message || "No se pudo vincular el agente.";
      } finally {
        linkButton.disabled = false;
      }
    });
  }

  const start = () => render().catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
