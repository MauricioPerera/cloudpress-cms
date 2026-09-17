import assert from "node:assert/strict";
import { bytesToBase64, pbkdf2, verifyPassword } from "../functions/_shared.js";

const password = "correct horse battery staple";
const salt = crypto.getRandomValues(new Uint8Array(16));

const currentHash = bytesToBase64(await pbkdf2(password, salt));
assert.deepEqual(await verifyPassword(password, salt, currentHash), { valid: true, needsUpgrade: false });
assert.equal((await verifyPassword("incorrect", salt, currentHash)).valid, false);

const deployedLimitHash = bytesToBase64(await pbkdf2(password, salt, 100000));
assert.deepEqual(await verifyPassword(password, salt, deployedLimitHash), { valid: true, needsUpgrade: false });

console.log(JSON.stringify({ ok: true, checks: ["worker-compatible-password-hash", "wrong-password-rejected"] }));
