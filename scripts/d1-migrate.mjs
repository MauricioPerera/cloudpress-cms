import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationPattern = /^\d{4}_.+\.sql$/;
const ledgerSql = "CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)";
const require = createRequire(import.meta.url);

export function parseArguments(args) {
  const options = { remote: false, dryRun: false, baseline: null, reconcileTo: null, database: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote") options.remote = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--database" || argument === "--baseline" || argument === "--reconcile-to") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requiere un valor.`);
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else throw new Error(`Argumento no reconocido: ${argument}`);
  }
  if (!options.database) throw new Error("Indica --database <nombre-o-id>.");
  if (!options.remote) throw new Error("Este ejecutor exige --remote para impedir aplicar migraciones por error contra el estado local.");
  if (options.baseline && options.reconcileTo) throw new Error("Usa sólo una de --baseline o --reconcile-to.");
  return options;
}

export function planMigrations(migrations, applied, baseline, reconcileTo = null) {
  const ordered = [...migrations].sort();
  const invalidApplied = [...applied].filter((name) => !ordered.includes(name));
  if (invalidApplied.length) throw new Error(`El ledger contiene migraciones que ya no existen: ${invalidApplied.join(", ")}.`);
  if (reconcileTo) {
    if (!ordered.includes(reconcileTo)) throw new Error(`Reconciliación inválida: ${reconcileTo}. Debe ser un archivo presente en migrations/.`);
    const through = ordered.slice(0, ordered.indexOf(reconcileTo) + 1);
    const beyond = [...applied].filter((name) => !through.includes(name));
    if (beyond.length) throw new Error(`El ledger contiene migraciones posteriores a ${reconcileTo}: ${beyond.join(", ")}.`);
    return { baseline: [], reconciled: through.filter((name) => !applied.has(name)), pending: ordered.slice(through.length) };
  }
  if (applied.size > 0 && baseline) throw new Error("El ledger ya contiene migraciones; elimina --baseline para que se apliquen únicamente las no registradas.");
  if (applied.size === 0 && !baseline) {
    throw new Error("El ledger está vacío. Indica --baseline <última-migración-aplicada> para registrar una instancia existente, o --baseline none únicamente si esta base aún requiere todas las migraciones.");
  }
  const expectedPrefix = ordered.slice(0, applied.size);
  if (applied.size && expectedPrefix.some((name) => !applied.has(name))) {
    throw new Error("El ledger es discontinuo. Verifica la estructura de D1 y usa --reconcile-to <última-migración-ya-aplicada> para registrar sólo migraciones históricas confirmadas.");
  }
  if (baseline === "none") return { baseline: [], reconciled: [], pending: ordered };
  if (baseline) {
    if (!ordered.includes(baseline)) throw new Error(`Baseline inválido: ${baseline}. Debe ser un archivo presente en migrations/.`);
    const baselineIndex = ordered.indexOf(baseline);
    return { baseline: ordered.slice(0, baselineIndex + 1), reconciled: [], pending: ordered.slice(baselineIndex + 1) };
  }
  return { baseline: [], reconciled: [], pending: ordered.filter((name) => !applied.has(name)) };
}

export function migrationTransaction(source, name) {
  if (!migrationPattern.test(name)) throw new Error(`Nombre de migración inválido: ${name}`);
  return `BEGIN IMMEDIATE;\n${source}\nINSERT INTO d1_migrations(name) VALUES ('${name}');\nCOMMIT;`;
}

function executeWrangler(args) {
  return new Promise((resolve, reject) => {
    let executable = "wrangler", commandArgs = args;
    if (process.platform === "win32") {
      let cli = null;
      try { cli = require.resolve("wrangler/bin/wrangler.js"); } catch { /* Wrangler may be installed globally. */ }
      const globalCli = process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "wrangler", "bin", "wrangler.js");
      if (!cli && globalCli && existsSync(globalCli)) cli = globalCli;
      if (!cli) return reject(new Error("No se encontró la CLI de Wrangler. Instala Wrangler v4 o añade wrangler como dependencia del proyecto."));
      executable = process.execPath;
      commandArgs = [cli, ...args];
    }
    const child = spawn(executable, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || stdout.trim() || `wrangler terminó con código ${code}.`)));
  });
}

function rowsFromWrangler(json) {
  const response = JSON.parse(json);
  const entries = Array.isArray(response) ? response : [response];
  return entries.flatMap((entry) => entry?.results || entry?.result?.results || []);
}

async function d1(database, sql, json = false) {
  const args = ["d1", "execute", database, "--remote", "--command", sql];
  if (json) args.push("--json");
  return executeWrangler(args);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const migrations = (await readdir("migrations")).filter((name) => migrationPattern.test(name)).sort();
  if (!migrations.length) throw new Error("No se encontraron migraciones en migrations/.");

  if (!options.dryRun) await d1(options.database, ledgerSql);
  let rows = [];
  try {
    rows = rowsFromWrangler(await d1(options.database, "SELECT name FROM d1_migrations ORDER BY name", true));
  } catch (error) {
    if (!options.dryRun || !/no such table: d1_migrations/i.test(error.message)) throw error;
  }
  const applied = new Set(rows.map((row) => row.name));
  const plan = planMigrations(migrations, applied, options.baseline, options.reconcileTo);

  if (options.dryRun) return { database: options.database, dryRun: true, ...plan };
  for (const name of [...plan.baseline, ...plan.reconciled]) await d1(options.database, `INSERT OR IGNORE INTO d1_migrations(name) VALUES ('${name}')`);
  for (const name of plan.pending) await d1(options.database, migrationTransaction(await readFile(`migrations/${name}`, "utf8"), name));
  return { database: options.database, dryRun: false, baseline: plan.baseline, reconciled: plan.reconciled, applied: plan.pending };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((result) => console.log(JSON.stringify({ ok: true, ...result }))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
