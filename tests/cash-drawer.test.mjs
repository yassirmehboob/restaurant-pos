import assert from "node:assert/strict";
import test from "node:test";
import { cashDrawerFor, drawerKickBase64 } from "../lib/cash-drawer.ts";

const bytes = base64 => [...Buffer.from(base64, "base64")];
const qz = { printerMode: "QZ", customerPrinterConnection: "USB", customerPrinterName: "EPSON TM-T88V Receipt" };

test("the drawer kick is ESC p for pin 2 or pin 5", () => {
  assert.deepEqual(bytes(drawerKickBase64("PIN2")), [0x1b, 0x70, 0, 25, 250]);
  assert.deepEqual(bytes(drawerKickBase64("PIN5")), [0x1b, 0x70, 1, 25, 250]);
});

test("the drawer opens only when set, and only for cash unless every payment is chosen", () => {
  assert.equal(cashDrawerFor({ ...qz }, "CASH"), null, "off by default");
  assert.equal(cashDrawerFor({ ...qz, cashDrawerOpenOn: "NEVER" }, "CASH"), null);
  assert.deepEqual(cashDrawerFor({ ...qz, cashDrawerOpenOn: "CASH" }, "CASH"), { printer: { connection: "USB", name: "EPSON TM-T88V Receipt", host: "", port: 9100 }, pin: "PIN2" });
  assert.equal(cashDrawerFor({ ...qz, cashDrawerOpenOn: "CASH" }, "CARD"), null);
  assert.equal(cashDrawerFor({ ...qz, cashDrawerOpenOn: "ALL", cashDrawerPin: "PIN5" }, "BANK").pin, "PIN5");
});

test("the drawer goes to a LAN receipt printer too, and never in browser printing", () => {
  assert.deepEqual(cashDrawerFor({ printerMode: "QZ", customerPrinterConnection: "LAN", customerPrinterHost: "192.168.1.50", customerPrinterPort: 9100, cashDrawerOpenOn: "ALL" }, "CASH").printer, { connection: "LAN", name: "", host: "192.168.1.50", port: 9100 });
  assert.equal(cashDrawerFor({ ...qz, printerMode: "BROWSER", cashDrawerOpenOn: "ALL" }, "CASH"), null, "the print dialog cannot open a drawer");
  assert.equal(cashDrawerFor(null, "CASH"), null);
});
