import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { createBusinessBackup, decodeBackup, encodeBackup, listBusinessBackups, restoreBusinessBackup } from "../lib/backups.mjs";
import { ensureBackupIndexes, enqueueBackupJob, runBackupTick } from "../lib/backup-worker.mjs";
import { DEFAULT_BACKUP_SCHEDULE } from "../lib/backup-schedule.mjs";
import { mongoDatabaseUri } from "../lib/backup-switch.mjs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

test("encrypted restaurant backup restores records, BSON image bytes and indexes into a verified separate database", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  const name = "pos_backup_test_" + randomUUID().replaceAll("-", "");
  const directory = await mkdtemp(path.join(tmpdir(), "pos-backups-test-"));
  const previousDirectory = process.env.BACKUP_DIRECTORY;
  process.env.BACKUP_DIRECTORY = directory;
  let targetName, partialName;
  await mongoose.connect(process.env.MONGODB_URI, { dbName: name, serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db, client = mongoose.connection.getClient(), id = () => new mongoose.Types.ObjectId(), businessId = id(), other = id(), owner = id(), product = id(), image = id();
  try {
    await db.collection("businesses").insertMany([{ _id: businessId, name: "Backup restaurant", timezone: "Asia/Karachi", isActive: true }, { _id: other, name: "Other business" }]);
    await db.collection("users").insertMany([{ _id: owner, businessId, role: "OWNER", username: "backup.owner", passwordHash: "stored-hash", isActive: true, authVersion: 0 }, { _id: id(), businessId: other, role: "OWNER", isActive: true }]);
    await db.collection("products").createIndex({ businessId: 1, name: 1 }, { unique: true });
    await db.collection("products").insertMany([{ _id: product, businessId, name: "Soup", salePrice: 350, createdAt: new Date("2026-10-29T10:00:00Z") }, { _id: id(), businessId: other, name: "Private other item" }]);
    await db.collection("expensecategories").createIndex({ businessId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
    await db.collection("expensecategories").insertOne({ businessId, name: "Supplies" });
    await db.collection("images.files").insertOne({ _id: image, length: 5, chunkSize: 261120, uploadDate: new Date(), filename: "image.png", metadata: { businessId: String(businessId) } });
    await db.collection("images.chunks").createIndex({ files_id: 1, n: 1 }, { unique: true });
    await db.collection("images.chunks").insertOne({ _id: id(), files_id: image, n: 0, data: new mongoose.mongo.Binary(Buffer.from([1, 2, 3, 4, 5])) });
    await db.collection("smsmessages").insertOne({ _id: "message", businessId, status: "PENDING", body: "Do not send again" });
    await db.collection("backupconfigs").insertOne({ businessId, ...DEFAULT_BACKUP_SCHEDULE, enabled: true, afterClosing: true });
    await db.collection("revokedsessions").insertOne({ _id: "not-a-business-record", expiresAt: new Date() });
    const backup = await createBusinessBackup(client, db, String(businessId));
    assert.equal((await listBusinessBackups(String(businessId))).length, 1);
    const file = path.join(directory, String(businessId), backup.id), bytes = await readFile(file), decoded = decodeBackup(bytes);
    assert.equal(decoded.collections.some(collection => collection.name === "revokedsessions"), false);
    assert.equal(decoded.collections.find(collection => collection.name === "products").documents.length, 1);
    await db.collection("products").updateOne({ _id: product }, { $set: { salePrice: 999 } });
    await db.collection("products").insertOne({ _id: id(), businessId, name: "Created after snapshot" });
    const restored = await restoreBusinessBackup(client, db, String(businessId), backup.id);
    targetName = restored.database;
    assert.notEqual(targetName, name);
    const target = client.db(targetName);
    assert.equal(await target.collection("businesses").countDocuments(), 1);
    assert.equal((await target.collection("products").findOne({ _id: product })).salePrice, 350);
    assert.equal((await db.collection("products").findOne({ _id: product })).salePrice, 999);
    assert.equal(await db.collection("products").countDocuments({ businessId }), 2);
    assert.deepEqual(Buffer.from((await target.collection("images.chunks").findOne({ files_id: image })).data.value()), Buffer.from([1, 2, 3, 4, 5]));
    assert.equal((await target.collection("products").indexes()).find(index => index.name === "businessId_1_name_1").unique, true);
    assert.equal((await target.collection("expensecategories").indexes()).find(index => index.name === "businessId_1_name_1").collation.strength, 2);
    assert.equal((await target.collection("smsmessages").findOne({ _id: "message" })).status, "SKIPPED");
    assert.ok((await target.collection("users").findOne({ _id: owner })).authVersion > 0);
    assert.equal((await target.collection("backupconfigs").findOne()).enabled, false);
    assert.equal((await target.collection("backuprestoreinfo").findOne()).verified, true);
    const duplicate = decodeBackup(bytes), products = duplicate.collections.find(collection => collection.name === "products");
    products.documents.push({ ...products.documents[0], _id: id() });
    await writeFile(file, encodeBackup(duplicate));
    try { await restoreBusinessBackup(client, db, String(businessId), backup.id); assert.fail("Expected index verification to fail"); }
    catch (error) { assert.match(error.message, /original database is unchanged/); partialName = error.message.match(/Partial database: (restaurant_pos_restore_\d{13}_[a-f\d]{10})/)[1]; }
    assert.equal(await client.db(partialName).collection("backuprestoreinfo").countDocuments({ verified: true }), 0);
    assert.equal((await db.collection("products").findOne({ _id: product })).salePrice, 999);
    const broken = Buffer.from(bytes); broken[50] ^= 1; await writeFile(file, broken);
    await assert.rejects(restoreBusinessBackup(client, db, String(businessId), backup.id), /damaged/);
    assert.equal((await db.collection("products").findOne({ _id: product })).salePrice, 999);
  } finally {
    if (targetName) { assert.match(targetName, /^restaurant_pos_restore_\d{13}_[a-f\d]{10}$/); await client.db(targetName).dropDatabase(); }
    if (partialName) { assert.match(partialName, /^restaurant_pos_restore_\d{13}_[a-f\d]{10}$/); await client.db(partialName).dropDatabase(); }
    assert.match(db.databaseName, /^pos_backup_test_[a-f\d]+$/); await db.dropDatabase(); await mongoose.disconnect();
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^pos-backups-test-/);
    await rm(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) delete process.env.BACKUP_DIRECTORY; else process.env.BACKUP_DIRECTORY = previousDirectory;
  }
});

test("restore switch CLI refuses a running app, switches a stopped local setup and can roll back", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  const name = "pos_backup_test_" + randomUUID().replaceAll("-", "");
  const directory = await mkdtemp(path.join(tmpdir(), "pos-backups-switch-test-"));
  const previousDirectory = process.env.BACKUP_DIRECTORY; process.env.BACKUP_DIRECTORY = directory;
  let targetName;
  await mongoose.connect(process.env.MONGODB_URI, { dbName: name, serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db, client = mongoose.connection.getClient(), businessId = new mongoose.Types.ObjectId();
  try {
    await db.collection("businesses").insertOne({ _id: businessId, name: "Switch test", isActive: true });
    await db.collection("users").insertOne({ businessId, role: "OWNER", isActive: true, authVersion: 0 });
    const backup = await createBusinessBackup(client, db, String(businessId));
    const result = await restoreBusinessBackup(client, db, String(businessId), backup.id); targetName = result.database;
    const sourceUri = mongoDatabaseUri(process.env.MONGODB_URI, name, client.options.credentials?.source);
    const envFile = path.join(directory, ".env.local"), runtime = path.join(directory, ".restaurant-pos-runtime.json");
    await writeFile(envFile, `MONGODB_URI=${JSON.stringify(sourceUri)}\nUNRELATED_SETTING=keep-me\n`);
    const script = path.resolve("scripts/backups.mjs");
    const run = (database, uri = sourceUri) => spawnSync(process.execPath, [script, "switch", "--database", database, "--confirm", "SWITCH"], { cwd: directory, env: { ...process.env, MONGODB_URI: uri }, encoding: "utf8", windowsHide: true });
    await writeFile(runtime, JSON.stringify({ pid: process.pid }));
    const blocked = run(targetName);
    assert.equal(blocked.status, 1); assert.match(blocked.stderr, /Stop the app/);
    assert.equal(parseEnv(await readFile(envFile, "utf8")).MONGODB_URI, sourceUri);
    await unlink(runtime);
    const switched = run(targetName);
    assert.equal(switched.status, 0, switched.stderr);
    const updated = parseEnv(await readFile(envFile, "utf8"));
    assert.equal(updated.UNRELATED_SETTING, "keep-me");
    assert.match(updated.MONGODB_URI, new RegExp("/" + targetName + "(?:\\?|$)"));
    assert.equal(await db.collection("businesses").countDocuments(), 1);
    const rollback = run(name, updated.MONGODB_URI);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(parseEnv(await readFile(envFile, "utf8")).MONGODB_URI, sourceUri);
  } finally {
    if (targetName) { assert.match(targetName, /^restaurant_pos_restore_\d{13}_[a-f\d]{10}$/); await client.db(targetName).dropDatabase(); }
    assert.match(db.databaseName, /^pos_backup_test_[a-f\d]+$/); await db.dropDatabase(); await mongoose.disconnect();
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^pos-backups-switch-test-/);
    await rm(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) delete process.env.BACKUP_DIRECTORY; else process.env.BACKUP_DIRECTORY = previousDirectory;
  }
});

test("backup worker deduplicates jobs, honors last-counter closing and does not expose driver errors", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  const name = "pos_backup_test_" + randomUUID().replaceAll("-", "");
  const directory = await mkdtemp(path.join(tmpdir(), "pos-backups-worker-test-"));
  const previousDirectory = process.env.BACKUP_DIRECTORY; process.env.BACKUP_DIRECTORY = directory;
  await mongoose.connect(process.env.MONGODB_URI, { dbName: name, serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db, client = mongoose.connection.getClient(), businessId = new mongoose.Types.ObjectId(), owner = new mongoose.Types.ObjectId(), workerId = randomUUID();
  try {
    await ensureBackupIndexes(db);
    await db.collection("businesses").insertOne({ _id: businessId, name: "Worker test", isActive: true });
    await db.collection("users").insertOne({ _id: owner, businessId, role: "OWNER", isActive: true });
    const job = await enqueueBackupJob(db, { businessId, userId: owner });
    await assert.rejects(enqueueBackupJob(db, { businessId }), /already queued/);
    await runBackupTick(client, db, workerId);
    assert.equal((await db.collection("backupjobs").findOne({ _id: job._id })).status, "SUCCEEDED");
    const now = new Date();
    await db.collection("backupconfigs").insertOne({ businessId, ...DEFAULT_BACKUP_SCHEDULE, afterClosing: true, revision: 1, closingEnabledAt: new Date(now.getTime() - 60000) });
    await db.collection("salesessions").insertMany([{ businessId, status: "CLOSED", closedAt: new Date(now.getTime() - 1000) }, { businessId, status: "OPEN" }]);
    await runBackupTick(client, db, workerId);
    assert.equal(await db.collection("backupjobs").countDocuments({ reason: "CLOSING" }), 0);
    await db.collection("salesessions").updateOne({ status: "OPEN" }, { $set: { status: "CLOSED", closedAt: now } });
    await runBackupTick(client, db, workerId);
    assert.equal(await db.collection("backupjobs").countDocuments({ reason: "CLOSING", status: "SUCCEEDED" }), 1);
    await runBackupTick(client, db, workerId);
    assert.equal(await db.collection("backupjobs").countDocuments({ reason: "CLOSING" }), 1);
    await db.collection("backupconfigs").updateOne({ businessId }, { $set: { enabled: true, afterClosing: false, mode: "INTERVAL", intervalMinutes: 60, nextRunAt: new Date(Date.now() - 1000) } });
    await runBackupTick(client, db, workerId);
    assert.equal(await db.collection("backupjobs").countDocuments({ reason: "SCHEDULED", status: "SUCCEEDED" }), 1);
    const next = (await db.collection("backupconfigs").findOne({ businessId })).nextRunAt;
    assert.ok(next > new Date());
  } finally {
    assert.match(db.databaseName, /^pos_backup_test_[a-f\d]+$/); await db.dropDatabase(); await mongoose.disconnect();
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^pos-backups-worker-test-/);
    await rm(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) delete process.env.BACKUP_DIRECTORY; else process.env.BACKUP_DIRECTORY = previousDirectory;
  }
});
