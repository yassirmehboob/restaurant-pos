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
