import { json, requireAdmin } from "../../../_shared.js";
import { prepareApproval } from "../../../_approvals.js";

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: "Se requiere rol admin" }, 403);
  const input = await request.json().catch(() => null);
  try { return json(await prepareApproval(env, admin, input), 201, { "Cache-Control": "no-store" }); }
  catch (error) { return json({ error: String(error?.message || "No se pudo preparar la aprobación.") }, 400); }
}
