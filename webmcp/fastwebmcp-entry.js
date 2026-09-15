import { registerLsfaTool, registerTool } from "fastwebmcp";
import { createCloudPressLsfaBroker } from "./cloudpress-lsfa-broker.js";
import { irreversibleActionSchema, reversibleTools } from "./fastwebmcp-tools.js";

export function registerCloudPressAdminTools({ broker = createCloudPressLsfaBroker() } = {}) {
  const controller = new AbortController();
  for (const tool of reversibleTools) registerTool(tool, { signal: controller.signal });
  registerLsfaTool({
    name: "cloudpress_sensitive_action",
    title: "Confirmar acción irreversible",
    description: "Solicita al companion LSFA local una confirmación humana reforzada para purgar contenido, borrar un usuario, medio, valor de metadato o término, o desinstalar un plugin. Ejecuta sólo la acción aprobada.",
    inputSchema: irreversibleActionSchema,
    intent: { operation: "cloudpress_irreversible_action", purpose: "Confirmar y ejecutar exclusivamente una acción irreversible preparada por CloudPress.", presentation: { mode: "form", profile: "cloudpress_irreversible", locale: "es", theme: "system" } },
    broker,
  }, { signal: controller.signal });
  return controller;
}
