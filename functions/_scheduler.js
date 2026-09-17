import { auditSnapshot, createPluginContext, enabledPlugin, pluginAudit } from "./_plugins/host.js";
import { dispatchDueAgentTasks } from "./_agent-runtime.js";

const SYSTEM_ACTOR = Object.freeze({ id: null, role: "system" });
const max = (value, fallback = 25) => Math.min(Math.max(Number(value) || fallback, 1), 50);

export function publicationState({ status, publishedAt, now = new Date() }) {
  const requested = status === "published" ? "published" : "draft";
  const date = publishedAt ? new Date(publishedAt) : null;
  if (date && Number.isNaN(date.getTime())) throw new Error("Fecha de publicación inválida");
  if (requested !== "published") return { status: "draft", publishedAt: null, scheduled: false };
  if (date && date.getTime() > now.getTime()) return { status: "draft", publishedAt: date.toISOString(), scheduled: true };
  return { status: "published", publishedAt: (date || now).toISOString(), scheduled: false };
}

export async function publishDueContent(env, { now = new Date().toISOString() } = {}) {
  const result = await env.DB.prepare("UPDATE content_items SET status='published', updated_at=? WHERE status='draft' AND published_at IS NOT NULL AND julianday(published_at) <= julianday(?)")
    .bind(now, now).run();
  return Number(result?.meta?.changes || 0);
}

async function failJob(env, job, error, now) {
  await env.DB.prepare("UPDATE plugin_jobs SET status='failed',error_text=?,updated_at=? WHERE id=? AND status='running'")
    .bind(String(error || "Error").slice(0, 2000), now, job.id).run();
  try { await pluginAudit(env, job.plugin_id, "job_failed", null, { jobId: job.id, taskId: job.task_id, error: String(error || "Error").slice(0, 1000) }); }
  catch (auditError) { console.warn("cloudpress scheduler: no se pudo auditar una tarea fallida", auditError); }
}

export async function runScheduledPluginJob(env, job, { now = new Date().toISOString(), pluginLoader = enabledPlugin } = {}) {
  const claimed = await env.DB.prepare("UPDATE plugin_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND run_after<=?")
    .bind(now, job.id, now).run();
  if (!claimed?.meta?.changes) return { state: "not_claimed", jobId: job.id };

  const plugin = await pluginLoader(env, job.plugin_id);
  const task = plugin?.manifest.tasks?.find((item) => item.id === job.task_id);
  const handler = task && plugin.module?.tasks?.[task.handler];
  if (typeof handler !== "function") {
    await failJob(env, job, "Handler de tarea no disponible", now);
    return { state: "failed", jobId: job.id, error: "Handler de tarea no disponible" };
  }

  let payload;
  try { payload = JSON.parse(job.payload_json); }
  catch {
    await failJob(env, job, "Payload de tarea inválido", now);
    return { state: "failed", jobId: job.id, error: "Payload de tarea inválido" };
  }

  try {
    const result = await handler(createPluginContext(env, job.plugin_id, SYSTEM_ACTOR), payload);
    await env.DB.prepare("UPDATE plugin_jobs SET status='completed',result_json=?,updated_at=? WHERE id=? AND status='running'")
      .bind(JSON.stringify(result ?? null), now, job.id).run();
    try { await pluginAudit(env, job.plugin_id, "job_completed", null, { jobId: job.id, taskId: job.task_id, payload: JSON.parse(auditSnapshot(payload)), result: JSON.parse(auditSnapshot(result)) }); }
    catch (auditError) { console.warn("cloudpress scheduler: no se pudo auditar una tarea completada", auditError); }
    return { state: "completed", jobId: job.id };
  } catch (error) {
    const message = String(error?.message || "La tarea falló.");
    await failJob(env, job, message, now);
    return { state: "failed", jobId: job.id, error: message };
  }
}

export async function runScheduledWork(env, { now = new Date().toISOString(), limit = 25, pluginLoader = enabledPlugin } = {}) {
  const size = max(limit);
  const staleBefore = new Date(new Date(now).getTime() - 20 * 60 * 1000).toISOString();
  const recovered = await env.DB.prepare("UPDATE plugin_jobs SET status='queued',updated_at=? WHERE status='running' AND julianday(updated_at) <= julianday(?)")
    .bind(now, staleBefore).run();
  const published = await publishDueContent(env, { now });
  const agents = await dispatchDueAgentTasks(env, { now, limit: size });
  const due = await env.DB.prepare("SELECT j.id,j.plugin_id,j.task_id,j.payload_json FROM plugin_jobs j JOIN plugin_installations p ON p.plugin_id=j.plugin_id WHERE j.status='queued' AND j.run_after<=? AND p.status='enabled' ORDER BY j.run_after,j.id LIMIT ?")
    .bind(now, size).all();
  const jobs = { completed: 0, failed: 0, skipped: 0 };
  for (const job of due.results || []) {
    const outcome = await runScheduledPluginJob(env, job, { now, pluginLoader });
    if (outcome.state === "completed") jobs.completed += 1;
    else if (outcome.state === "failed") jobs.failed += 1;
    else jobs.skipped += 1;
  }
  return { now, published, recovered: Number(recovered?.meta?.changes || 0), agents, jobs };
}
