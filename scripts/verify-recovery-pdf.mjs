import assert from "node:assert/strict";
import { buildRecoveryCodesPdf } from "../recovery-codes-pdf.js";

const codes = ["ABCD-EFGH-IJKL", "MNOP-QRST-UVWX", "YZ23-4567-ABCD", "EFGH-IJKL-MNOP", "QRST-UVWX-YZ23", "4567-ABCD-EFGH", "IJKL-MNOP-QRST", "UVWX-YZ23-4567", "ABCD-EFGH-MNOP", "QRST-UVWX-4567"];
const documentBytes = buildRecoveryCodesPdf(codes);
const documentText = new TextDecoder().decode(documentBytes);
assert.ok(documentText.startsWith("%PDF-1.4\n"));
assert.ok(documentText.includes("xref\n0 6\n"));
assert.ok(documentText.includes("CloudPress - Codigos de respaldo"));
assert.ok(documentText.includes(codes[0]));
assert.throws(() => buildRecoveryCodesPdf(codes.slice(0, 9)));
console.log(JSON.stringify({ ok: true, checks: ["pdf-header", "pdf-xref", "recovery-codes-present", "invalid-code-count-rejected"] }));
