import { json, requireAdmin } from "../../_shared.js";
import { availableBlocks, loadBlocksDocument } from "../../_blocks.js";

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env)) return json({ error: "Se requiere rol admin" }, 403);
  const contentId = new URL(request.url).searchParams.get("contentId");
  const document = contentId && Number.isInteger(Number(contentId)) && Number(contentId) > 0 ? await loadBlocksDocument(env, Number(contentId)) : null;
  return json({ version: 1, definitions: await availableBlocks(env), document }, 200, { "Cache-Control": "no-store" });
}
