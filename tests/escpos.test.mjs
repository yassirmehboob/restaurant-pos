import assert from "node:assert/strict";
import test from "node:test";
import { EscPos, columnsFor, wrap } from "../lib/escpos.ts";
import { printerTargetSchema, describePrinter } from "../lib/printer-target.ts";

const text = bytes => Buffer.from(bytes).toString("latin1");

test("receipt columns match the TM-T88V Font A width for each paper size", () => {
  assert.equal(columnsFor("80"), 42);
  assert.equal(columnsFor("58"), 30);
});

test("wrapping never exceeds the line width, including very long words", () => {
  const lines = wrap("Chicken Tikka Pizza Extra Large Supercalifragilisticexpialidocious with cheese", 12);
  assert.ok(lines.every(line => line.length <= 12), JSON.stringify(lines));
  assert.equal(lines.join(" ").replace(/\s+/g, ""), "ChickenTikkaPizzaExtraLargeSupercalifragilisticexpialidociouswithcheese");
  assert.deepEqual(wrap("a\nb", 10), ["a", "b"]);
});

test("rows right-align amounts on the last wrapped line", () => {
  const printed = text(new EscPos(20).row("2x Very long burger name", "1,200.00").toBytes()).split("\n").filter(Boolean).map(line => line.replace(/^\x1b@\x1bt\x10/, ""));
  assert.ok(printed.every(line => line.length <= 20), JSON.stringify(printed));
  assert.ok(printed.at(-1).endsWith("1,200.00"));
  assert.equal(printed.at(-1).length, 20);
});

test("line() keeps table spacing and cuts at the paper width", () => {
  const printed = text(new EscPos(12).line("1  Naan     50.00").line("#  Item").toBytes()).split("\n").map(line => line.replace(/^\x1b@\x1bt\x10/, ""));
  assert.deepEqual(printed.slice(0, 2), ["1  Naan     ", "#  Item"]);
});

test("printer is initialised with the Latin code page and unsupported characters print as ?", () => {
  const bytes = new EscPos(42).text("Café × 2 — اردو").toBytes();
  assert.deepEqual([...bytes.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 16]);
  assert.equal(text(bytes.slice(5)), "Café x 2 - ????\n");
});

test("barcode, cut and base64 output are valid ESC/POS", () => {
  const job = new EscPos(42).barcode("ORD-1001").cut();
  const bytes = [...job.toBytes()];
  const k = bytes.indexOf(0x6b);
  assert.deepEqual(bytes.slice(k - 1, k + 3), [0x1d, 0x6b, 73, 10]);
  assert.equal(text(bytes.slice(k + 3, k + 13)), "{BORD-1001");
  assert.deepEqual(bytes.slice(-4), [0x1d, 0x56, 66, 3]);
  assert.deepEqual([...Buffer.from(job.toBase64(), "base64")], bytes);
});

test("printer targets accept USB names and LAN IPs, and reject bad LAN addresses", () => {
  assert.ok(printerTargetSchema.safeParse({ connection: "USB", name: "EPSON TM-T88V Receipt", host: "", port: 9100 }).success);
  assert.ok(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "192.168.1.50", port: "9100" }).success);
  assert.ok(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "kitchen-printer.local", port: 9100 }).success);
  assert.equal(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "", port: 9100 }).success, false);
  assert.equal(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "192.168.1.300", port: 9100 }).success, false);
  assert.equal(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "http://192.168.1.5", port: 9100 }).success, false);
  assert.equal(printerTargetSchema.safeParse({ connection: "LAN", name: "", host: "10.0.0.5", port: 70000 }).success, false);
  assert.equal(describePrinter({ connection: "LAN", name: "", host: "10.0.0.5", port: 9100 }), "LAN 10.0.0.5:9100");
  assert.equal(describePrinter({ connection: "USB", name: "", host: "", port: 9100 }), "USB Windows default printer");
});

test("indented detail lines keep their indent when wrapped", () => {
  assert.deepEqual(wrap("   @ 650.00", 42), ["   @ 650.00"]);
  const lines = wrap("  NOTE: no onions and extra sauce please", 20);
  assert.ok(lines.every(line => line.startsWith("  ") && line.length <= 20), JSON.stringify(lines));
});

