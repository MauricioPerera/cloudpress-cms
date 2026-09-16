import { registerCloudPressAdminTools } from "./fastwebmcp-entry.js";
import { createCloudPressAgentApi, createCloudPressAgentLsfaBroker } from "./cloudpress-lsfa-broker.js";
import { useAgentApi } from "./fastwebmcp-tools.js";

// This page deliberately has no CloudPress cookie requirement. Every permitted
// API call travels through the local LSFA companion, which alone holds the
// revocable capability provisioned by the logged-in administrator.
useAgentApi(createCloudPressAgentApi());
const controller = registerCloudPressAdminTools({ broker: createCloudPressAgentLsfaBroker() });
addEventListener("pagehide", () => controller.abort(), { once: true });

const status = document.querySelector("#cloudpress-agent-status");
try {
  const token = localStorage.getItem("cloudpress.lsfa.channel.v1");
  const response = await fetch("http://127.0.0.1:9463/v1/cloudpress/agent-status", { mode: "cors", credentials: "omit", headers: token ? { "x-lsfa-channel-token": token } : {} });
  const companion = await response.json().catch(() => ({}));
  if (!response.ok) {
    status.textContent = "El companion LSFA respondió, pero este navegador todavía no está vinculado. Abre Perfil en CloudPress y vincula o renueva el acceso del agente.";
  } else if (!companion.enrolled) {
    status.textContent = "El companion LSFA está activo, pero primero debes configurar el PIN y el autenticador local.";
  } else if (!companion.linked || !companion.authorized) {
    status.textContent = "El companion LSFA está activo, pero falta vincular este navegador. Abre Perfil en CloudPress y vincula o renueva el acceso del agente.";
  } else {
    status.textContent = "Companion LSFA conectado y capacidad local disponible.";
  }
} catch {
  status.textContent = "Este navegador debe permitir el acceso a la red local para contactar el companion LSFA de este equipo.";
}
