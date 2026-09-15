import { json, requireAdmin } from "../../../_shared.js";

export async function onRequestDelete({ request, env, params }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const name = String(params.key || "");
  if (!name || name.includes("/") || name.includes("..")) return json({ error: "Archivo inválido" }, 400);
  await env.MEDIA.delete(`media/${name}`);
  return json({ ok: true });
}
