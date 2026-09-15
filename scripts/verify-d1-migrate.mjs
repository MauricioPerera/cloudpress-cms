import assert from "node:assert/strict";
import { migrationTransaction, parseArguments, planMigrations } from "./d1-migrate.mjs";

const migrations = ["0002_content.sql", "0003_security.sql", "0004_organization.sql"];

assert.deepEqual(parseArguments(["--database", "cloudpress", "--remote", "--dry-run"]), { database: "cloudpress", remote: true, dryRun: true, baseline: null, reconcileTo: null });
assert.throws(() => parseArguments(["--database", "cloudpress"]), /--remote/);
assert.throws(() => planMigrations(migrations, new Set(), null), /ledger está vacío/);
assert.deepEqual(planMigrations(migrations, new Set(), "0003_security.sql"), { baseline: ["0002_content.sql", "0003_security.sql"], reconciled: [], pending: ["0004_organization.sql"] });
assert.deepEqual(planMigrations(migrations, new Set(["0002_content.sql"]), null), { baseline: [], reconciled: [], pending: ["0003_security.sql", "0004_organization.sql"] });
assert.throws(() => planMigrations(migrations, new Set(["0002_content.sql"]), "0003_security.sql"), /elimina --baseline/);
assert.throws(() => planMigrations(migrations, new Set(["9999_removed.sql"]), null), /ya no existen/);
assert.throws(() => planMigrations(migrations, new Set(["0002_content.sql", "0004_organization.sql"]), null), /ledger es discontinuo/);
assert.deepEqual(planMigrations(migrations, new Set(["0002_content.sql", "0004_organization.sql"]), null, "0004_organization.sql"), { baseline: [], reconciled: ["0003_security.sql"], pending: [] });
const transaction = migrationTransaction("CREATE TABLE example (id INTEGER);", "0002_content.sql");
assert.match(transaction, /^BEGIN IMMEDIATE;/);
assert.match(transaction, /INSERT INTO d1_migrations\(name\) VALUES \('0002_content\.sql'\)/);
assert.match(transaction, /COMMIT;$/);

console.log(JSON.stringify({ ok: true, checks: ["argument-validation", "baseline-plan", "ledger-safety", "atomic-migration-transaction"] }));
