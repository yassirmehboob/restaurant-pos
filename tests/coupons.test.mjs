import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderPreview } from "../lib/order-calculation.ts";
import { businessTaxRates, orderWithDiscount, paymentTaxQuote } from "../lib/tax.ts";
import { couponBatchSchema, couponDescription, couponDiscount, couponProblem, normalizeCouponCode } from "../lib/coupons.ts";
import { generateCouponCode } from "../lib/coupon-service.ts";

const lines = [
  { key: "a", name: "Karahi", quantity: 1, unitPrice: 9000, taxRate: 0, isTaxInclusive: false },
  { key: "b", name: "Naan", quantity: 10, unitPrice: 333.33, taxRate: 0, isTaxInclusive: false },
];

test("a discount comes off the subtotal before tax, never the delivery charge, and splits to the paisa", () => {
  const plain = calculateOrderPreview(lines, 200, 16);
  const discounted = calculateOrderPreview(lines, 200, 16, 1000);
  assert.equal(plain.discountAmount, 0);
  assert.equal(discounted.subtotal, 12333.3);
  assert.equal(discounted.discountAmount, 1000);
  assert.equal(Math.round(discounted.lines.reduce((sum, line) => sum + line.discountAmount, 0) * 100), 100000);
  // Tax is rounded per line (existing behaviour), so the total may differ from 16% of the bill by a paisa.
  assert.ok(Math.abs(discounted.taxAmount - (12333.3 - 1000) * 0.16) <= 0.011);
  assert.equal(discounted.grandTotal, Math.round((12333.3 - 1000 + discounted.taxAmount + 200) * 100) / 100);
  assert.equal(discounted.deliveryCharge, 200);
  // The discount can never push the invoice below the delivery charge.
  assert.equal(calculateOrderPreview(lines, 200, 16, 999999).grandTotal, 200);
});

test("tax-inclusive item prices are taxed on the discounted price", () => {
  const result = calculateOrderPreview([{ key: "x", name: "Shake", quantity: 2, unitPrice: 575, taxRate: 15, isTaxInclusive: true }], 0, undefined, 150);
  assert.equal(result.grandTotal, 1000);
  assert.equal(result.taxAmount, Math.round((1000 - 1000 / 1.15) * 100) / 100);
});

test("percentage coupons respect the cap and minimum order; fixed coupons never exceed the bill", () => {
  const azadi = { discountType: "PERCENT", discountValue: 30, maxDiscount: 1500, minOrderAmount: 12000 };
  assert.equal(couponDiscount(azadi, 12000), 1500);
  assert.equal(couponDiscount({ ...azadi, maxDiscount: null }, 12000), 3600);
  assert.throws(() => couponDiscount(azadi, 11999.99), /Rs 12,000 or more/);
  assert.equal(couponDiscount({ discountType: "FIXED", discountValue: 500 }, 300), 300);
  assert.equal(couponDescription(azadi), "30% off (up to Rs 1,500) on orders of Rs 12,000 or more");
  assert.equal(couponDescription({ discountType: "FIXED", discountValue: 500 }), "Rs 500 off");
});

