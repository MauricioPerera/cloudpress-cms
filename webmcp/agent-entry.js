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
  const companion = await response.json();
  if (!response.ok || !companion.enrolled || !companion.linked || !companion.authorized) throw new Error("not_ready");
  status.textContent = "Companion LSFA conectado y capacidad local disponible.";
} catch {
  status.textContent = "Este navegador debe permitir el acceso a la red local para contactar el companion LSFA de este equipo.";
}
