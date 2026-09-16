import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nativeMigrationArgs } from "./d1-migrate.mjs";

assert.deepEqual(nativeMigrationArgs("cloudpress-db", "wrangler.jsonc"), ["d1", "migrations", "apply", "cloudpress-db", "--remote", "--config", "wrangler.jsonc"]);
assert.deepEqual(nativeMigrationArgs("cloudpress-db", "custom.jsonc", "list"), ["d1", "migrations", "list", "cloudpress-db", "--remote", "--config", "custom.jsonc"]);
assert.throws(() => nativeMigrationArgs("cloudpress-db", "wrangler.jsonc", "execute"), /Configuración inválida/);

const executor = await readFile("scripts/d1-migrate.mjs", "utf8");
assert.match(executor, /executeWrangler\(nativeMigrationArgs\(/, "Las migraciones pendientes deben delegarse al ejecutor transaccional nativo de Wrangler.");
assert.doesNotMatch(executor, /for \(const name of plan\.pending\).*migrationTransaction/s, "El ejecutor no debe enviar BEGIN manual a D1.");
assert.match(executor, /id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE/, "El ledger debe ser compatible con Wrangler D1 migrations.");

console.log(JSON.stringify({ ok: true, checks: ["native-wrangler-apply", "custom-config", "native-ledger-schema", "manual-transaction-not-executed"] }));
