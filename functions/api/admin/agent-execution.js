import { currentAgentCapabilityUser, json } from "../../_shared.js";
import { failStep, finishSensitiveStep, finishStep, requestTaskInput, startStep } from "../../_agent-os.js";

async function ownedTask(env, agent, taskId) {
  const task = await env.DB.prepare("SELECT id FROM agent_tasks WHERE id=? AND actor_id=? AND profile_id=?").bind(taskId, agent.id, agent.agent_profile_id).first();
  if (!task) throw new Error("La tarea no pertenece al perfil de esta credencial.");
}

async function verifiedOutcome(env, agent, taskId, ordinal, outcome) {
  if (!outcome?.verification || outcome.verification.verified !== true) throw new Error("El paso requiere una postcondición declarada.");
  const step = await env.DB.prepare("SELECT agent_steps.tool_name,agent_steps.input_json FROM agent_steps JOIN agent_runs ON agent_runs.id=agent_steps.run_id WHERE agent_runs.task_id=? AND agent_steps.ordinal=? ORDER BY agent_runs.attempt DESC LIMIT 1").bind(taskId, ordinal).first();
  if (!step) throw new Error("Paso no encontrado.");
  const id = Number(outcome?.result?.id);
  let input = {};
  try { input = JSON.parse(step.input_json || "{}"); } catch { throw new Error("El paso tiene una entrada inválida."); }
  let evidence = null;
  if (["cloudpress_create_draft", "cloudpress_trash_content", "cloudpress_restore_content", "cloudpress_update_content"].includes(step.tool_name)) {
    if (!Number.isInteger(id) || id < 1) throw new Error("El resultado no identifica el contenido comprobable.");
    const item = await env.DB.prepare("SELECT id,status,author_id,updated_at FROM content_items WHERE id=?").bind(id).first();
    if (!item) throw new Error("CloudPress no puede comprobar el contenido indicado.");
    if (step.tool_name === "cloudpress_create_draft" && (item.status !== "draft" || item.author_id !== agent.id)) throw new Error("El borrador no coincide con la postcondición del agente.");
    if (step.tool_name === "cloudpress_trash_content" && item.status !== "trash") throw new Error("El contenido no está en Papelera.");
    if (step.tool_name === "cloudpress_restore_content" && item.status === "trash") throw new Error("El contenido continúa en Papelera.");
    evidence = { type: "d1_content_state", id: item.id, status: item.status, updatedAt: item.updated_at };
  } else if (step.tool_name === "cloudpress_set_user_active") {
    if (!Number.isInteger(id) || id < 1 || typeof outcome?.result?.active !== "boolean") throw new Error("El resultado no identifica el usuario comprobable.");
    const user = await env.DB.prepare("SELECT id,active FROM users WHERE id=?").bind(id).first();
    if (!user || Boolean(user.active) !== outcome.result.active) throw new Error("El estado del usuario no coincide con la postcondición.");
    evidence = { type: "d1_user_state", id: user.id, active: Boolean(user.active) };
  } else if (step.tool_name === "cloudpress_manage_navigation") {
    if (!Number.isInteger(id) || id < 1 || !["taxonomy", "menu"].includes(input.resource)) throw new Error("El resultado no identifica la navegación comprobable.");
    const row = await env.DB.prepare(input.resource === "taxonomy" ? "SELECT id,name,slug,type FROM taxonomy_terms WHERE id=?" : "SELECT id,label,url,position FROM menu_items WHERE id=?").bind(id).first();
    if (!row) throw new Error("CloudPress no puede comprobar la navegación indicada.");
    evidence = { type: input.resource === "taxonomy" ? "d1_taxonomy_state" : "d1_menu_state", id: row.id };
  } else if (step.tool_name === "cloudpress_manage_terms") {
    if (!Number.isInteger(id) || id < 1 || !["core", "plugin"].includes(input.scope)) throw new Error("El resultado no identifica el término comprobable.");
    const row = input.scope === "core"
      ? await env.DB.prepare("SELECT id,type,name,slug FROM taxonomy_terms WHERE id=?").bind(id).first()
      : await env.DB.prepare("SELECT id,name,slug,parent_id FROM plugin_terms WHERE id=? AND plugin_id=? AND taxonomy_id=?").bind(id, String(input.pluginId || ""), String(input.taxonomyId || "")).first();
    if (!row) throw new Error("CloudPress no puede comprobar el término indicado.");
    evidence = { type: input.scope === "core" ? "d1_taxonomy_state" : "d1_plugin_term_state", id: row.id };
  } else if (step.tool_name === "cloudpress_manage_meta") {
    const scope = String(outcome?.result?.scope || input.scope || ""), entityId = Number(outcome?.result?.id || input.entityId), key = String(outcome?.result?.key || input.key || "");
    if (!["content", "user"].includes(scope) || !Number.isInteger(entityId) || entityId < 1 || !/^[a-z0-9-]+\.[a-z0-9_.-]{1,63}$/.test(key)) throw new Error("El resultado no identifica el metadato comprobable.");
    const table = scope === "content" ? "content_meta" : "user_meta", column = scope === "content" ? "content_id" : "user_id";
    const row = await env.DB.prepare(`SELECT value_json,updated_at FROM ${table} WHERE ${column}=? AND meta_key=?`).bind(entityId, key).first();
    const expectedValue = outcome?.result?.value ?? input.value;
    if (!row || JSON.stringify(JSON.parse(row.value_json)) !== JSON.stringify(expectedValue)) throw new Error("El metadato no coincide con la postcondición.");
    evidence = { type: "d1_plugin_meta_state", scope, entityId, key, updatedAt: row.updated_at };
  } else if (["cloudpress_install_plugin", "cloudpress_set_plugin_state"].includes(step.tool_name)) {
    const pluginId = String(outcome?.result?.id || input.id || ""), expectedStatus = String(outcome?.result?.status || (step.tool_name === "cloudpress_install_plugin" ? "enabled" : input.status || ""));
    if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(pluginId) || !["enabled", "disabled"].includes(expectedStatus)) throw new Error("El resultado no identifica el plugin comprobable.");
    const plugin = await env.DB.prepare("SELECT plugin_id,status,updated_at FROM plugin_installations WHERE plugin_id=?").bind(pluginId).first();
    if (!plugin || plugin.status !== expectedStatus) throw new Error("El estado del plugin no coincide con la postcondición.");
    evidence = { type: "d1_plugin_state", id: plugin.plugin_id, status: plugin.status, updatedAt: plugin.updated_at };
  } else if (["cloudpress_upload_media", "cloudpress_update_media_meta"].includes(step.tool_name)) {
    const key = String(outcome?.result?.key || input.key || "");
    if (!/^media\/[^/]+$/.test(key) || !env.MEDIA?.head || !await env.MEDIA.head(key)) throw new Error("CloudPress no puede comprobar el medio indicado.");
    const metadata = await env.DB.prepare("SELECT title,alt_text,caption,description,creator,license,source_url,updated_at FROM media_metadata WHERE media_key=?").bind(key).first();
    if (!metadata) throw new Error("CloudPress no puede comprobar los metadatos del medio.");
    evidence = { type: "r2_media_and_d1_metadata", key, updatedAt: metadata.updated_at };
  }
  return { ...outcome, verification: { ...outcome.verification, verified: true, source: evidence ? "server-state" : "agent-attested", evidenceLevel: evidence ? "server-verified" : "agent-attested", ...(evidence ? { evidence } : {}) } };
}

export async function onRequestPost({ request, env }) {
  const agent = await currentAgentCapabilityUser(request, env);
  if (!agent) return json({ error: "Se requiere una credencial de agente activa." }, 403);
  const body = await request.json().catch(() => null);
  try {
    const taskId = String(body?.taskId || "");
    await ownedTask(env, agent, taskId);
    if (body?.action === "start_step") return json({ step: await startStep(env, agent, taskId, Number(body.ordinal)) });
    if (body?.action === "finish_step") return json({ step: await finishStep(env, agent, taskId, Number(body.ordinal), await verifiedOutcome(env, agent, taskId, Number(body.ordinal), body.outcome)) });
    if (body?.action === "finish_sensitive_step") return json({ step: await finishSensitiveStep(env, agent, taskId, Number(body.ordinal), body.approvalRequestId, body.outcome) });
    if (body?.action === "request_task_input") return json({ input: await requestTaskInput(env, agent, taskId, Number(body.ordinal), body) });
    if (body?.action === "fail_step") return json({ step: await failStep(env, agent, taskId, Number(body.ordinal), body.error) });
    return json({ error: "Acción de ejecución de agente inválida." }, 422);
  } catch (error) { return json({ error: error.message || "No se pudo registrar el paso." }, 422); }
}
