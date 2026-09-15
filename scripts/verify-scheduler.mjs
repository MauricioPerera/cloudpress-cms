import assert from "node:assert/strict";
import { publicationState, runScheduledWork } from "../functions/_scheduler.js";

const now = "2026-09-15T12:00:00.000Z";

function testDatabase({ pluginStatus = "enabled", handlerAvailable = true } = {}) {
  const state = {
    content: { id: 7, status: "draft", published_at: "2026-09-15T11:59:00.000Z", updated_at: "" },
    jobs: [{ id: 8, plugin_id: "fixture-plugin", task_id: "record", payload_json: JSON.stringify({ id: "due" }), status: "queued", run_after: "2026-09-15T11:58:00.000Z", attempts: 0, updated_at: "" }],
    records: [], audits: [], pluginStatus,
  };
  const DB = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...input) { values = input; return statement; },
        async all() {
          if (sql.startsWith("SELECT j.id,j.plugin_id")) return { results: state.jobs.filter((job) => job.status === "queued" && job.run_after <= values[0] && state.pluginStatus === "enabled").map(({ id, plugin_id, task_id, payload_json }) => ({ id, plugin_id, task_id, payload_json })) };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("UPDATE content_items SET status='published'")) {
            if (state.content.status === "draft" && state.content.published_at <= values[1]) { state.content.status = "published"; state.content.updated_at = values[0]; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("UPDATE plugin_jobs SET status='queued'")) return { meta: { changes: 0 } };
          if (sql.startsWith("UPDATE plugin_jobs SET status='running'")) {
            const job = state.jobs.find((item) => item.id === values[1]);
            if (job?.status === "queued" && job.run_after <= values[2]) { job.status = "running"; job.attempts += 1; job.updated_at = values[0]; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("UPDATE plugin_jobs SET status='completed'")) {
            const job = state.jobs.find((item) => item.id === values[2]); if (job?.status !== "running") return { meta: { changes: 0 } };
            Object.assign(job, { status: "completed", result_json: values[0], updated_at: values[1] }); return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE plugin_jobs SET status='failed'")) {
            const job = state.jobs.find((item) => item.id === values[2]); if (job?.status !== "running") return { meta: { changes: 0 } };
            Object.assign(job, { status: "failed", error_text: values[0], updated_at: values[1] }); return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO plugin_records")) { state.records.push({ pluginId: values[0], collection: values[1], key: values[2], value: JSON.parse(values[4]) }); return { meta: { changes: 1 } }; }
          if (sql.startsWith("INSERT INTO plugin_audit_log")) { state.audits.push({ pluginId: values[0], action: values[1] }); return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
  const plugin = handlerAvailable ? { manifest: { tasks: [{ id: "record", handler: "record" }] }, module: { tasks: { async record(context, payload) { await context.data.put("events", payload.id, { completed: true }); return { completed: payload.id }; } } } } : { manifest: { tasks: [] }, module: { tasks: {} } };
  return { env: { DB }, state, pluginLoader: async () => plugin };
}

assert.deepEqual(publicationState({ status: "published", publishedAt: "2026-09-15T12:01:00.000Z", now: new Date(now) }), { status: "draft", publishedAt: "2026-09-15T12:01:00.000Z", scheduled: true });
assert.deepEqual(publicationState({ status: "published", publishedAt: "2026-09-15T11:59:00.000Z", now: new Date(now) }), { status: "published", publishedAt: "2026-09-15T11:59:00.000Z", scheduled: false });

const success = testDatabase();
const outcome = await runScheduledWork(success.env, { now, pluginLoader: success.pluginLoader });
assert.equal(outcome.published, 1, "El scheduler debe publicar borradores vencidos.");
assert.equal(outcome.jobs.completed, 1, "El scheduler debe ejecutar una tarea de plugin activa.");
assert.equal(success.state.jobs[0].status, "completed");
assert.equal(success.state.jobs[0].attempts, 1);
assert.deepEqual(success.state.records[0], { pluginId: "fixture-plugin", collection: "events", key: "due", value: { completed: true } });
assert.ok(success.state.audits.some((entry) => entry.action === "job_completed"));

const failed = testDatabase({ handlerAvailable: false });
const failedOutcome = await runScheduledWork(failed.env, { now, pluginLoader: failed.pluginLoader });
assert.equal(failedOutcome.jobs.failed, 1, "Una tarea sin handler debe terminar fallida, no quedarse en ejecución.");
assert.equal(failed.state.jobs[0].status, "failed");

const paused = testDatabase({ pluginStatus: "disabled" });
const pausedOutcome = await runScheduledWork(paused.env, { now, pluginLoader: paused.pluginLoader });
assert.equal(pausedOutcome.jobs.completed, 0, "Un plugin desactivado no debe ejecutar tareas.");
assert.equal(paused.state.jobs[0].status, "queued");

console.log(JSON.stringify({ ok: true, checks: ["future-publication-remains-draft", "due-publication", "due-plugin-task", "missing-handler-fails", "disabled-plugin-pauses-jobs"] }));
