import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { loadAppEnv } from "./load-env.mjs";
import { Business } from "../models/Business.ts";
import { User } from "../models/User.ts";
import { Order } from "../models/Order.ts";
import { OrderCounter } from "../models/OrderCounter.ts";
import { Payment } from "../models/Payment.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Category } from "../models/Category.ts";
import { Product } from "../models/Product.ts";
import { RestaurantTable } from "../models/RestaurantTable.ts";
import { AuditLog } from "../models/AuditLog.ts";
import { AuthThrottle } from "../models/AuthThrottle.ts";
import { RevokedSession } from "../models/RevokedSession.ts";
import { dateISO } from "../lib/dates.ts";
import { PRIVILEGE_KEYS } from "../lib/permissions.ts";

const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, "").split("=")));
const label = args.label ?? "baseline";
if (!/^[a-z0-9-]{1,40}$/.test(label)) throw new Error("Use a short alphanumeric benchmark label.");
const orderCount = Number(args.orders ?? 10000), seconds = Number(args.seconds ?? 6), port = Number(args.port ?? 3218);
const concurrencies = (args.concurrency ?? "2,10,25").split(",").map(Number);
const writes = Number(args.writes ?? 40), soak = Number(args.soak ?? 0);
if (!Number.isInteger(soak) || soak < 0 || soak > 300 || !Number.isInteger(orderCount) || orderCount < 100 || orderCount > 100000 || seconds < 2 || seconds > 60 || !Number.isInteger(writes) || writes < 0 || writes > 500 || !Number.isInteger(port) || port < 1024 || port > 65535 || concurrencies.some(value => !Number.isInteger(value) || value < 1 || value > 50)) throw new Error("Invalid benchmark bounds.");
await readFile(".next/BUILD_ID"); // Benchmark a production build, never next dev.
loadAppEnv("production");
if (!process.env.MONGODB_URI) throw new Error("Configure MONGODB_URI first.");
const originalURI = process.env.MONGODB_URI;
const dbName = "pos_load_test_" + randomUUID().replaceAll("-", "");
const parts = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(originalURI);
if (!parts) throw new Error("Unsupported MongoDB connection string.");
const options = new URLSearchParams(parts[2] ?? "");
const credentials = new mongoose.mongo.MongoClient(originalURI).options.credentials;
if (credentials && !options.has("authSource")) options.set("authSource", credentials.source);
const isolatedURI = parts[1] + "/" + dbName + (options.size ? "?" + options : "");
assert.match(dbName, /^pos_load_test_[a-f0-9]{32}$/);
const authSecret = randomBytes(48).toString("base64url"), base = "http://127.0.0.1:" + port;
const reference = "load-test-" + randomUUID();
let server, stopped, metrics = [], serverErrors = [], successfulCheckouts = 0, interrupted = false;
const cancellation = new AbortController();
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{interrupted=true;cancellation.abort();});
let latest = { rssMB: 0, cpuMS: 0 };
const result = { label, measuredAt: new Date().toISOString(), environment: { node: process.version, cpu: os.cpus()[0]?.model, logicalCPUs: os.availableParallelism(), memoryGB: Math.round(os.totalmem() / 1073741824) }, config: { orderCount, seconds, concurrencies, writes, soak }, scenarios: [], endpoints: [], integrity: null };
function quantile(values, fraction) { return Math.round(values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0); }
function summarize(samples, elapsedMS) {
  const durations = samples.map(sample => sample.ms).sort((a, b) => a - b);
  return { requests: samples.length, failures: samples.filter(sample => !sample.ok).length, requestsPerSecond: +(samples.length / (elapsedMS / 1000)).toFixed(2), p50MS: quantile(durations, .5), p95MS: quantile(durations, .95), maxMS: quantile(durations, 1), averageKB: +(samples.reduce((sum, sample) => sum + sample.bytes, 0) / Math.max(1, samples.length) / 1024).toFixed(1), errors: samples.filter(sample => !sample.ok).slice(0, 3).map(sample => ({ route: sample.route, status: sample.status, message: sample.message })) };
}
function actionValue(text) {
  for (const line of text.split("\n")) {
    const match = /^[a-f\d]+:(.*)$/i.exec(line);
    if (!match) continue;
    try { const value = JSON.parse(match[1]); if (value && typeof value.ok === "boolean") return value; } catch { /* Other Flight frames are not action results. */ }
  }
  return null;
}
async function runScenario(name, concurrency, job, count, durationSeconds = seconds) {
  const samples = [], start = performance.now(), cpuStart = latest.cpuMS, checkoutStart = successfulCheckouts, startRSSMB = latest.rssMB, until = start + durationSeconds * 1000;
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, (_, worker) => (async () => {
    while (!interrupted && (count === undefined ? performance.now() < until : index < count)) {
      const request = index++; samples.push(await job(worker, request));
    }
  })()));
  const elapsed = performance.now() - start;
  const summary = { name, concurrency, durationSeconds: +(elapsed / 1000).toFixed(2), paidCheckouts: successfulCheckouts - checkoutStart, startServerRSSMB: Math.round(startRSSMB), endServerRSSMB: Math.round(latest.rssMB), ...summarize(samples, elapsed), approximateServerCPUPercent: +((latest.cpuMS - cpuStart) / elapsed * 100).toFixed(1), peakServerRSSMB: Math.round(Math.max(latest.rssMB, ...metrics.map(value => value.rssMB))) };
  summary.routes = [...new Set(samples.map(sample => sample.route))].map(route => ({ route, ...summarize(samples.filter(sample => sample.route === route), elapsed) }));
  result.scenarios.push(summary); console.log(JSON.stringify(summary)); return summary;
}
try {
  await mongoose.connect(isolatedURI, { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, dbName);
  await Promise.all([Business, User, Order, OrderCounter, Payment, SaleSession, Category, Product, RestaurantTable, AuditLog, AuthThrottle, RevokedSession].map(model => model.init()));
  const business = await Business.create({ name: "Load Test Restaurant", saleTaxRate: 0, kitchenTimingEnabled: false });
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const users = await User.create([0, 1].map(index => ({ businessId: business._id, username: "load.cashier." + index, fullName: "Load Cashier " + (index + 1), role: "CASHIER", privileges: PRIVILEGE_KEYS, passwordHash })));
  const today = dateISO(), categories = await Category.create(Array.from({ length: 8 }, (_, index) => ({ businessId: business._id, name: "Category " + index, sortOrder: index })));
  const products = await Product.create(Array.from({ length: 120 }, (_, index) => ({ businessId: business._id, categoryId: categories[index % 8]._id, name: "Test Item " + index, description: "Synthetic menu item for isolated load tests", salePrice: 250, costPrice: 100, preparationTimeMinutes: 15, sortOrder: index })));
  await RestaurantTable.create(Array.from({ length: 20 }, (_, index) => ({ businessId: business._id, name: "Table " + (index + 1), number: index + 1, sortOrder: index })));
  const sessions = await SaleSession.create(users.map((user, index) => ({ businessId: business._id, userId: user._id, userNameSnapshot: user.fullName, counterName: "Counter " + (index + 1), counterKey: "counter-" + index, saleDate: today, openingBalance: 5000 })));
  const now = Date.now(), seeded = [], payments = [];
  const monthStart = today.slice(0, 7) + "-01";
  for (let index = 0; index < orderCount; index++) {
    const live = index < 30, recent = index < Math.min(1000, orderCount), day = recent ? today : today.slice(0, 7) + "-" + String(1 + index % Math.max(1, Number(today.slice(-2)))).padStart(2, "0");
    const createdAt = recent ? new Date(now - (index % 60) * 60000) : new Date(day + "T12:00:00+05:00");
    const session = sessions[index % 2], user = users[index % 2], orderId = new mongoose.Types.ObjectId();
    const row = { _id: orderId, businessId: business._id, saleSessionId: session._id, saleDate: day, counterNameSnapshot: session.counterName, createdByUserId: user._id, orderNumber: "ORD-" + String(index + 1).padStart(6, "0"), orderType: ["DINE_IN", "TAKEAWAY", "DELIVERY"][index % 3], status: live ? ["SENT_TO_KITCHEN", "PREPARING", "READY"][index % 3] : "COMPLETED", customerSnapshot: { name: "Test Customer " + index % 100, phone: "03001234567" }, tableNameSnapshot: "Table " + (index % 20 + 1), waiterNameSnapshot: "Test Waiter " + index % 4, items: Array.from({ length: 4 }, (_, line) => ({ lineId: randomUUID(), itemType: "PRODUCT", productId: products[(index + line) % products.length]._id, nameSnapshot: products[(index + line) % products.length].name, quantity: 1, unitPrice: 250, unitCost: 100, lineSubtotal: 250, lineTax: 0, lineTotal: 250, taxRate: 0, isTaxInclusive: false, preparationTimeMinutesSnapshot: 15 })), subtotal: 1000, taxAmount: 0, discountAmount: 0, deliveryChargeAmount: 0, grandTotal: 1000, paidAmount: live ? 0 : 1000, dueAmount: live ? 1000 : 0, paymentStatus: live ? "UNPAID" : "PAID", paymentTaxRatesSnapshot: { CASH: 0, CARD: 0, BANK: 0, OTHER: 0 }, createdAt, updatedAt: createdAt, kitchenSentAt: createdAt, preparingAt: createdAt, readyAt: createdAt, ...(!live ? { completedAt: createdAt } : {}) };
    seeded.push(row);
    if (!live) payments.push({ businessId: business._id, saleSessionId: session._id, saleDate: day, orderId, idempotencyKey: randomUUID(), method: "CASH", amount: 1000, tenderedAmount: 1000, changeAmount: 0, receivedByUserId: user._id, paidAt: createdAt });
  }
  await Order.collection.insertMany(seeded); await Payment.collection.insertMany(payments);
  await OrderCounter.create({ businessId: business._id, sequence: orderCount });
  result.seed = { orders: seeded.length, payments: payments.length, products: products.length, activeKitchenOrders: 30, openCounters: 2, saleDate: today };
  console.log(JSON.stringify({ phase: "seeded", ...result.seed }));
  const cookies = await Promise.all(users.map(async user => "restaurant_pos_session=" + await new SignJWT({ userId: String(user._id), businessId: String(business._id), role: "CASHIER", authVersion: 0 }).setProtectedHeader({ alg: "HS256" }).setJti(randomUUID()).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret))));
  server = spawn(process.execPath, ["--import", "./scripts/load-test-telemetry.mjs", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, NODE_ENV: "production", MONGODB_URI: isolatedURI, AUTH_SECRET: authSecret, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  stopped = once(server, "exit");
  server.on("message", message => { if (message?.type === "load-test-metrics") { latest = message; metrics.push(message); } });
  const capture = chunk => { if (serverErrors.length < 20) serverErrors.push(String(chunk).replaceAll(originalURI, "[redacted]").replaceAll(isolatedURI, "[isolated database]").replaceAll(authSecret, "[redacted]").slice(0, 500)); };
  server.stderr.on("data", capture); server.stdout.on("data", () => {});
  let ready = false;
  for (let index = 0; index < 100; index++) { if(interrupted||server.exitCode!==null)throw new Error("Benchmark server stopped before startup."); try { const response = await fetch(base + "/login", { signal: AbortSignal.timeout(1000) }); await response.arrayBuffer(); if (response.status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error("Isolated production server did not start. " + serverErrors.join(" "));
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
  const actionID = name => { const entry = Object.entries(manifest.node).find(([, value]) => value.exportedName === name); if (!entry) throw new Error("Build does not contain action " + name); return entry[0]; };
  const input = { paymentMethod: "CASH", orderType: "TAKEAWAY", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(products[0]._id), quantity: 1, note: "" }] };
  const request = async (route, worker, action, params) => {
    const start = performance.now();
    try {
      const response = await fetch(base + route, { redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(30000),cancellation.signal]), headers: { Cookie: cookies[worker % 2], ...(action ? { "Next-Action": actionID(action), "Content-Type": "text/plain;charset=UTF-8", Origin: base } : {}) }, ...(action ? { method: "POST", body: JSON.stringify(params) } : {}) });
      const body = await response.text(), value = action ? actionValue(body) : null;
      if (action === "completeTakeawayPayment" && response.status === 200 && value?.ok === true) successfulCheckouts++;
      return { route: action ?? route, ms: performance.now() - start, bytes: Buffer.byteLength(body), status: response.status, ok: response.status === 200 && (!action || value?.ok === true), message: value?.message ?? (response.status !== 200 ? "Unexpected HTTP response" : action && !value ? "No action result" : undefined) };
    } catch (error) { return { route: action ?? route, ms: performance.now() - start, bytes: 0, status: 0, ok: false, message: error.name }; }
  };
  const routes = ["/pos", "/orders", "/kitchen", "/dashboard", "/reports?range=MONTH", "/api/reports/sales.csv?range=MONTH"];
  for (const route of routes) {
    const samples = []; for (let index = 0; index < 3; index++) samples.push(await request(route, index));
    assert.ok(samples.every(sample => sample.ok), "Warmup failed for " + route);
    const endpoint = { route, coldMS: Math.round(samples[0].ms), warmP50MS: quantile(samples.slice(1).map(sample => sample.ms).sort((a, b) => a - b), .5), responseKB: +(samples[2].bytes / 1024).toFixed(1) };
    result.endpoints.push(endpoint); console.log(JSON.stringify({ phase: "endpoint", ...endpoint }));
  }
  const preview = () => request("/pos", 0, "previewPosTotals", [{ paymentMethod: "CASH", lines: input.lines, deliveryCharge: 0 }]);
  const pilot = await preview(); assert.ok(pilot.ok, "Server Action benchmark pilot failed: " + JSON.stringify(pilot));
  if (args["browser-module"]) {
    const { checkOrderCatalog } = await import("./load-test-browser.mjs");
    result.browser = await checkOrderCatalog(base, cookies, pathToFileURL(path.resolve(args["browser-module"])).href);
    console.log(JSON.stringify({ phase: "browser", ...result.browser }));
  }
  for (const concurrency of concurrencies) {
    await runScenario("counter-operations", concurrency, (worker, index) => index % 4 === 0 ? request("/pos", worker, "previewPosTotals", [{ paymentMethod: "CASH", lines: input.lines, deliveryCharge: 0 }]) : request(["/pos", "/orders", "/kitchen"][index % 3], worker));
  }
  await runScenario("reporting", 4, (worker, index) => request(routes[3 + index % 3], worker));
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if ((writes || soak) && (hello.setName || hello.msg === "isdbgrid")) {
    if (soak) await runScenario("two-counter-mixed-soak", 2, (worker, index) => index % 25 === 0 ? request("/pos", worker, "completeTakeawayPayment", [input, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 250, tenderedAmount: 250, reference, notes: "Isolated mixed-workload soak" }]) : index % 4 === 0 ? request("/pos", worker, "previewPosTotals", [{ paymentMethod: "CASH", lines: input.lines, deliveryCharge: 0 }]) : request(["/pos", "/orders", "/kitchen"][index % 3], worker), undefined, soak);
    if(writes)for (const concurrency of [2, 10]) await runScenario("paid-takeaway-checkout", concurrency, worker => request("/pos", worker, "completeTakeawayPayment", [input, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 250, tenderedAmount: 250, reference, notes: "Isolated performance test" }]), writes);
    const collected = await Payment.find({ businessId: business._id, reference }).lean();
    const expected = successfulCheckouts;
    const savedOrders = await Order.find({ _id: { $in: collected.map(payment => payment.orderId) }, businessId: business._id }).lean();
    result.integrity = { successfulCheckouts: expected, payments: collected.length, uniqueOrders: new Set(collected.map(payment => String(payment.orderId))).size, totalCollected: collected.reduce((sum, payment) => sum + payment.amount, 0), correctPaidOrders: savedOrders.filter(order => order.paymentStatus === "PAID" && order.paidAmount === 250 && order.dueAmount === 0 && order.status === "SENT_TO_KITCHEN").length };
    assert.equal(collected.length, expected); assert.equal(result.integrity.uniqueOrders, expected); assert.equal(result.integrity.correctPaidOrders, expected); assert.equal(result.integrity.totalCollected, expected * 250);
  } else result.integrity = { skipped: "Writes require replica-set transactions and a nonzero --writes value." };
  const explain = await Order.collection.find({ businessId: business._id, paymentStatus: "PAID", status: { $ne: "CANCELLED" }, saleDate: { $gte: monthStart, $lte: today } }).explain("executionStats");
  result.query = { reportOrders: { returned: explain.executionStats.nReturned, documentsExamined: explain.executionStats.totalDocsExamined, keysExamined: explain.executionStats.totalKeysExamined, executionMS: explain.executionStats.executionTimeMillis } };
  result.peakServerRSSMB = Math.round(Math.max(0, ...metrics.map(value => value.rssMB)));
  result.serverErrorSamples = serverErrors;
  if(interrupted)throw new Error("Benchmark interrupted; isolated data will be removed.");
  await mkdir("performance", { recursive: true }); await writeFile("performance/" + label + ".json", JSON.stringify(result, null, 2) + "\n");
  assert.equal(result.scenarios.reduce((sum, scenario) => sum + scenario.failures, 0), 0, "Load test had failed requests; inspect performance/" + label + ".json");
  console.log(JSON.stringify({ phase: "complete", file: "performance/" + label + ".json", integrity: result.integrity, peakServerRSSMB: result.peakServerRSSMB }));
} finally {
  if (server && server.exitCode === null) { server.kill(); await stopped; }
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, dbName); assert.match(dbName, /^pos_load_test_[a-f0-9]{32}$/);
    try { await mongoose.connection.dropDatabase(); console.log("Isolated benchmark database removed."); } finally { await mongoose.disconnect(); }
  }
}
