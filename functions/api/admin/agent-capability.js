import { issueAgentCapability } from "../../_agent-capabilities.js";
import { json, requireBrowserAdmin } from "../../_shared.js";

// This route is intentionally cookie-authenticated. It creates an opaque,
// revocable bearer capability which is handed directly to the local LSFA
// companion; it is never returned by any read endpoint.
export async function onRequestPost({ request, env }) {
  const admin = await requireBrowserAdmin(request, env, "sensitive:approve");
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const body = await request.json().catch(() => null);
  try { return json(await issueAgentCapability(env, admin.id, body?.profileId), 201, { "Cache-Control": "no-store" }); }
  catch (error) { return json({ error: error.message || "No se pudo emitir la capacidad" }, 422); }
}
