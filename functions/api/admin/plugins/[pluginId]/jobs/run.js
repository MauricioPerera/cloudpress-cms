import { json, requireAdmin } from "../../../../../_shared.js";
import { auditSnapshot, createPluginContext, enabledPlugin, pluginAudit } from "../../../../../_plugins/host.js";

export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env, "plugins:manage"); if (!admin) return json({ error: "Se requiere permiso de plugins" }, 403);
  const pluginId = String(params.pluginId || ""), plugin = await enabledPlugin(env, pluginId); if (!plugin) return json({ error: "Plugin no disponible." }, 404);
  const job = await env.DB.prepare("SELECT * FROM plugin_jobs WHERE plugin_id=? AND status='queued' AND run_after<=? ORDER BY id LIMIT 1").bind(pluginId, new Date().toISOString()).first();
  if (!job) return json({ ok: true, job: null });
  const claimed = await env.DB.prepare("UPDATE plugin_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'").bind(new Date().toISOString(), job.id).run();
  if (!claimed.meta.changes) return json({ ok: true, retry: true }, 409);
  const task = plugin.manifest.tasks?.find((item) => item.id === job.task_id), handler = task && plugin.module?.tasks?.[task.handler];
  if (typeof handler !== "function") { await env.DB.prepare("UPDATE plugin_jobs SET status='failed',error_text=?,updated_at=? WHERE id=?").bind("Handler no disponible", new Date().toISOString(), job.id).run(); return json({ error: "Handler de tarea no disponible." }, 501); }
  const payload = JSON.parse(job.payload_json);
  try { const result = await handler(createPluginContext(env, pluginId, admin), payload); await env.DB.prepare("UPDATE plugin_jobs SET status='completed',result_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(result ?? null), new Date().toISOString(), job.id).run(); await pluginAudit(env, pluginId, "job_completed", admin.id, { jobId: job.id, taskId: job.task_id, payload: JSON.parse(auditSnapshot(payload)), result: JSON.parse(auditSnapshot(result)) }); return json({ ok: true, job: { id: job.id, taskId: job.task_id, result } }); }
  catch (error) { await env.DB.prepare("UPDATE plugin_jobs SET status='failed',error_text=?,updated_at=? WHERE id=?").bind(String(error?.message || "Error"), new Date().toISOString(), job.id).run(); await pluginAudit(env, pluginId, "job_failed", admin.id, { jobId: job.id, taskId: job.task_id, payload: JSON.parse(auditSnapshot(payload)), error: String(error?.message || "Error") }); return json({ error: String(error?.message || "La tarea falló.") }, 422); }
}
