import { json } from "../_shared.js";
export async function onRequestGet({env}){return json({items:(await env.DB.prepare("SELECT id,label,url,position FROM menu_items ORDER BY position,id").all()).results})}
