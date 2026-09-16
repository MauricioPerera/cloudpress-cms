import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legacy = await readFile("admin-ui-legacy.js", "utf8");
const admin = await readFile("admin.html", "utf8");

assert.match(legacy, /button\.closest\('#cloudpress-ui'\)/, "El puente heredado no debe interceptar controles de CloudPressUI.");
assert.match(legacy, /button\.dataset\.cloudpressConfirm === 'modern'/, "El puente heredado debe omitir acciones que ya tienen diálogo moderno.");
assert.match(legacy, /CloudPressUI\.confirm/, "El puente heredado debe conservar confirmación para pantallas que aún usan diálogos nativos.");
assert.match(admin, /CloudPressUI\.confirm\(\{title:'Enviar contenido a la papelera'/, "El envío a Papelera debe usar el diálogo moderno.");
assert.match(admin, /data-cloudpress-confirm="modern"/, "El botón de Papelera debe declararse como acción moderna.");

console.log(JSON.stringify({ ok: true, checks: ["legacy-bridge-bypass", "native-confirm-coverage", "trash-modern-dialog", "single-confirmation"] }));
