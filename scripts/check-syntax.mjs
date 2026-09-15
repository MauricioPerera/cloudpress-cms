import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const exec = promisify(execFile);
async function filesIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesIn(path) : entry.name.endsWith(".js") ? [path] : [];
  }));
  return files.flat();
}

const files = await filesIn(".");
for (const file of files) await exec(process.execPath, ["--check", file]);
console.log(JSON.stringify({ ok: true, files: files.length }));
