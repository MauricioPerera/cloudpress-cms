export async function onRequestGet({ env, params }) {
  const name = String(params.key || "");
  if (!name || name.includes("/") || name.includes("..")) return new Response("No encontrado", { status: 404 });
  const object = await env.MEDIA.get(`media/${name}`);
  if (!object) return new Response("No encontrado", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