test("coupon eligibility enforces single use, offer status, dates, owner customer and next-visit rule", () => {
  const batch = { name: "Azadi Offer", discountType: "PERCENT", discountValue: 30, usage: "INSTANT", validFrom: "2026-08-01", expiresOn: "2026-08-31", isActive: true };
  const fresh = { status: "ACTIVE" }, today = { saleDate: "2026-08-14" };
  assert.equal(couponProblem(fresh, batch, today), null);
  assert.match(couponProblem({ status: "REDEEMED" }, batch, today), /already been used/);
  assert.match(couponProblem({ status: "VOID" }, batch, today), /cancelled/);
  assert.match(couponProblem({ status: "APPLIED" }, batch, today), /another unpaid order/);
  assert.match(couponProblem(fresh, { ...batch, isActive: false }, today), /stopped/);
  assert.match(couponProblem(fresh, batch, { saleDate: "2026-07-31" }), /from 01\/08\/2026/);
  assert.equal(couponProblem(fresh, batch, { saleDate: "2026-08-31" }), null, "the expiry day itself is valid");
  assert.match(couponProblem(fresh, batch, { saleDate: "2026-09-01" }), /expired on 31\/08\/2026/);
  const owned = { status: "ACTIVE", customerId: "a".repeat(24), issuedSaleDate: "2026-08-14" };
  assert.match(couponProblem(owned, batch, { ...today, customerId: "b".repeat(24) }), /another customer/);
  assert.match(couponProblem(owned, batch, today), /another customer/, "walk-in cannot use a customer's coupon");
  assert.equal(couponProblem(owned, batch, { ...today, customerId: "a".repeat(24) }), null);
  const nextVisit = { ...batch, usage: "NEXT_VISIT" };
  assert.match(couponProblem(owned, nextVisit, { ...today, customerId: "a".repeat(24) }), /next visit/, "not on the day it was given");
  assert.equal(couponProblem(owned, nextVisit, { saleDate: "2026-08-15", customerId: "a".repeat(24) }), null);
  assert.match(couponProblem(fresh, nextVisit, today), /not been given/);
});

test("batch settings are validated on the server", () => {
  const base = { name: "Valentine's Day Offer", discountType: "PERCENT", discountValue: 30, maxDiscount: 1500, minOrderAmount: 12000, usage: "NEXT_VISIT", validFrom: "", expiresOn: "2026-02-28", autoIssueEnabled: true, autoIssueMinSpend: 5000, quantity: 250 };
  const parsed = couponBatchSchema.parse(base);
  assert.equal(parsed.validFrom, null); assert.equal(parsed.expiresOn, "2026-02-28");
  const fails = patch => !couponBatchSchema.safeParse({ ...base, ...patch }).success;
  assert.ok(fails({ discountValue: 101 }), "more than 100%");
  assert.ok(fails({ discountType: "FIXED" }), "a cap only applies to percentages");
  assert.ok(fails({ quantity: 0 }) && fails({ quantity: 10001 }) && fails({ quantity: 2.5 }));
  assert.ok(fails({ validFrom: "2026-03-01" }), "expiry before start");
  assert.ok(fails({ expiresOn: "2026-02-30" }), "impossible date");
  assert.ok(fails({ autoIssueMinSpend: 0 }), "auto-issue needs a spend amount");
  assert.ok(fails({ name: " " }));
});

test("codes are 10 digits without a leading zero and are normalised from input", () => {
  for (let index = 0; index < 2000; index++) assert.match(generateCouponCode(), /^[1-9]\d{9}$/);
  assert.equal(normalizeCouponCode(" 1234-567 890 "), "1234567890");
  assert.equal(normalizeCouponCode("0123456789"), null);
  assert.equal(normalizeCouponCode("123456789"), null);
});

test("a discounted invoice keeps its discount when the payment method changes its tax rate", () => {
  const rates = businessTaxRates({ saleTaxRate: 16, paymentTaxRates: { CARD: 5 } });
  const items = [{ lineId: "a", nameSnapshot: "Karahi", quantity: 1, unitPrice: 12000, taxRate: 16, isTaxInclusive: false }];
  const order = { items, subtotal: 12000, taxAmount: 1920, grandTotal: 13920, dueAmount: 13920, paidAmount: 0, deliveryChargeAmount: 0, paymentTaxRatesSnapshot: rates, taxPaymentMethod: "CASH", taxRateSnapshot: 16 };
  const withCoupon = { ...order, ...orderWithDiscount(order, 1500) };
  assert.equal(withCoupon.discountAmount, 1500);
  assert.equal(withCoupon.taxAmount, 1680);
  assert.equal(withCoupon.grandTotal, 12180);
  const card = paymentTaxQuote(withCoupon, "CARD");
  assert.equal(card.discountAmount, 1500);
  assert.equal(card.taxAmount, 525);
  assert.equal(card.grandTotal, 11025);
  assert.equal(orderWithDiscount(withCoupon, 0).grandTotal, 13920, "removing the coupon restores the original total");
});
