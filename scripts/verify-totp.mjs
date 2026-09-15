import assert from "node:assert/strict";
import { decryptTotpSecret, encryptTotpSecret, newRecoveryCode, recoveryCodeHash, totpAt, verifyTotp } from "../functions/_totp.js";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
assert.equal(await totpAt(secret, 1), "287082", "Debe coincidir con el vector RFC 6238 de 6 dígitos.");
assert.equal(await verifyTotp(secret, "287082", { now: 59_000 }), 1);
assert.equal(await verifyTotp(secret, "287082", { now: 59_000, lastCounter: 1 }), null, "Un OTP ya consumido no puede reutilizarse.");
assert.equal(await verifyTotp(secret, "000000", { now: 59_000 }), null);

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const encrypted = await encryptTotpSecret({ TOTP_ENCRYPTION_KEY: key }, secret);
assert.notEqual(encrypted, secret, "El secreto no se almacena en claro.");
assert.equal(await decryptTotpSecret({ TOTP_ENCRYPTION_KEY: key }, encrypted), secret);
const code = newRecoveryCode();
assert.match(code, /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){2}$/);
assert.notEqual(await recoveryCodeHash(code), code);

console.log(JSON.stringify({ ok: true, checks: ["rfc-totp-vector", "totp-single-use", "encrypted-secret", "hashed-recovery-code"] }));
