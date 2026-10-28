import assert from "node:assert/strict";
import test from "node:test";
import { csvCell } from "../lib/csv.ts";
import { validateImageBytes, MAX_IMAGE_BYTES } from "../lib/image-upload.ts";
import { uploadImage } from "../lib/uploads.ts";
import { registrationSchema, loginSchema } from "../lib/validation/auth.ts";
import { userAccountSchema } from "../lib/validation/user-account.ts";
import { saleSessionError } from "../lib/sale-sessions.ts";
import { paymentInputSchema } from "../lib/validation/payment.ts";

test("CSV export neutralizes spreadsheet formulas without changing numeric values", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", " \t=1+1", "\r\n=1+1", "\u0000=1+1"]) assert.equal(csvCell(value), '"\'' + value + '"');
  assert.equal(csvCell('Name, "Test"'), '"Name, ""Test"""');
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(csvCell("Restaurant"), '"Restaurant"');
});
test("image validation rejects executable files and mismatched or oversized content", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(validateImageBytes(png, "image/png"), "image/png");
  assert.equal(validateImageBytes(Uint8Array.from([255, 216, 255, 0]), "image/jpeg"), "image/jpeg");
  assert.equal(validateImageBytes(new TextEncoder().encode("RIFF0000WEBP"), "image/webp"), "image/webp");
  assert.throws(() => validateImageBytes(png, "image/jpeg"));
  assert.throws(() => validateImageBytes(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png"));
  for (const content of ["<html><script>alert(1)</script>", '<svg onload="alert(1)"></svg>']) {
    assert.throws(() => validateImageBytes(new TextEncoder().encode(content), "image/png"));
    await assert.rejects(uploadImage(new File([content], "fake.png", { type: "image/png" }), "business-0123456789abcdef01234567/products"), /file contents/);
  }
});
test("all password entry schemas enforce bcrypt's 72-byte limit", () => {
  const account = { fullName: "Cashier", phone: "03001234567", username: "cashier", password: "a".repeat(72), role: "CASHIER", isActive: true, privileges: [] };
  const registration = { businessName: "Test restaurant", fullName: account.fullName, username: account.username, password: account.password };
  for (const password of ["a".repeat(73), "\u00e9".repeat(37)]) {
    assert.equal(registrationSchema.safeParse({ ...registration, password }).success, false);
    assert.equal(loginSchema.safeParse({ username: account.username, password }).success, false);
    assert.equal(userAccountSchema.safeParse({ ...account, password }).success, false);
  }
  assert.equal(registrationSchema.safeParse(registration).success, true);
});
test("database errors do not expose internal details in action responses", () => {
  class MongoServerError extends Error {}
  assert.ok(!saleSessionError(new MongoServerError("Internal database host and collection" )).includes("host"));
  assert.equal(saleSessionError(new Error("Start a sale before receiving payment.")), "Start a sale before receiving payment.");
});
test("payment inputs reject overflow, non-finite values and fractional cents", () => {
  const input = { idempotencyKey: "12345678-1234-4123-8123-123456789abc", method: "CASH", expectedGrandTotal: 100, tenderedAmount: 100, reference: "", notes: "" };
  assert.equal(paymentInputSchema.safeParse(input).success, true);
  for (const value of [Infinity, NaN, 1e308, -1, 100.001]) {
    assert.equal(paymentInputSchema.safeParse({ ...input, tenderedAmount: value }).success, false);
    assert.equal(paymentInputSchema.safeParse({ ...input, expectedGrandTotal: value }).success, false);
  }
});
