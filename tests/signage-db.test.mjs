import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Category } from "../models/Category.ts";
import { Product } from "../models/Product.ts";
import { Deal } from "../models/Deal.ts";
import { SignageScreen } from "../models/SignageScreen.ts";
import { SignagePairing } from "../models/SignagePairing.ts";

const jar = new Map();
globalThis.__signageTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__signageTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

const mp4 = size => { const bytes = Buffer.alloc(size, 7); Buffer.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom")]).copy(bytes); return bytes; };
const upload = (POST, bytes, type = "video/mp4", title = "Azadi advert") => POST(new Request("http://localhost/api/signage/videos", { method: "POST", body: bytes, headers: { "content-type": type, "content-length": String(bytes.length), "x-video-title": encodeURIComponent(title), "x-video-duration": "15" } }));

test("display screens: pairing, live feed, videos, revocation and isolation", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_signage_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const actions = await import("../app/(dashboard)/settings/signage/actions.ts");
    const pair = await import("../app/api/display/pair/route.ts");
    const { GET: feedGET } = await import("../app/api/display/[token]/feed/route.ts");
    const { GET: mediaGET } = await import("../app/api/display/[token]/media/[kind]/[id]/route.ts");
    const { POST: uploadPOST } = await import("../app/api/signage/videos/route.ts");
    await Promise.all([User.init(), SignageScreen.init(), SignagePairing.init()]);

    const a = await Business.create({ name: "Indus Test" }), b = await Business.create({ name: "Other Test" });
    const passwordHash = await bcrypt.hash("SignageTest123", 10);
    const account = (business, username, role) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash });
    const owner = await account(a, "owner.signage", "OWNER"), cashier = await account(a, "cashier.signage", "CASHIER"), otherOwner = await account(b, "owner.signage.b", "OWNER");
    const signIn = async user => { jar.clear(); const current = await User.findById(user._id); await createSession({ userId: String(current._id), businessId: String(current.businessId), role: current.role, authVersion: current.authVersion ?? 0 }); };
    const mains = await Category.create({ businessId: a._id, name: "Mains" }), drinks = await Category.create({ businessId: a._id, name: "Drinks" });
    const karahi = await Product.create({ businessId: a._id, categoryId: mains._id, name: "Karahi", salePrice: 1800, costPrice: 900, imageUrl: "/api/images/aaaaaaaaaaaaaaaaaaaaaaaa", variants: [{ name: "Half", salePrice: 1000, costPrice: 500 }, { name: "Full", salePrice: 1800, costPrice: 900 }] });
    await Product.create({ businessId: a._id, categoryId: drinks._id, name: "Mint lemonade", salePrice: 350, costPrice: 100 });
    await Product.create({ businessId: a._id, categoryId: drinks._id, name: "Sold-out shake", salePrice: 500, costPrice: 100, isAvailable: false });
    await Deal.create({ businessId: a._id, name: "Family deal", salePrice: 4500, items: [{ productId: karahi._id, quantity: 2 }] });
    const feedOf = token => feedGET(new Request("http://localhost"), { params: Promise.resolve({ token }) });
    const requestCode = async () => (await pair.POST(new Request("http://localhost/api/display/pair", { method: "POST", headers: { "x-forwarded-for": "10.0.0.5" } }))).json();
    const poll = async device => pair.GET(new Request(`http://localhost/api/display/pair?id=${device.id}&secret=${encodeURIComponent(device.secret)}`));
    let screenId, token, videoId;

    await t.test("only the owner manages screens", async () => {
      await signIn(cashier);
      assert.equal((await actions.createScreen("Counter", "LANDSCAPE")).ok, false);
      assert.equal((await upload(uploadPOST, mp4(64))).status, 403);
      await signIn(owner);
      const created = await actions.createScreen("Counter", "LANDSCAPE");
      assert.equal(created.ok, true, created.message);
      screenId = created.id;
      assert.deepEqual((await SignageScreen.findById(screenId).lean()).slides.map(slide => slide.type), ["BRAND", "MENU", "DEALS"]);
    });

    await t.test("a TV pairs with a 6-digit code and collects its key exactly once", async () => {
      const device = await requestCode();
      assert.match(device.code, /^\d{6}$/);
      assert.equal((await (await poll(device)).json()).status, "PENDING");
      assert.equal((await poll({ ...device, secret: "x".repeat(43) })).status, 404, "another device cannot collect the key");
      await signIn(owner);
      assert.match((await actions.pairScreen(screenId, "000000")).message, /not found or has expired/);
      assert.equal((await actions.pairScreen(screenId, device.code.slice(0, 3) + " " + device.code.slice(3))).ok, true);
      const collected = await (await poll(device)).json();
      assert.equal(collected.status, "PAIRED"); assert.match(collected.token, /^[\w-]{43}$/);
      token = collected.token;
      assert.equal((await poll(device)).status, 404, "the key is handed over only once");
      const stored = await SignageScreen.findById(screenId).lean();
      assert.notEqual(stored.tokenHash, token, "only a hash of the key is stored");
    });

    await t.test("the feed shows live menu and deals, without unavailable items, with display-scoped image links", async () => {
      const response = await feedOf(token);
      assert.equal(response.status, 200);
      const feed = await response.json();
      assert.equal(feed.business.name, "Indus Test");
      assert.deepEqual(feed.slides.map(slide => slide.type), ["BRAND", "MENU", "DEALS"]);
      const menu = feed.slides[1];
      assert.deepEqual(menu.groups.map(group => group.title), ["Drinks", "Mains"], "one page group per category, in menu order");
      const names = menu.groups.flatMap(group => group.items.map(item => item.name));
      assert.ok(names.includes("Karahi") && names.includes("Mint lemonade") && !names.includes("Sold-out shake"));
      const karahiItem = menu.groups.flatMap(group => group.items).find(item => item.name === "Karahi");
      assert.deepEqual(karahiItem.prices, [{ name: "Half", price: 1000 }, { name: "Full", price: 1800 }]);
      assert.equal(karahiItem.image, `/api/display/${token}/media/image/aaaaaaaaaaaaaaaaaaaaaaaa`);
      assert.deepEqual(feed.slides[2].deals[0].items, [{ name: "Karahi", quantity: 2 }]);
      assert.equal((await SignageScreen.findById(screenId).lean()).lastSeenAt instanceof Date, true, "the owner can see the TV is online");
      await Product.updateOne({ _id: karahi._id }, { $set: { salePrice: 1900 } });
      const updated = await (await feedOf(token)).json();
      assert.notEqual(updated.version, feed.version, "price changes reach the TV");
    });

    await t.test("videos stream in, are checked, play with byte ranges and leave screens when deleted", async () => {
      await signIn(owner);
      const fake = Buffer.from("<html>not a video</html>".padEnd(64, " "));
      assert.equal((await upload(uploadPOST, fake)).status, 415);
      assert.equal((await upload(uploadPOST, mp4(64), "video/webm")).status, 415, "contents must match the declared type");
      assert.equal((await uploadPOST(new Request("http://localhost", { method: "POST", body: mp4(64), headers: { "content-type": "video/mp4", "content-length": String(101 * 1024 * 1024) } }))).status, 413);
      const uploaded = await (await upload(uploadPOST, mp4(300_000))).json();
      assert.equal(uploaded.ok, true, uploaded.message);
      videoId = uploaded.id;
      const data = await actions.loadSignage();
      assert.equal(data.videos[0].title, "Azadi advert"); assert.equal(data.videos[0].bytes, 300_000); assert.equal(data.videos[0].durationSeconds, 15);
      const screen = data.screens[0];
      const slides = [...screen.slides, { id: "video1", type: "VIDEO", durationSeconds: 30, title: "", message: "", categoryId: "", productIds: [], dealIds: [], productId: "", videoId, sound: false }];
      assert.equal((await actions.saveScreen(screenId, { name: "Counter", orientation: "PORTRAIT", theme: "WARM", showPrices: true, footerText: "Free delivery above Rs 2,000", slides })).ok, true);
      const feed = await (await feedOf(token)).json();
      const video = feed.slides.at(-1);
      assert.equal(video.type, "VIDEO"); assert.equal(feed.screen.orientation, "PORTRAIT");
      const media = (range, kind = "video", id = videoId, key = token) => mediaGET(new Request("http://localhost", { headers: range ? { range } : {} }), { params: Promise.resolve({ token: key, kind, id }) });
      const partial = await media("bytes=0-9");
      assert.equal(partial.status, 206); assert.equal(partial.headers.get("content-range"), "bytes 0-9/300000"); assert.equal(partial.headers.get("accept-ranges"), "bytes");
      const head = Buffer.from(await partial.arrayBuffer());
      assert.equal(head.length, 10); assert.equal(head.subarray(4, 8).toString(), "ftyp");
      const tail = await media("bytes=-100"); assert.equal(Buffer.from(await tail.arrayBuffer()).length, 100);
      assert.equal((await media("bytes=400000-")).status, 416);
      const whole = await media(null); assert.equal(whole.status, 200); assert.equal(Buffer.from(await whole.arrayBuffer()).length, 300_000);
      assert.equal((await media(null, "video", videoId, "y".repeat(43))).status, 401);
      await signIn(otherOwner);
      const other = await actions.createScreen("Other", "LANDSCAPE");
      const otherDevice = await requestCode();
      assert.equal((await actions.pairScreen(other.id, otherDevice.code)).ok, true);
      const otherToken = (await (await poll(otherDevice)).json()).token;
      assert.equal((await media(null, "video", videoId, otherToken)).status, 404, "another restaurant's display cannot load this video");
      assert.equal((await actions.deleteVideo(videoId)).ok, false, "another owner cannot delete it");
      assert.equal((await actions.saveScreen(screenId, { name: "Hijack", orientation: "LANDSCAPE", theme: "DARK", showPrices: true, footerText: "", slides: [] })).ok, false);
      await signIn(owner);
      assert.equal((await actions.deleteVideo(videoId)).ok, true);
      assert.ok(!(await SignageScreen.findById(screenId).lean()).slides.some(slide => slide.type === "VIDEO"), "deleted videos leave the playlist");
    });

    await t.test("disconnecting or re-pairing revokes the old TV immediately", async () => {
      await signIn(owner);
      const replacement = await requestCode();
      assert.equal((await actions.pairScreen(screenId, replacement.code)).ok, true);
      const newToken = (await (await poll(replacement)).json()).token;
      assert.equal((await feedOf(token)).status, 401, "the previous TV is disconnected");
      assert.equal((await feedOf(newToken)).status, 200);
      assert.equal((await actions.disconnectScreen(screenId)).ok, true);
      assert.equal((await feedOf(newToken)).status, 401);
      assert.equal((await feedOf("not-a-token")).status, 401);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
