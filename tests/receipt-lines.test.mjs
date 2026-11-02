import assert from "node:assert/strict";
import test from "node:test";
import { receiptItemRows, receivedRows } from "../lib/receipt-lines.ts";

const money = value => value.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const items = [
  { name: "Mutton Karahi (500 g)", unitPrice: 2400, quantity: 2 },
  { name: "Naan", unitPrice: 50, quantity: 10, notes: "Extra crispy" },
  { name: "Mutton Karahi (3.26 KG)", unitPrice: 15648, quantity: 1 },
  { name: "Family Deal", unitPrice: 125000, quantity: 12 },
];

test("80 mm receipts print # | Item | Price | Qty | Amount in aligned columns", () => {
  const rows = receiptItemRows(items, 42, money).map(row => row.text);
  assert.ok(rows.every(row => row.length <= 42), JSON.stringify(rows));
  assert.equal(rows[1].length, 42);
  assert.ok(rows.every(row => !/dd{3},/.test(row.replace(/d{1,3}(,d{3})*.dd/g, "#"))), "figures must not run together");
  assert.deepEqual(rows, [
    "#  Item              Price  Qty     Amount",
    "1  Mutton Karahi  2,400.00    2   4,800.00",
    "   (500 g)",
    "2  Naan              50.00   10     500.00",
    "   Note: Extra crispy",
    "3  Mutton Karahi 15,648.00    1  15,648.00",
    "   (3.26 KG)",
    // Too wide for the table: the figures drop to their own line, still spaced and uncut.
    "4  Family Deal",
    "              125,000.00   12 1,500,000.00",
  ]);
  assert.equal(receiptItemRows(items, 42, money)[0].bold, true);
});

test("58 mm receipts put the item on its own line and the figures under the column headings", () => {
  const rows = receiptItemRows(items.slice(0, 1), 30, money).map(row => row.text);
  assert.ok(rows.every(row => row.length <= 30), JSON.stringify(rows));
  assert.deepEqual(rows, [
    "#  Item",
    "         Price  Qty     Amount",
    "1  Mutton Karahi (500 g)",
    "      2,400.00    2   4,800.00",
  ]);
});

test("received rows name the payment method and list split payments per method", () => {
  assert.deepEqual(receivedRows([{ method: "CASH", amount: 4800, tenderedAmount: 5000 }]), [{ label: "Received - Cash", amount: 5000 }]);
  assert.deepEqual(receivedRows([{ method: "CARD", amount: 1000 }, { method: "CASH", amount: 300, tenderedAmount: 500 }, { method: "CARD", amount: 200 }, { method: "BANK", amount: 50 }]), [
    { label: "Received - Card", amount: 1200 },
    { label: "Received - Cash", amount: 500 },
    { label: "Received - Bank", amount: 50 },
  ]);
});
