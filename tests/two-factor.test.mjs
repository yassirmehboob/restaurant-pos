import assert from "node:assert/strict";
import test from "node:test";
import { base32Encode, totpAtStep, verifyTotp, generateTotpSecret, encryptTotpSecret, decryptTotpSecret, generateRecoveryCodes, recoveryCodeHash, totpSetupUri } from "../lib/auth/totp.ts";

test("setup QR payload identifies the account and matches authenticator parameters", () => {
  const secret = generateTotpSecret(), uri = new URL(totpSetupUri(secret, "cashier.1+test@example.com"));
  assert.equal(uri.protocol, "otpauth:"); assert.equal(uri.hostname, "totp");
  assert.equal(decodeURIComponent(uri.pathname), "/Restaurant POS:cashier.1+test@example.com");
  assert.equal(uri.searchParams.get("issuer"), "Restaurant POS");
  assert.equal(uri.searchParams.get("secret"), secret);
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
});

test("TOTP matches RFC 6238 SHA-1 reference vectors", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]]) {
    assert.equal(totpAtStep(secret, Math.floor(seconds / 30), 8), expected);
  }
});
test("verification rejects malformed, expired and replayed codes", () => {
  const secret = generateTotpSecret(), now = 1234567890000, step = Math.floor(now / 30000);
  for (const accepted of [step - 1, step, step + 1]) assert.equal(verifyTotp(secret, totpAtStep(secret, accepted), -1, now), accepted);
  assert.equal(verifyTotp(secret, totpAtStep(secret, step), step, now), null);
  assert.equal(verifyTotp(secret, totpAtStep(secret, step - 2), -1, now), null);
  for (const code of ["", "12345", "abcdef", "1234567"]) assert.equal(verifyTotp(secret, code, -1, now), null);
});
test("secrets are encrypted, authenticated and bound to their account", () => {
  const key = "a".repeat(32), secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, key, "account-a");
  assert.equal(decryptTotpSecret(encrypted, key, "account-a"), secret);
  assert.ok(!encrypted.includes(secret));
  assert.notEqual(encrypted, encryptTotpSecret(secret, key, "account-a"));
  assert.throws(() => decryptTotpSecret(encrypted, key, "account-b"));
  assert.throws(() => decryptTotpSecret(encrypted, "b".repeat(32), "account-a"));
  const [iv, tag, data] = encrypted.split(".");
  const modified = Buffer.from(data, "base64url"); modified[0] ^= 1;
  assert.throws(() => decryptTotpSecret([iv, tag, modified.toString("base64url")].join("."), key, "account-a"));
});
test("recovery codes are distinct and stored as normalized hashes", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8); assert.equal(new Set(codes).size, 8);
  for (const code of codes) {
    const hash = recoveryCodeHash(code);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash, recoveryCodeHash(code.toUpperCase().replaceAll("-", "")));
    assert.notEqual(hash, code);
  }
  assert.equal(recoveryCodeHash("123456"), null);
});
