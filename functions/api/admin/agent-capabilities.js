import { listAgentCapabilities } from "../../_agent-capabilities.js";
import { json, requireBrowserAdmin } from "../../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!await requireBrowserAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  return json({ capabilities: await listAgentCapabilities(env) }, 200, { "Cache-Control": "no-store" });
}