test("QZ Tray requests are signed with the configured key, and unsigned when none is set", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { qzSign, qzCertificate } = await import("../lib/qz-signing.ts");
  const dir = mkdtempSync(join(tmpdir(), "qz-")), { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const saved = { key: process.env.QZ_PRIVATE_KEY_PATH, cert: process.env.QZ_CERTIFICATE_PATH };
  try {
    delete process.env.QZ_PRIVATE_KEY_PATH; delete process.env.QZ_CERTIFICATE_PATH;
    assert.equal(qzSign("request"), "");
    assert.equal(qzCertificate(), "");
    writeFileSync(join(dir, "key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
    process.env.QZ_PRIVATE_KEY_PATH = join(dir, "key.pem");
    const signature = qzSign("call=print&timestamp=1");
    assert.ok(createVerify("SHA512").update("call=print&timestamp=1").verify(publicKey, signature, "base64"));
  } finally {
    for (const [name, value] of [["QZ_PRIVATE_KEY_PATH", saved.key], ["QZ_CERTIFICATE_PATH", saved.cert]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receipt font and size become the printer's base style", async () => {
  const { renderReceipt } = await import("../lib/receipt-layout.ts");
  assert.deepEqual([columnsFor("80", "COMPACT"), columnsFor("58", "COMPACT")], [56, 40]);
  // Defaults add no bytes, so existing receipts print exactly as before.
  assert.equal(text(new EscPos(42, { font: "STANDARD", size: "NORMAL" }).toBytes()), "\x1b@\x1bt\x10");
  const compact = new EscPos(56, { font: "COMPACT", size: "NORMAL" });
  assert.equal(text(compact.toBytes()), "\x1b@\x1bt\x10\x1bM\x01");
  // Bold stays on after bold(false); a large base keeps size("normal") at double size and halves the columns.
  const large = new EscPos(42, { font: "BOLD", size: "LARGE" });
  assert.equal(large.columns, 21);
  assert.equal(large.columnsAt("large"), 21);
  assert.equal(text(large.reset().bold(false).size("normal").toBytes()), "\x1bE\x01\x1d!\x11\x1bE\x01\x1d!\x11");
  const tall = new EscPos(42, { font: "STANDARD", size: "TALL" });
  assert.deepEqual([tall.columns, tall.columnsAt("large")], [42, 21]);
  assert.equal(text(tall.reset().size("large").size("normal").toBytes()), "\x1d!\x01\x1d!\x11\x1d!\x01");

  const order = { orderNumber: "ORD-1", createdAt: "2026-11-02T08:00:00Z", orderType: "DINE_IN", paymentStatus: "PAID", items: [{ quantity: 1, nameSnapshot: "Naan", unitPrice: 50 }], subtotal: 50, taxAmount: 0, grandTotal: 50, paidAmount: 50, dueAmount: 0 };
  const printed = parts => text(Buffer.from(parts.at(-1).base64, "base64"));
  const kitchen = printed(renderReceipt("kitchen", { name: "Test", kitchenReceiptFont: "COMPACT", kitchenReceiptSize: "NORMAL" }, order));
  assert.match(kitchen, /^\x1b@\x1bt\x10\x1bM\x01/);
  assert.ok(kitchen.includes("-".repeat(56)));
  // Unknown stored values fall back to the standard style, and the 58 mm paper keeps its width.
  const customer = printed(renderReceipt("customer", { name: "Test", receiptPaperWidth: "58", customerReceiptFont: "FANCY" }, order));
  assert.ok(!customer.includes("\x1bM"));
  assert.ok(customer.includes("\n" + "-".repeat(30) + "\n"));
});

test("the receipt decoder replays lines, styles, barcodes and the cut", async () => {
  const { decodeEscPos, nativeCommand } = await import("../lib/receipt-raster.ts");
  const job = new EscPos(56, { font: "COMPACT", size: "NORMAL" }).align("center").bold(true).size("tall").text("SHOP").size("normal").bold(false).align("left").row("Total", "50.00").barcode("ORD-1").cut();
  const rows = decodeEscPos(job.toBase64());
  assert.deepEqual(rows[0], { kind: "text", text: "SHOP", style: { align: 1, bold: true, size: 1, font: 1 } });
  assert.equal(rows[1].text, "Total" + " ".repeat(46) + "50.00");
  assert.deepEqual(rows[1].style, { align: 0, bold: false, size: 0, font: 1 });
  assert.deepEqual(rows.slice(2), [{ kind: "barcode", value: "ORD-1", align: 0 }, { kind: "cut" }]);
  // Native blocks re-emit the same barcode and cut commands without re-initialising the printer.
  const barcode = text(Buffer.from(nativeCommand({ kind: "barcode", value: "ORD-1", align: 1 }), "base64"));
  assert.ok(barcode.startsWith("\x1ba\x01") && barcode.includes("\x1dk\x49\x07{BORD-1"));
  assert.equal(text(Buffer.from(nativeCommand({ kind: "cut" }), "base64")), "\x1dVB\x03");
});

test("kitchen tickets print deal items as the item name then its quantity", async () => {
  const { renderReceipt } = await import("../lib/receipt-layout.ts");
  const { decodeEscPos } = await import("../lib/receipt-raster.ts");
  const order = { orderNumber: "ORD-1", createdAt: "2026-11-02T08:00:00Z", orderType: "DINE_IN", paymentStatus: "PAID", items: [{ quantity: 1, nameSnapshot: "Family Deal", unitPrice: 2499, dealItemsSnapshot: [{ name: "Zinger Burger", quantity: 2 }] }], subtotal: 2499, taxAmount: 0, grandTotal: 2499, paidAmount: 2499, dueAmount: 0 };
  const lines = renderReceipt("kitchen", { name: "Test" }, order).flatMap(part => decodeEscPos(part.base64)).map(row => row.text);
  assert.ok(lines.includes("   > Zinger Burger - Qty 2"), JSON.stringify(lines));
  assert.ok(!lines.some(line => /\dx /.test(line ?? "")), JSON.stringify(lines));
});

test("kitchen tickets start with the restaurant name", async () => {
  const { renderReceipt } = await import("../lib/receipt-layout.ts");
  const { decodeEscPos } = await import("../lib/receipt-raster.ts");
  const order = { orderNumber: "ORD-1", createdAt: "2026-11-02T08:00:00Z", orderType: "DINE_IN", paymentStatus: "PAID", items: [], subtotal: 0, taxAmount: 0, grandTotal: 0, paidAmount: 0, dueAmount: 0 };
  const lines = renderReceipt("kitchen", { name: "Karachi Grill" }, order).flatMap(part => decodeEscPos(part.base64)).map(row => row.text);
  assert.deepEqual(lines.slice(0, 3).map(line => line.trim()), ["Karachi Grill", "KITCHEN ORDER", "ORD-1"]);
});
