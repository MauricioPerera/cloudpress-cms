import { base64ToBytes, bytesToBase64, equalBytes, sha256 } from "./_shared.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let value = 0, bits = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const normalized = String(value || "").replace(/[\s=-]/g, "").toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error("TOTP inválido");
  let accumulator = 0, bits = 0;
  const output = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) { output.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(output);
}

function keyMaterial(env) {
  try {
    const key = base64ToBytes(String(env.TOTP_ENCRYPTION_KEY || ""));
    if (key.length !== 32) throw new Error();
    return key;
  } catch { throw new Error("TOTP_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes"); }
}

async function encryptionKey(env) {
  return crypto.subtle.importKey("raw", keyMaterial(env), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptTotpSecret(env, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(secret));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decryptTotpSecret(env, value) {
  const [iv, ciphertext, extra] = String(value || "").split(".");
  if (!iv || !ciphertext || extra) throw new Error("Secreto TOTP inválido");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(env), base64ToBytes(ciphertext));
  return new TextDecoder().decode(plain);
}

function counterBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index--) { bytes[index] = Number(value & 255n); value >>= 8n; }
  return bytes;
}

async function totpAt(secret, counter) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(counter)));
  const offset = digest[digest.length - 1] & 15;
  const number = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(number % 1_000_000).padStart(6, "0");
}

async function verifyTotp(secret, code, { now = Date.now(), lastCounter = null } = {}) {
  const candidate = String(code || "").trim();
  if (!/^\d{6}$/.test(candidate)) return null;
  const current = Math.floor(now / 30_000);
  for (const counter of [current - 1, current, current + 1]) {
    if (lastCounter !== null && counter <= Number(lastCounter)) continue;
    const expected = await totpAt(secret, counter);
    if (equalBytes(new TextEncoder().encode(candidate), new TextEncoder().encode(expected))) return counter;
  }
  return null;
}

function newTotpSecret() { return base32Encode(crypto.getRandomValues(new Uint8Array(20))); }
function newOpaqueToken() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))); }
async function tokenHash(value) { return bytesToBase64(await sha256(value)); }
function normalizeRecoveryCode(value) { return String(value || "").replace(/[\s-]/g, "").toUpperCase(); }
function newRecoveryCode() { return base32Encode(crypto.getRandomValues(new Uint8Array(8))).slice(0, 12).match(/.{1,4}/g).join("-"); }
async function recoveryCodeHash(value) { return tokenHash(`recovery-code:${normalizeRecoveryCode(value)}`); }
async function recoveryCompanionProof(env, requestId, recoveryToken) {
  const secret = String(env.LSFA_RECOVERY_SIGNING_KEY || "");
  if (secret.length < 32) throw new Error("LSFA_RECOVERY_SIGNING_KEY no está configurada");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = new TextEncoder().encode(`cloudpress-totp-recovery/v1\\n${requestId}\\n${recoveryToken}`);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, message)));
}
function otpAuthUri({ issuer = "CloudPress", account, secret }) {
  const label = `${issuer}:${account}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export { decryptTotpSecret, encryptTotpSecret, newOpaqueToken, newRecoveryCode, newTotpSecret, normalizeRecoveryCode, otpAuthUri, recoveryCodeHash, recoveryCompanionProof, tokenHash, totpAt, verifyTotp };
