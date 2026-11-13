import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Category } from "../models/Category.ts";

const jar = new Map();
globalThis.__categoryOrderCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__categoryOrderCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("categories can be reordered and new ones go to the end", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_category_order_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { createCategory, updateCategory, reorderCategories, toggleActive } = await import("../app/(dashboard)/master-actions.ts");
    await User.init();
    const business = await Business.create({ name: "Category order test", saleTaxRate: 0 });
    const other = await Business.create({ name: "Other business", saleTaxRate: 0 });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "catorder.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });

    const form = name => { const data = new FormData(); data.set("name", name); return data; };
    for (const name of ["Burgers", "Pizza", "Drinks"]) assert.equal((await createCategory(undefined, form(name))).ok, true);
    const ordered = async () => (await Category.find({ businessId: business._id, isActive: true }).sort({ sortOrder: 1 }).lean()).map(row => row.name);
    assert.deepEqual(await ordered(), ["Burgers", "Pizza", "Drinks"]);

    const id = async name => String((await Category.findOne({ businessId: business._id, name }))._id);
    const [burgers, pizza, drinks] = [await id("Burgers"), await id("Pizza"), await id("Drinks")];
    assert.equal((await reorderCategories([drinks, burgers, pizza])).ok, true);
    assert.deepEqual(await ordered(), ["Drinks", "Burgers", "Pizza"]);

    // Renaming keeps the dragged position.
    assert.equal((await updateCategory(pizza, undefined, form("Pizzas"))).ok, true);
    assert.deepEqual(await ordered(), ["Drinks", "Burgers", "Pizzas"]);

    // A stale or foreign list is refused and changes nothing.
    const foreign = await Category.create({ businessId: other._id, name: "Foreign", sortOrder: 0 });
    assert.equal((await reorderCategories([burgers, pizza])).ok, undefined);
    assert.equal((await reorderCategories([burgers, pizza, String(foreign._id)])).ok, undefined);
    assert.equal((await reorderCategories([burgers, burgers, pizza])).ok, undefined);
    assert.deepEqual(await ordered(), ["Drinks", "Burgers", "Pizzas"]);
    assert.equal((await Category.findById(foreign._id)).sortOrder, 0);

    // Inactive categories are left out of the drag list.
    await toggleActive("Category", drinks);
    assert.equal((await reorderCategories([pizza, burgers])).ok, true);
    assert.deepEqual(await ordered(), ["Pizzas", "Burgers"]);

    assert.equal((await createCategory(undefined, form("Desserts"))).ok, true);
    assert.deepEqual(await ordered(), ["Pizzas", "Burgers", "Desserts"]);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
