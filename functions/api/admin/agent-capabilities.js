import { listAgentCapabilities } from "../../_agent-capabilities.js";
import { json, requireBrowserAdmin } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireBrowserAdmin(request, env, "sensitive:approve")) return json({ error: "Se requiere permiso para emitir o revocar acceso de agente" }, 403);
  return json({ capabilities: await listAgentCapabilities(env) }, 200, { "Cache-Control": "no-store" });
}
