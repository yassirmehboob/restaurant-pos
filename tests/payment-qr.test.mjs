import assert from "node:assert/strict";
import test from "node:test";
import { renderReceipt, showPaymentQr, paymentQrWidth } from "../lib/receipt-layout.ts";
import { decodeEscPos } from "../lib/receipt-raster.ts";

const order = paymentStatus => ({ orderNumber: "ORD-9", createdAt: "2026-11-08T08:00:00Z", orderType: "DINE_IN", paymentStatus, items: [{ quantity: 1, nameSnapshot: "Karahi", unitPrice: 1000 }], subtotal: 1000, taxAmount: 0, grandTotal: 1000, paidAmount: paymentStatus === "PAID" ? 1000 : 0, dueAmount: paymentStatus === "PAID" ? 0 : 1000 });
const qr = { paymentQrUrl: "/api/images/abc" };

test("the payment QR code follows the chosen bills: unpaid only, both, or never", () => {
  assert.equal(showPaymentQr({}, order("UNPAID")), false, "nothing uploaded");
  // Unpaid only is the default.
  assert.deepEqual(["UNPAID", "PARTIAL", "PAID"].map(status => showPaymentQr(qr, order(status))), [true, true, false]);
  assert.deepEqual(["UNPAID", "PARTIAL", "PAID"].map(status => showPaymentQr({ ...qr, paymentQrShowOn: "ALL" }, order(status))), [true, true, true]);
  assert.deepEqual(["UNPAID", "PAID"].map(status => showPaymentQr({ ...qr, paymentQrShowOn: "NEVER" }, order(status))), [false, false]);
});

test("the QR code prints after the bill summary with its caption, sized to the paper", () => {
  const parts = renderReceipt("customer", { name: "Grill", ...qr, paymentQrCaption: "Scan to pay - Raast" }, order("UNPAID"));
  const index = parts.findIndex(part => part.type === "logo");
  assert.deepEqual(parts[index], { type: "logo", url: "/api/images/abc", width: paymentQrWidth("80") });
  const before = decodeEscPos(parts[index - 1].base64).map(row => row.text?.trim()), after = decodeEscPos(parts[index + 1].base64).map(row => row.text?.trim());
  // Balance, then the caption right above the image; the barcode, footer and cut follow it.
  assert.ok(before.findIndex(text => text?.startsWith("Balance")) < before.indexOf("Scan to pay - Raast"));
  assert.equal(before.filter(Boolean).at(-1), "Scan to pay - Raast");
  assert.ok(after.includes("Thank you!"));
  assert.equal(renderReceipt("customer", { name: "Grill", receiptPaperWidth: "58", ...qr }, order("UNPAID")).find(part => part.type === "logo").width, paymentQrWidth("58"));
  // Default caption, and no QR at all on a paid receipt in unpaid-only mode.
  assert.ok(decodeEscPos(renderReceipt("customer", { name: "Grill", ...qr }, order("PARTIAL")).find(part => part.type === "command").base64).some(row => row.text?.trim() === "Scan to pay"));
  assert.ok(!renderReceipt("customer", { name: "Grill", ...qr }, order("PAID")).some(part => part.type === "logo"));
  // Kitchen tickets never carry it.
  assert.ok(!renderReceipt("kitchen", { name: "Grill", ...qr, paymentQrShowOn: "ALL" }, order("UNPAID")).some(part => part.type === "logo"));
});
