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

test("80 mm receipts print # | Price | Qty | Amount with the item name across the full row below", () => {
  const rows = receiptItemRows(items, 42, money).map(row => row.text);
  assert.ok(rows.every(row => row.length <= 42), JSON.stringify(rows));
  assert.equal(rows[0].length, 42);
  assert.deepEqual(rows, [
    "#                    Price  Qty     Amount",
    "Item",
    "1                 2,400.00    2   4,800.00",
    "Mutton Karahi (500 g)",
    "2                    50.00   10     500.00",
    "Naan",
    "   Note: Extra crispy",
    "3                15,648.00    1  15,648.00",
    "Mutton Karahi (3.26 KG)",
    "4             125,000.00   12 1,500,000.00",
    "Family Deal",
  ]);
  assert.equal(receiptItemRows(items, 42, money)[0].bold, true);
  assert.equal(receiptItemRows(items, 42, money)[1].bold, true);
});

test("a long item name uses the whole paper width before it wraps", () => {
  const name = "Special Chicken Karahi With Extra Butter Sauce";
  const rows = receiptItemRows([{ name, unitPrice: 100, quantity: 1 }], 42, money).map(row => row.text);
  assert.deepEqual(rows.slice(3), ["Special Chicken Karahi With Extra Butter", "Sauce"]);
});

test("58 mm receipts use the same layout, under the same column headings", () => {
  const rows = receiptItemRows(items.slice(0, 1), 30, money).map(row => row.text);
  assert.ok(rows.every(row => row.length <= 30), JSON.stringify(rows));
  assert.deepEqual(rows, [
    "#        Price  Qty     Amount",
    "Item",
    "1     2,400.00    2   4,800.00",
    "Mutton Karahi (500 g)",
  ]);
});

test("figures too wide for the paper close up and wrap instead of being cut off", () => {
  // Large print on 80 mm paper leaves 21 columns, fewer than the spaced figures need.
  const rows = receiptItemRows(items.slice(0, 1), 21, money).map(row => row.text);
  assert.deepEqual(rows, ["# Price Qty Amount", "Item", "1 2,400.00 2 4,800.00", "Mutton Karahi (500 g)"]);
  const huge = receiptItemRows([items[3]], 15, money).map(row => row.text);
  assert.ok(huge.every(row => row.length <= 15), JSON.stringify(huge));
  for (const figure of ["125,000.00", "12", "1,500,000.00"]) assert.ok(huge.some(row => row.includes(figure)), figure);
});

test("received rows name the payment method and list split payments per method", () => {
  assert.deepEqual(receivedRows([{ method: "CASH", amount: 4800, tenderedAmount: 5000 }]), [{ label: "Received - Cash", amount: 5000 }]);
  assert.deepEqual(receivedRows([{ method: "CARD", amount: 1000 }, { method: "CASH", amount: 300, tenderedAmount: 500 }, { method: "CARD", amount: 200 }, { method: "BANK", amount: 50 }]), [
    { label: "Received - Card", amount: 1200 },
    { label: "Received - Cash", amount: 500 },
    { label: "Received - Bank", amount: 50 },
  ]);
});

test("kitchen tickets use the same table, with only Qty when prices are hidden", () => {
  const kitchen = [{ name: "Family Deal", unitPrice: 2499, quantity: 1, components: ["Zinger Burger - Qty 2", "Fries - Qty 1"], notes: "No ice" }, { name: "Garlic Naan", unitPrice: 60, quantity: 4 }];
  const rows = receiptItemRows(kitchen, 42, money, { prices: false });
  assert.deepEqual(rows.map(row => row.text), [
    "#  Item                                Qty",
    "1  Family Deal                           1",
    "   > Zinger Burger - Qty 2",
    "   > Fries - Qty 1",
    "   Note: No ice",
    "2  Garlic Naan                           4",
  ]);
  assert.deepEqual(rows.map(row => row.kind), ["head", "item", "detail", "detail", "note", "item"]);
  assert.ok(receiptItemRows(kitchen, 30, money, { prices: false }).every(row => row.text.length <= 30));
  // With prices on, the kitchen table matches the customer receipt line for line.
  assert.equal(receiptItemRows(kitchen, 42, money)[1].text, receiptItemRows([{ name: "Family Deal", unitPrice: 2499, quantity: 1 }], 42, money)[1].text);
});
