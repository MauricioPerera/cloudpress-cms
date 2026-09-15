import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const schema = await readFile("schema.sql", "utf8");
const required = [
  "content_type TEXT NOT NULL DEFAULT 'post'",
  "CREATE TABLE IF NOT EXISTS plugin_installations",
  "CREATE TABLE IF NOT EXISTS plugin_audit_log",
  "CREATE TABLE IF NOT EXISTS plugin_content_types",
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
  "CREATE TABLE IF NOT EXISTS totp_credentials",
  "CREATE TABLE IF NOT EXISTS totp_recovery_codes",
  "CREATE TABLE IF NOT EXISTS totp_recovery_requests",
];
for (const fragment of required) assert.ok(schema.includes(fragment), `schema.sql debe incluir: ${fragment}`);

const database = new DatabaseSync(":memory:");
database.exec(schema);
const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
for (const table of ["content_items", "plugin_installations", "plugin_records", "plugin_webhooks", "approval_requests", "approval_events", "totp_credentials", "totp_recovery_codes", "totp_recovery_requests"]) {
  assert.ok(tables.has(table), `El esquema debe poder crear la tabla ${table}.`);
}
database.close();

const migrationEntries = (await readdir("migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name));
const migrations = [...migrationEntries].sort();
assert.equal(migrations.length, 16, "Actualiza esta prueba al añadir una migración nueva.");
assert.deepEqual(migrations.map((name) => Number(name.slice(0, 4))), Array.from({ length: 16 }, (_, index) => index + 2), "Las migraciones deben ser consecutivas.");
assert.equal(migrations.at(-1), "0017_totp_recovery.sql", "Actualiza esta prueba al añadir una migración nueva.");

console.log(JSON.stringify({ ok: true, checks: ["fresh-schema-executes", "fresh-schema-plugin-tables", "fresh-schema-content-type", "migration-order"], migrations }));
