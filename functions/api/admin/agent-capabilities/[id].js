import { revokeAgentCapability } from "../../../_agent-capabilities.js";
import { json, requireBrowserAdmin } from "../../../_shared.js";

export async function onRequestDelete({ request, env, params }) {
  if (!await requireBrowserAdmin(request, env, "sensitive:approve")) return json({ error: "Se requiere permiso para emitir o revocar acceso de agente" }, 403);
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) return json({ error: "Capacidad inválida" }, 400);
  if (!await revokeAgentCapability(env, id)) return json({ error: "Capacidad activa no encontrada" }, 404);
  return json({ ok: true, id, status: "revoked" }, 200, { "Cache-Control": "no-store" });
}
