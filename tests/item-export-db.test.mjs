import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";

const jar = new Map();
globalThis.__itemExportCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__itemExportCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("items export: permissions, tenant isolation and spreadsheet contents", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_item_export_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { GET } = await import("../app/api/products/items.xlsx/route.ts");
    const { createProduct, updateProduct } = await import("../app/(dashboard)/master-actions.ts");
    const a = await Business.create({ name: "Restaurant A", saleTaxRate: 0 }), b = await Business.create({ name: "Restaurant B", saleTaxRate: 0 });
    const account = (business, username, role) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash: "x".repeat(60) });
    const owner = await account(a, "owner.a", "OWNER"), cashier = await account(a, "cashier.a", "CASHIER");
    const signIn = async user => { jar.clear(); const current = await User.findById(user._id); await createSession({ userId: String(current._id), businessId: String(current.businessId), role: current.role, authVersion: current.authVersion ?? 0 }); };
    const drinks = await Category.create({ businessId: a._id, name: "Drinks", sortOrder: 2 }), mains = await Category.create({ businessId: a._id, name: "Mains", sortOrder: 1 }), foreign = await Category.create({ businessId: b._id, name: "Foreign" });
    await Product.create({ businessId: b._id, categoryId: foreign._id, name: "Foreign item", salePrice: 1, costPrice: 1 });

    await t.test("anonymous and staff without the catalog privilege are refused", async () => {
      jar.clear();
      assert.equal((await GET()).status, 401);
      await signIn(cashier);
      assert.equal((await GET()).status, 403);
    });

    await t.test("items saved through the real actions export with sizes, weight and status", async () => {
      await signIn(owner);
      const form = (values, variants = []) => {
        const data = new FormData();
        for (const [key, value] of Object.entries({ description: "", costPrice: "77777", taxRate: "0", preparationTimeMinutes: "", sellBy: "UNIT", ...values })) data.set(key, value);
        for (const [name, salePrice] of variants) { data.append("variantName", name); data.append("variantSalePrice", salePrice); data.append("variantCostPrice", "77777"); }
        return data;
      };
      const create = async (name, ...args) => { await createProduct(undefined, form(...args)); assert.ok(await Product.exists({ businessId: a._id, name }), `${name} was not saved`); };
      await create("Tea", { categoryId: String(drinks._id), name: "Tea", salePrice: "80" });
      await create("Pizza", { categoryId: String(mains._id), name: "Pizza", salePrice: "500" }, [["Small", "500"], ["Large", "1200"]]);
      await create("Karahi", { categoryId: String(mains._id), name: "Karahi", salePrice: "2400", sellBy: "WEIGHT" });
      await create("=1+1", { categoryId: String(drinks._id), name: "=1+1", salePrice: "10" });
      await Product.updateOne({ businessId: a._id, name: "Tea" }, { $set: { isAvailable: false } });

      const read = async () => {
        const response = await GET();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        assert.match(response.headers.get("Content-Disposition"), /items\.xlsx/);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
        const rows = [];
        workbook.getWorksheet("Items").eachRow(row => rows.push(Array.from({ length: 7 }, (_, index) => row.getCell(index + 1).value ?? "")));
        return rows;
      };
      const rows = await read();
      assert.deepEqual(rows[0], ["Category", "Item Name", "Sold By", "Sale Price", "Size Name", "Size Sale Price", "Status"]);
      const body = rows.slice(1), find = (name, size = "") => body.find(row => row[1] === name && row[4] === size);
      assert.deepEqual(find("Pizza", "Small"), ["Mains", "Pizza", "Piece / Plate", 500, "Small", 500, "Available"]);
      assert.deepEqual(find("Pizza", "Large"), ["Mains", "Pizza", "Piece / Plate", 500, "Large", 1200, "Available"]);
      assert.deepEqual(find("Karahi"), ["Mains", "Karahi", "Weight (per KG)", 2400, "", "", "Available"]);
      assert.deepEqual(find("Tea"), ["Drinks", "Tea", "Piece / Plate", 80, "", "", "Unavailable"]);
      assert.equal(body.length, 5);
      // Sorted by category name then item name, ignoring creation order and category sortOrder. Sizes keep their saved order.
      assert.deepEqual(body.map(row => [row[0], row[1], row[4]]), [["Drinks", "=1+1", ""], ["Drinks", "Tea", ""], ["Mains", "Karahi", ""], ["Mains", "Pizza", "Small"], ["Mains", "Pizza", "Large"]]);
      assert.ok(!body.some(row => row[1] === "Foreign item"));
      assert.ok(!JSON.stringify(rows).includes("77777"), "cost prices must not be exported");
      // A name starting with = stays text rather than becoming a live formula.
      assert.equal(find("=1+1")[1], "=1+1");

      // Reopen and edit: the export reflects the changed price and the removed size.
      const pizza = await Product.findOne({ businessId: a._id, name: "Pizza" });
      await updateProduct(String(pizza._id), undefined, form({ categoryId: String(mains._id), name: "Pizza", salePrice: "550" }, [["Large", "1300"]]));
      const edited = (await read()).filter(row => row[1] === "Pizza");
      assert.deepEqual(edited, [["Mains", "Pizza", "Piece / Plate", 550, "Large", 1300, "Available"]]);
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
