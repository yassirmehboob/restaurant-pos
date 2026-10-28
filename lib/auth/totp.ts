import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Buffer): string {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(secret: string): Buffer {
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(char); if (index < 0) throw new Error("Invalid authenticator secret.");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
export const generateTotpSecret = () => base32Encode(randomBytes(20));
export function totpSetupUri(secret: string, username: string): string {
  const issuer = "Restaurant POS";
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?${params}`;
}
export function totpAtStep(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, "0");
}
export function verifyTotp(secret: string, code: string, lastStep = -1, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (step < 0 || step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpAtStep(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}
function encryptionKey(key: string) {
  if (key.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return createHmac("sha256", key).update("restaurant-pos/totp/encryption/v1").digest();
}
export function encryptTotpSecret(secret: string, key: string, userId: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64url")).join(".");
}
export function decryptTotpSecret(encoded: string, key: string, userId: string): string {
  const [iv, tag, ciphertext] = encoded.split(".").map(value => Buffer.from(value, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), iv);
  decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export function recoveryCodeHash(code: string): string | null {
  const normalized = code.trim().replace(/-/g, "").toLowerCase();
  return /^[a-f0-9]{32}$/.test(normalized) ? createHash("sha256").update(normalized).digest("hex") : null;
}
export function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"));
}
