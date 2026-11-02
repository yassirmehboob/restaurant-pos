import assert from "node:assert/strict";
import test from "node:test";
import { discountSettingsSchema, resolveInvoiceDiscount } from "../lib/invoice-discount.ts";

const open = { id: "0123456789abcdef01234567", name: "Discount", mode: "OPEN", percent: null, capAmount: null, remarksRequired: false };
const special = { id: "0123456789abcdef01234568", name: "Special Relation Discount", mode: "FIXED", percent: 20, capAmount: 1500, remarksRequired: true };
const types = [open, special];

test("an open discount uses the cashier's percentage, rounded to the whole rupee", () => {
  const applied = resolveInvoiceDiscount(types, { typeId: open.id, percent: 10 }, 34848);
  assert.deepEqual([applied.name, applied.percent, applied.amount], ["Discount", 10, 3485]);
  assert.throws(() => resolveInvoiceDiscount(types, { typeId: open.id }, 1000), /percentage/);
  assert.throws(() => resolveInvoiceDiscount(types, { typeId: open.id, percent: 120 }, 1000));
});

test("a fixed discount ignores the typed percentage and stops at its cap", () => {
  assert.equal(resolveInvoiceDiscount(types, { typeId: special.id, percent: 90, remarks: "Brother" }, 5000).amount, 1000);
  const capped = resolveInvoiceDiscount(types, { typeId: special.id, remarks: "Brother" }, 10000);
  assert.deepEqual([capped.percent, capped.amount, capped.remarks], [20, 1500, "Brother"]);
});

test("remarks are enforced at payment but not while previewing", () => {
  assert.throws(() => resolveInvoiceDiscount(types, { typeId: special.id }, 5000), /Enter remarks for Special Relation Discount/);
  assert.equal(resolveInvoiceDiscount(types, { typeId: special.id }, 5000, { requireRemarks: false }).amount, 1000);
});

test("unknown types and zero-value discounts are refused", () => {
  assert.throws(() => resolveInvoiceDiscount(types, { typeId: "0123456789abcdef0123456f", percent: 10 }, 1000), /no longer available/);
  assert.throws(() => resolveInvoiceDiscount([], { typeId: open.id, percent: 10 }, 1000), /no longer available/);
  assert.throws(() => resolveInvoiceDiscount(types, { typeId: open.id, percent: 1 }, 20), /Rs 0/);
});

test("discount settings validate fixed percentages, unique names and SMS numbers", () => {
  const row = { name: "Discount", mode: "OPEN", percent: null, capAmount: null, remarksRequired: false };
  const settings = { enabled: true, types: [row], smsNumbers: ["0300 1234567"], currentPassword: "x" };
  assert.equal(discountSettingsSchema.safeParse(settings).success, true);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, types: [{ ...row, mode: "FIXED" }] }).success, false);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, types: [row, { ...row, name: "discount" }] }).success, false);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, types: [] }).success, false);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, enabled: false, types: [] }).success, true);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, smsNumbers: ["12345"] }).success, false);
  assert.equal(discountSettingsSchema.safeParse({ ...settings, smsNumbers: Array(6).fill("03001234567") }).success, false);
});
