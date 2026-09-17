import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const schema = await readFile("schema.sql", "utf8");
const required = [
  "content_type TEXT NOT NULL DEFAULT 'post'",
  "CREATE TABLE IF NOT EXISTS plugin_installations",
  "CREATE TABLE IF NOT EXISTS plugin_audit_log",
  "CREATE TABLE IF NOT EXISTS plugin_content_types",
  "CREATE TABLE IF NOT EXISTS core_content_types",
  "CREATE TABLE IF NOT EXISTS core_content_fields",
  "CREATE TABLE IF NOT EXISTS custom_field_groups",
  "CREATE TABLE IF NOT EXISTS custom_field_definitions",
  "CREATE TABLE IF NOT EXISTS agent_profiles",
  "CREATE TABLE IF NOT EXISTS agent_tasks",
  "CREATE TABLE IF NOT EXISTS agent_runs",
  "CREATE TABLE IF NOT EXISTS agent_steps",
  "CREATE TABLE IF NOT EXISTS agent_trace_events",
  "CREATE TABLE IF NOT EXISTS agent_execution_snapshots",
  "CREATE TABLE IF NOT EXISTS agent_task_inputs",
  "public_api INTEGER NOT NULL DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS comment_moderation_events",
  "CREATE TABLE IF NOT EXISTS plugin_meta_definitions",
  "CREATE TABLE IF NOT EXISTS content_meta",
  "CREATE TABLE IF NOT EXISTS user_meta",
  "CREATE TABLE IF NOT EXISTS plugin_actions",
  "CREATE TABLE IF NOT EXISTS plugin_taxonomies",
  "CREATE TABLE IF NOT EXISTS plugin_admin_menus",
  "CREATE TABLE IF NOT EXISTS plugin_terms",
  "CREATE TABLE IF NOT EXISTS plugin_content_terms",
  "CREATE TABLE IF NOT EXISTS plugin_records",
  "CREATE TABLE IF NOT EXISTS plugin_migrations",
  "CREATE TABLE IF NOT EXISTS plugin_jobs",
  "CREATE TABLE IF NOT EXISTS plugin_capabilities",
  "CREATE TABLE IF NOT EXISTS plugin_role_capabilities",
  "CREATE TABLE IF NOT EXISTS plugin_webhooks",
  "CREATE TABLE IF NOT EXISTS approval_requests",
  "CREATE TABLE IF NOT EXISTS approval_events",
  "CREATE TABLE IF NOT EXISTS agent_capabilities",
  "CREATE TABLE IF NOT EXISTS agent_capability_events",
  "CREATE TABLE IF NOT EXISTS roles",
  "CREATE TABLE IF NOT EXISTS role_permissions",
  "CREATE TABLE IF NOT EXISTS totp_credentials",
  "CREATE TABLE IF NOT EXISTS totp_recovery_codes",
  "CREATE TABLE IF NOT EXISTS totp_recovery_requests",
];
for (const fragment of required) assert.ok(schema.includes(fragment), `schema.sql debe incluir: ${fragment}`);

const database = new DatabaseSync(":memory:");
database.exec(schema);
const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
for (const table of ["content_items", "core_content_types", "core_content_fields", "custom_field_groups", "custom_field_definitions", "agent_profiles", "agent_profile_tools", "agent_tasks", "agent_runs", "agent_steps", "agent_trace_events", "agent_execution_snapshots", "agent_task_inputs", "plugin_installations", "plugin_records", "plugin_webhooks", "approval_requests", "approval_events", "agent_capabilities", "agent_capability_events", "totp_credentials", "totp_recovery_codes", "totp_recovery_requests", "roles", "role_permissions"]) {
  assert.ok(tables.has(table), `El esquema debe poder crear la tabla ${table}.`);
}
database.close();

const migrationEntries = (await readdir("migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name));
const migrations = [...migrationEntries].sort();
assert.equal(migrations.length, 29, "Actualiza esta prueba al añadir una migración nueva.");
assert.deepEqual(migrations.map((name) => Number(name.slice(0, 4))), Array.from({ length: 29 }, (_, index) => index + 2), "Las migraciones deben ser consecutivas.");
assert.equal(migrations.at(-1), "0030_agent_governance.sql", "Actualiza esta prueba al añadir una migración nueva.");

console.log(JSON.stringify({ ok: true, checks: ["fresh-schema-executes", "fresh-schema-plugin-tables", "fresh-schema-content-type", "migration-order"], migrations }));
