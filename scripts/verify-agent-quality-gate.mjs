import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const policy = JSON.parse(await readFile("quality/agent-quality-policy.json", "utf8"));
assert.equal(policy.version, "cloudpress-agent-quality/v1");
assert.deepEqual(policy.requiredChecks.map((check) => check.category), ["functional", "adversarial", "interface"], "El gate debe exigir las tres clases de prueba.");
assert.ok(policy.protectedPaths.includes("scripts/verify-agent-os.mjs"), "El oracle funcional debe pertenecer al perímetro protegido.");
const gate = await readFile("scripts/agent-quality-gate.mjs", "utf8");
for (const token of ["--approved-ref", "merge-base", "protectedChanges", "requiredChecks"]) assert.ok(gate.includes(token), `El gate debe incluir ${token}.`);
console.log(JSON.stringify({ ok: true, checks: ["approved-reference-required", "protected-test-perimeter", "functional-adversarial-interface"] }));
