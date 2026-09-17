async function knownContentType(env, typeId) {
  if (["post", "page"].includes(typeId)) return true;
  const core = await env.DB.prepare("SELECT 1 FROM core_content_types WHERE type_id=?").bind(typeId).first();
  if (core) return true;
  return Boolean(await env.DB.prepare("SELECT 1 FROM plugin_content_types t JOIN plugin_installations p ON p.plugin_id=t.plugin_id WHERE p.status='enabled' AND t.type_id=?").bind(typeId).first());
}
export { knownContentType };
