import assert from "node:assert/strict";
import test from "node:test";
import { kitchenTickets, UNCATEGORISED } from "../lib/kitchen-tickets.ts";
import { renderReceipt } from "../lib/receipt-layout.ts";
import { decodeEscPos } from "../lib/receipt-raster.ts";

const order = items => ({ orderNumber: "ORD-77", createdAt: "2026-11-07T08:00:00Z", orderType: "DINE_IN", tableNameSnapshot: "Table 4", waiterNameSnapshot: "Ahmed", paymentStatus: "UNPAID", notes: "Less spicy", items, subtotal: 0, taxAmount: 0, grandTotal: 0, paidAmount: 0, dueAmount: 0 });
const rows = (business, value) => renderReceipt("kitchen", { name: "Grill", ...business }, value).flatMap(part => decodeEscPos(part.base64));
const tickets = list => { const out = [[]]; for (const row of list) { if (row.kind === "cut") out.push([]); else out.at(-1).push(row); } return out.filter(ticket => ticket.length); };

test("items group by category in menu order, deals split by their items' categories", () => {
  const groups = kitchenTickets([
    { nameSnapshot: "Naan", categoryName: "Tandoor", categorySort: 2 },
    { nameSnapshot: "Karahi", categoryName: "Karahi", categorySort: 1 },
    { nameSnapshot: "Old item" },
    { nameSnapshot: "Family Deal", dealItemsSnapshot: [{ name: "Zinger", quantity: 2, categoryName: "Fast Food", categorySort: 3 }, { name: "Drink", quantity: 1, categoryName: "Drinks", categorySort: 4 }, { name: "Fries", quantity: 1, categoryName: "Fast Food", categorySort: 3 }] },
    { nameSnapshot: "Roti", categoryName: "Tandoor", categorySort: 2 },
  ]);
  assert.deepEqual(groups.map(group => group.category), ["Karahi", "Tandoor", "Fast Food", "Drinks", UNCATEGORISED]);
  assert.deepEqual(groups[1].items.map(item => item.nameSnapshot), ["Naan", "Roti"]);
  assert.deepEqual(groups[2].items[0].dealItemsSnapshot.map(item => item.name), ["Zinger", "Fries"]);
  assert.deepEqual(groups[3].items[0].dealItemsSnapshot.map(item => item.name), ["Drink"]);
});

test("per-category mode prints one cut ticket per category with highlighted order number and category", () => {
  const printed = tickets(rows({ kitchenTicketPerCategory: true }, order([
    { quantity: 1, nameSnapshot: "Chicken Karahi", unitPrice: 1000, categoryName: "Karahi" },
    { quantity: 3, nameSnapshot: "Garlic Naan", unitPrice: 60, categoryName: "Tandoor", notes: "Extra butter" },
  ])));
  assert.equal(printed.length, 2);
  for (const [index, ticket] of printed.entries()) {
    const text = ticket.map(row => row.text?.trim());
    const inverted = ticket.filter(row => row.style?.invert).map(row => row.text.trim());
    assert.deepEqual(inverted, ["ORD-77", ["KARAHI", "TANDOOR"][index]]);
    assert.ok(text.includes(`Ticket ${index + 1} of 2`), JSON.stringify(text));
    // Table and waiter print tall and bold; the order note goes to every counter.
    const table = ticket.find(row => row.text?.startsWith("Table"));
    assert.ok(table.style.bold && table.style.size === 0x01 && table.text.trimEnd().endsWith("Table 4"));
    assert.ok(ticket.find(row => row.text?.startsWith("Waiter"))?.text.trimEnd().endsWith("Ahmed"));
    assert.ok(text.includes("Less spicy"));
  }
  assert.ok(printed[0].some(row => row.text?.includes("Chicken Karahi")) && !printed[0].some(row => row.text?.includes("Garlic Naan")));
  assert.ok(printed[1].some(row => row.text?.includes("Garlic Naan")) && !printed[1].some(row => row.text?.includes("Chicken Karahi")));
  // The band spans the full paper width so the black bar reads as a highlight on the raw printer font too.
  assert.equal(printed[0].find(row => row.style?.invert).text.length, 21);
});

test("without the setting the kitchen gets one ticket and no category band", () => {
  const printed = tickets(rows({}, order([{ quantity: 1, nameSnapshot: "Karahi", unitPrice: 1, categoryName: "Karahi" }, { quantity: 1, nameSnapshot: "Naan", unitPrice: 1, categoryName: "Tandoor" }])));
  assert.equal(printed.length, 1);
  assert.deepEqual(printed[0].filter(row => row.style?.invert).map(row => row.text.trim()), ["ORD-77"]);
  // An order with no items still prints a ticket in per-category mode.
  assert.equal(tickets(rows({ kitchenTicketPerCategory: true }, order([]))).length, 1);
});
