import assert from "node:assert/strict";
import { toolContracts } from "../functions/_agent-tool-contracts.js";
import { reversibleTools } from "../webmcp/fastwebmcp-tools.js";

const runtimeProtocols = new Set(["cloudpress_record_task_step"]);
const exposed = new Set(reversibleTools.map((tool) => tool.name));
for (const name of exposed) assert.ok(runtimeProtocols.has(name) || toolContracts.some((contract) => contract.name === name), `${name} debe tener contrato de servidor.`);
for (const contract of toolContracts) assert.ok(contract.name === "cloudpress_sensitive_action" || exposed.has(contract.name), `${contract.name} no debe autorizarse si no está expuesta.`);
assert.ok(toolContracts.some((contract) => contract.name === "cloudpress_create_draft" && contract.body), "Crear borrador debe verificar status=draft en servidor.");
assert.ok(toolContracts.some((contract) => contract.name === "cloudpress_sensitive_action" && contract.risk === "sensitive"), "La acción irreversible debe declararse sensible.");
assert.ok(["read", "reversible"].every((risk) => toolContracts.some((contract) => contract.name === "cloudpress_plugin_action" && contract.risk === risk)), "Las acciones de plugin deben pasar por contratos de lectura o reversibles del core.");
console.log(JSON.stringify({ ok: true, checks: ["webmcp-contract-parity", "draft-server-postcondition", "sensitive-contract"] }));
