import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export async function qualityGate(args = process.argv.slice(2)) {
  const approvedRef = option(args, "--approved-ref");
  if (!approvedRef) throw new Error("Indica --approved-ref <referencia-git-aprobada>.");
  const policy = JSON.parse(await readFile("quality/agent-quality-policy.json", "utf8"));
  let approvedCommit;
  try { approvedCommit = git(["rev-parse", "--verify", `${approvedRef}^{commit}`]); } catch { throw new Error("La referencia Git aprobada no resuelve a un commit."); }
  try { git(["merge-base", "--is-ancestor", approvedCommit, "HEAD"]); } catch { throw new Error("HEAD no desciende de la referencia Git aprobada."); }
  const changed = [...new Set([
    ...git(["diff", "--name-only", `${approvedCommit}...HEAD`]).split("\n"),
    ...git(["diff", "--name-only"]).split("\n"),
    ...git(["diff", "--name-only", "--cached"]).split("\n"),
  ].filter(Boolean))];
  const protectedChanges = changed.filter((path) => policy.protectedPaths.includes(path));
  if (protectedChanges.length) throw new Error(`El perímetro de pruebas aprobado fue modificado: ${protectedChanges.join(", ")}.`);
  const checks = [];
  for (const check of policy.requiredChecks) {
    const executable = process.platform === "win32" ? `${check.command[0]}.cmd` : check.command[0];
    const result = spawnSync(executable, check.command.slice(1), { stdio: "inherit" });
    checks.push({ category: check.category, command: check.command, status: result.status });
    if (result.status !== 0) throw new Error(`Falló la prueba obligatoria de ${check.category}.`);
  }
  return { ok: true, policyVersion: policy.version, approvedRef, approvedCommit, changed, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  qualityGate().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
