import { json, requireAuthor, sanitizeHtml } from "../../../_shared.js";

const validKind = kind => kind === "post" || kind === "page";
const validStatus = status => status === "draft" || status === "published";
const slugify = value => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96);
const snapshot = (db, item) => db.prepare("INSERT INTO content_revisions(content_id,kind,title,slug,excerpt,body,status,published_at) VALUES(?,?,?,?,?,?,?,?)").bind(item.id,item.kind,item.title,item.slug,item.excerpt,item.body,item.status,item.published_at);
async function owned(env, id, authorId) { return env.DB.prepare("SELECT id,kind,title,slug,excerpt,body,status,published_at FROM content_items WHERE id=? AND author_id=?").bind(id, authorId).first(); }

export async function onRequestPatch({ request, env, params }) {
  const author = await requireAuthor(request, env); if (!author) return json({ error: "Se requiere rol autor" }, 403);
  const id = Number(params.id), body = await request.json().catch(() => null); if (!Number.isInteger(id) || id < 1 || !body) return json({ error: "Solicitud inválida" }, 400);
  const current = await owned(env, id, author.id); if (!current) return json({ error: "Contenido no encontrado" }, 404); if (current.status === "trash") return json({ error: "Restaura el contenido antes de editarlo" }, 409);
  const updates=[], values=[];
  if(body.kind!==undefined){if(!validKind(body.kind))return json({error:"Tipo inválido"},400);updates.push("kind=?");values.push(body.kind)}
  if(body.title!==undefined){const v=String(body.title).trim().slice(0,180);if(!v)return json({error:"El título es obligatorio"},400);updates.push("title=?");values.push(v)}
  if(body.slug!==undefined){const v=slugify(body.slug);if(!v)return json({error:"Slug inválido"},400);updates.push("slug=?");values.push(v)}
  if(body.excerpt!==undefined){updates.push("excerpt=?");values.push(String(body.excerpt).slice(0,500))}
  if(body.body!==undefined){updates.push("body=?");values.push(sanitizeHtml(String(body.body)).slice(0,50000))}
  if(body.status!==undefined){if(!validStatus(body.status))return json({error:"Estado inválido"},400);updates.push("status=?");values.push(body.status);if(body.status==='published'&&!current.published_at){updates.push("published_at=?");values.push(new Date().toISOString())}}
  if(!updates.length)return json({error:"No hay cambios válidos"},400);updates.push("updated_at=?");values.push(new Date().toISOString(),id);
  try{await env.DB.batch([snapshot(env.DB,current),env.DB.prepare(`UPDATE content_items SET ${updates.join(', ')} WHERE id=? AND author_id=?`).bind(...values,author.id)])}catch{return json({error:"El slug ya está en uso"},409)}
  return json({ok:true});
}

export async function onRequestDelete({ request, env, params }) {
  const author = await requireAuthor(request, env); if (!author) return json({ error: "Se requiere rol autor" }, 403);
  const id=Number(params.id);if(!Number.isInteger(id)||id<1)return json({error:"Solicitud inválida"},400);const current=await owned(env,id,author.id);if(!current)return json({error:"Contenido no encontrado"},404);if(current.status==='trash')return json({error:"El contenido ya está en la papelera"},409);const now=new Date().toISOString();await env.DB.batch([snapshot(env.DB,current),env.DB.prepare("UPDATE content_items SET status='trash',trashed_from_status=?,trashed_at=?,updated_at=? WHERE id=? AND author_id=?").bind(current.status,now,now,id,author.id)]);return json({ok:true,trashed:true});
}
