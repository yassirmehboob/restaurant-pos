import assert from "node:assert/strict";
import test from "node:test";
import { rankProducts,roleOf,suggestDeals } from "../lib/deal-suggestions.ts";

let order = 0;
const item = (id, category, sold, extra = {}) => ({ id, name: extra.name ?? id, category, price: extra.price ?? 500, cost: extra.cost ?? 250, byWeight: extra.byWeight ?? false, sizes: extra.sizes ?? [], sold, menuOrder: order++ });
const pepsi = [{ name: "Tin", price: 120, cost: 80 }, { name: "100ml", price: 50, cost: 30 }, { name: "1 ltr", price: 200, cost: 140 }, { name: "1.5 ltr", price: 260, cost: 180 }, { name: "2.5 ltr", price: 380, cost: 260 }];
const pizzaSizes = [{ name: "Small", price: 600, cost: 400 }, { name: "Medium", price: 800, cost: 700 }, { name: "Large", price: 1200, cost: 1000 }];
const menu = [
  item("Zinger Burger", "Burgers", 54),
  item("Beef Burger", "Burgers", 20),
  item("Chicken Burger", "Burgers", 30),
  item("BBQ Pizza", "Pizza", 40, { sizes: pizzaSizes }),
  item("Mutton Karahi", "Desi Mix", 12, { byWeight: true, price: 4800, cost: 3500 }),
  item("Naan", "Tandoor", 80, { price: 40, cost: 15 }),
  item("French Fries", "Fries & Sides", 35, { price: 250, cost: 100 }),
  item("Pepsi", "Drinks", 90, { sizes: pepsi }),
  item("Halwa Puri", "Breakfast", 15, { price: 350, cost: 200 }),
  item("Aloo Paratha", "Breakfast", 25, { price: 150, cost: 60 }),
  item("Omelette", "Breakfast", 18, { price: 200, cost: 90 }),
  item("Plain Paratha", "Breakfast", 40, { price: 60, cost: 20 }),
  item("Doodh Patti Chai", "Drinks", 60, { price: 80, cost: 30 }),
];

test("items are ranked from highest to lowest selling", () => {
  assert.deepEqual(rankProducts(menu).slice(0, 4).map(product => product.id), ["Pepsi", "Naan", "Doodh Patti Chai", "Zinger Burger"]);
});

test("categories decide each item's role", () => {
  const role = id => roleOf(menu.find(product => product.id === id));
  assert.deepEqual(["Zinger Burger", "Naan", "French Fries", "Pepsi", "Mutton Karahi"].map(role), ["MAIN", "BREAD", "SIDE", "DRINK", "MAIN"]);
});

test("a deal for 2 starts from the best seller with the top side and a tin each", () => {
  const { regular } = suggestDeals(menu, 2);
  const [first] = regular;
  assert.equal(first.name, "Zinger Burger Duo Deal");
  assert.deepEqual(first.items.map(entry => [entry.name, entry.quantity]), [["Zinger Burger", 2], ["French Fries", 1], ["Pepsi (Tin)", 2]]);
  assert.match(first.reason, /#1 best seller \(54 sold in the last 90 days\)/);
  // 1000 + 250 + 240 = 1490 sale, 500 + 100 + 160 = 760 cost: 760 + 0.75 x 730 = 1307.5 -> 1310.
  assert.deepEqual([first.total, first.cost, first.price], [1490, 760, 1310]);
});

test("ideas follow the sales order with at most two per category first", () => {
  assert.deepEqual(suggestDeals(menu, 2).regular.map(deal => deal.items[0].productId), ["Zinger Burger", "BBQ Pizza", "Chicken Burger", "Mutton Karahi", "Beef Burger"]);
});

test("sizes, weights and bottles scale with the number of persons", () => {
  const four = suggestDeals(menu, 4).regular;
  const pizza = four.find(deal => deal.items[0].productId === "BBQ Pizza");
  // Four people: the pizza feeds two with burgers for the other two (Zinger is already paired with this pizza), and one 1.5 litre bottle.
  assert.deepEqual(pizza.items.map(entry => [entry.name, entry.quantity]), [["BBQ Pizza (Medium)", 1], ["Chicken Burger", 2], ["French Fries", 2], ["Pepsi (1.5 ltr)", 1]]);
  const karahi = four.find(deal => deal.items[0].productId === "Mutton Karahi");
  assert.deepEqual(karahi.items.map(entry => [entry.name, entry.quantity, entry.weightGrams]), [["Mutton Karahi (1 KG)", 1, 1000], ["Naan", 4, undefined], ["Pepsi (1.5 ltr)", 1, undefined]]);
  assert.equal(karahi.name, "Mutton Karahi Family Deal");
  const ten = suggestDeals(menu, 10).regular[0];
  assert.deepEqual(ten.items.at(-1).name, "Pepsi (2.5 ltr)");
  assert.equal(ten.items.at(-1).quantity, 2);
});

test("breakfast stays separate from lunch and dinner deals", () => {
  const { regular, breakfast, hasBreakfast } = suggestDeals(menu, 2);
  const breakfastIds = new Set(["Halwa Puri", "Aloo Paratha", "Omelette", "Plain Paratha"]);
  assert.ok(regular.every(deal => deal.items.every(entry => !breakfastIds.has(entry.productId))));
  assert.equal(hasBreakfast, true);
  // Plain paratha is the bread; dishes that already have bread get none. The chai comes from the drinks menu because breakfast has no drink.
  assert.deepEqual(breakfast.map(deal => deal.items.map(entry => [entry.name, entry.quantity])), [
    [["Aloo Paratha", 2], ["Doodh Patti Chai", 2]],
    [["Omelette", 2], ["Plain Paratha", 2], ["Doodh Patti Chai", 2]],
    [["Halwa Puri", 2], ["Doodh Patti Chai", 2]],
  ]);
  assert.match(breakfast[0].reason, /#2 breakfast best seller/);
  assert.ok(breakfast.every(deal => deal.items.every(entry => breakfastIds.has(entry.productId) || entry.productId === "Doodh Patti Chai")));
});

test("an existing deal with the same items is pointed out", () => {
  const { regular } = suggestDeals(menu, 2, { existing: [{ name: "Zinger Meal", productIds: ["Pepsi", "Zinger Burger", "French Fries"] }] });
  assert.equal(regular[0].similarTo, "Zinger Meal");
  assert.equal(regular[1].similarTo, undefined);
});

test("with no sales the menu order is used and said so", () => {
  const fresh = menu.map(product => ({ ...product, sold: 0 }));
  const { regular, anySales } = suggestDeals(fresh, 1);
  assert.equal(anySales, false);
  assert.equal(regular[0].items[0].productId, "Zinger Burger");
  assert.match(regular[0].reason, /No sales yet/);
  assert.equal(regular[0].name, "Zinger Burger Solo Deal");
});
