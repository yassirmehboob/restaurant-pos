import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, lstat, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import mongoose from "mongoose";

const { ObjectId, BSON } = mongoose.mongo;
const { EJSON } = BSON;
const MAGIC = Buffer.from("RPOSBK01");
const EXCLUDED = new Set(["backupjobs", "backupworker", "backuplocks", "backuprestoreinfo", "auththrottles", "revokedsessions"]);
const validCollection = name => typeof name === "string" && /^[a-z][a-z0-9_.]{0,100}$/i.test(name) && !name.startsWith("system.") && !EXCLUDED.has(name);
const maxBytes = () => Math.max(16, Math.min(2048, Number(process.env.BACKUP_MAX_SIZE_MB) || 256)) * 1024 * 1024;
export const backupRoot = () => {
  // Runtime archives are provisioned separately and must never enter a deployment bundle.
  const root = path.resolve(/* turbopackIgnore: true */ process.env.BACKUP_DIRECTORY || path.join(/* turbopackIgnore: true */ process.cwd(), "..", "restaurant-pos-backups"));
  for (const unsafe of ["public", ".next", ".git", "node_modules"]) {
    const relative = path.relative(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ unsafe), root);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Backup storage cannot be inside public, build, dependency or Git directories.");
  }
  return root;
};
function validateBusinessId(id) { if (!/^[a-f\d]{24}$/i.test(id)) throw new Error("Invalid restaurant backup identity."); return new ObjectId(id); }
export function validateBackupId(id) { if (typeof id !== "string" || !/^\d{13}-[a-f\d]{16}\.rpos$/.test(id)) throw new Error("Invalid backup file."); return id; }
const encryptionSecret = () => { const value = process.env.BACKUP_ENCRYPTION_KEY || process.env.AUTH_SECRET; if (!value || value.length < 32) throw new Error("A stable backup encryption key of at least 32 characters is required."); return value; };
const key = () => createHmac("sha256", encryptionSecret()).update("restaurant-pos/backup/v1").digest();
const authFingerprint = () => { if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET is required to protect encrypted account settings."); return createHash("sha256").update(process.env.AUTH_SECRET).digest("hex"); };

async function businessDirectory(businessId, create = true) {
  validateBusinessId(businessId);
  const root = backupRoot();
  if (create) await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  // The configured root may be a mounted disk; business folders must stay inside it.
  const resolvedRoot = await realpath(/* turbopackIgnore: true */ root), directory = path.join(/* turbopackIgnore: true */ resolvedRoot, businessId);
  if (create) await mkdir(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(/* turbopackIgnore: true */ directory);
  if (actual !== directory || (await lstat(/* turbopackIgnore: true */ directory)).isSymbolicLink()) throw new Error("Backup folders cannot be symbolic links.");
  return actual;
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(/* turbopackIgnore: true */ temporary).catch(() => {}); throw error; }
  await handle.close();
  try { await rename(/* turbopackIgnore: true */ temporary, file); } catch (error) { await unlink(/* turbopackIgnore: true */ temporary).catch(() => {}); throw error; }
}

export function encodeBackup(payload) {
  const plain = Buffer.from(EJSON.stringify(payload, { relaxed: false }));
  if (plain.length > maxBytes()) throw new Error("Backup exceeds BACKUP_MAX_SIZE_MB. Increase the configured limit or use database tooling for this restaurant.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decodeBackup(bytes) {
  if (bytes.length < 37 || bytes.length > maxBytes() || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error("This is not a supported Restaurant POS backup.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(8, 20));
    decipher.setAAD(MAGIC); decipher.setAuthTag(bytes.subarray(20, 36));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
    return EJSON.parse(gunzipSync(compressed, { maxOutputLength: maxBytes() }).toString("utf8"), { relaxed: false });
  } catch { throw new Error("Backup is damaged, incomplete, or encrypted with a different backup key."); }
}

export function validateBackupPayload(payload, businessId) {
  validateBusinessId(businessId);
  if (payload?.format !== "restaurant-pos" || Number(payload.version) !== 1 || payload.businessId !== businessId || !Array.isArray(payload.collections) || !payload.collections.length || payload.collections.length > 200) throw new Error("Backup format or restaurant identity does not match.");
  if (payload.authFingerprint !== authFingerprint()) throw new Error("Use the original AUTH_SECRET to restore authenticator and SMS settings safely.");
  const names = new Set();
  const files = payload.collections.find(collection => collection.name === "images.files")?.documents ?? [];
  const imageIds = new Set(files.map(file => String(file._id)));
  for (const collection of payload.collections) {
    if (!validCollection(collection.name) || names.has(collection.name) || !Array.isArray(collection.documents) || !Array.isArray(collection.indexes)) throw new Error("Backup contains an invalid collection.");
    names.add(collection.name);
    const ids = new Set();
    for (const document of collection.documents) {
      if (!document || document._id == null || ids.has(String(document._id))) throw new Error("Backup contains missing or duplicate document identities.");
      ids.add(String(document._id));
      const valid = collection.name === "businesses" ? String(document._id) === businessId
        : collection.name === "images.files" ? document.metadata?.businessId === businessId
        : collection.name === "images.chunks" ? imageIds.has(String(document.files_id))
        : String(document.businessId) === businessId;
      if (!valid) throw new Error("Backup contains data belonging to another restaurant.");
    }
  }
  const business = payload.collections.find(collection => collection.name === "businesses");
  if (business?.documents.length !== 1) throw new Error("Backup is missing the restaurant record.");
  if (!payload.collections.find(collection => collection.name === "users")?.documents.some(user => user.role === "OWNER" && user.isActive)) throw new Error("Backup must contain an active owner account.");
  const chunks = payload.collections.find(collection => collection.name === "images.chunks")?.documents ?? [];
  for (const file of files) {
    const parts = chunks.filter(chunk => String(chunk.files_id) === String(file._id)).sort((a, b) => Number(a.n) - Number(b.n));
    if (parts.some((chunk, index) => Number(chunk.n) !== index || !chunk.data || typeof chunk.data.value !== "function") || parts.reduce((length, chunk) => length + chunk.data.value().length, 0) !== Number(file.length)) throw new Error("Backup contains an incomplete uploaded image.");
  }
  return payload;
}

export async function createBusinessBackup(client, db, businessId, reason = "MANUAL") {
  const identity = validateBusinessId(businessId), createdAt = new Date(), collections = [];
  const entries = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name).filter(validCollection).sort();
  const indexes = new Map();
  for (const name of entries) indexes.set(name, await db.collection(name).listIndexes().toArray());
  const session = client.startSession();
  let business, bytesUsed = 0;
  try {
    await session.withTransaction(async () => {
      collections.length = 0; bytesUsed = 0;
      business = await db.collection("businesses").findOne({ _id: identity }, { session });
      if (!business) throw new Error("Restaurant not found.");
      let imageIds = [];
      if (entries.includes("images.files")) imageIds = (await db.collection("images.files").find({ "metadata.businessId": businessId }, { session, projection: { _id: 1 } }).toArray()).map(file => file._id);
      for (const name of entries) {
        const filter = name === "businesses" ? { _id: identity } : name === "images.files" ? { "metadata.businessId": businessId } : name === "images.chunks" ? { files_id: { $in: imageIds } } : { businessId: identity };
        const documents = [];
        for await (const document of db.collection(name).find(filter, { session })) {
          bytesUsed += BSON.calculateObjectSize(document) * 2;
          if (bytesUsed > maxBytes()) throw new Error("Backup exceeds the configured size limit. Increase BACKUP_MAX_SIZE_MB or use database tooling.");
          documents.push(document);
        }
        if (documents.length || name === "businesses" || indexes.get(name).some(index => "businessId" in index.key) || name.startsWith("images.")) collections.push({ name, documents, indexes: indexes.get(name) });
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } finally { await session.endSession(); }
  const payload = { format: "restaurant-pos", version: 1, businessId, businessName: business.name, sourceDatabase: db.databaseName, createdAt, reason, authFingerprint: authFingerprint(), collections };
  validateBackupPayload(payload, businessId);
  const bytes = encodeBackup(payload);
  // Read the finished ciphertext back through the verifier before publishing it.
  validateBackupPayload(decodeBackup(bytes), businessId);
  const id = `${Date.now()}-${randomBytes(8).toString("hex")}.rpos`, directory = await businessDirectory(businessId);
  const metadata = { id, createdAt: createdAt.toISOString(), reason, bytes: bytes.length, documents: collections.reduce((sum, collection) => sum + collection.documents.length, 0), collections: collections.length, businessName: business.name, sha256: createHash("sha256").update(bytes).digest("hex") };
  await atomicWrite(path.join(/* turbopackIgnore: true */ directory, id), bytes);
  await atomicWrite(path.join(/* turbopackIgnore: true */ directory, `${id}.json`), JSON.stringify(metadata));
  return metadata;
}

export async function readBackupFile(businessId, id) {
  validateBackupId(id);
  const directory = await businessDirectory(businessId, false), file = path.join(/* turbopackIgnore: true */ directory, id);
  const info = await lstat(/* turbopackIgnore: true */ file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes()) throw new Error("Backup is unavailable or too large.");
  return readFile(/* turbopackIgnore: true */ file);
}

export async function listBusinessBackups(businessId) {
  let directory;
  try { directory = await businessDirectory(businessId, false); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const files = await readdir(/* turbopackIgnore: true */ directory), result = [];
  for (const file of files.filter(name => /^\d{13}-[a-f\d]{16}\.rpos$/.test(name)).sort().reverse()) {
    try {
      const info = await lstat(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, file));
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const metaFile = path.join(/* turbopackIgnore: true */ directory, `${file}.json`), metaInfo = await lstat(/* turbopackIgnore: true */ metaFile);
      if (!metaInfo.isFile() || metaInfo.isSymbolicLink() || metaInfo.size > 16384) continue;
      const meta = JSON.parse(await readFile(/* turbopackIgnore: true */ metaFile, "utf8"));
      if (typeof meta.createdAt !== "string" || !Number.isFinite(new Date(meta.createdAt).getTime()) || !Number.isSafeInteger(meta.documents) || meta.documents < 1 || !Number.isSafeInteger(meta.collections) || meta.collections < 1 || typeof meta.reason !== "string" || meta.reason.length > 40) continue;
      result.push({ id: file, createdAt: meta.createdAt, reason: meta.reason, bytes: info.size, documents: meta.documents, collections: meta.collections });
    } catch { /* Incomplete or orphaned files are never offered for restoration. */ }
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function restoreBusinessBackup(client, sourceDb, businessId, id) {
  const payload = validateBackupPayload(decodeBackup(await readBackupFile(businessId, id)), businessId);
  const targetName = `restaurant_pos_restore_${Date.now()}_${randomBytes(5).toString("hex")}`;
  const existing = await client.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: targetName } });
  if (sourceDb.databaseName === targetName || existing.databases.length) throw new Error("Restore destination must be a new, separate database.");
  const target = client.db(targetName);
  // Never remove a database on failure: the source and any partial target remain inspectable.
  try {
    for (const collection of payload.collections) {
      await target.createCollection(collection.name);
      for (let offset = 0; offset < collection.documents.length; offset += 250) await target.collection(collection.name).insertMany(collection.documents.slice(offset, offset + 250), { ordered: true });
      for (const index of collection.indexes) {
        if (index.name === "_id_") continue;
        const options = {};
        for (const key of ["name", "unique", "sparse", "expireAfterSeconds", "partialFilterExpression", "collation", "hidden"]) if (index[key] !== undefined) options[key] = key === "expireAfterSeconds" ? Number(index[key]) : index[key];
        if (options.collation) options.collation = Object.fromEntries(Object.entries(options.collation).filter(([key]) => ["locale", "caseLevel", "caseFirst", "strength", "numericOrdering", "alternate", "maxVariable", "backwards", "normalization"].includes(key)).map(([key, value]) => [key, key === "strength" ? Number(value) : value]));
        await target.collection(collection.name).createIndex(index.key, options);
      }
      const restored = await target.collection(collection.name).find().sort({ _id: 1 }).toArray();
      const canonical = documents => EJSON.stringify([...documents].sort((a, b) => String(a._id).localeCompare(String(b._id))), { relaxed: false });
      if (canonical(restored) !== canonical(collection.documents)) throw new Error(`Restore verification failed for ${collection.name}.`);
    }
    // Revoke archived login sessions and pending notifications; do not replay old SMS jobs.
    await target.collection("users").updateMany({}, { $set: { authVersion: Date.now() }, $unset: { twoFactorPendingSecret: "", twoFactorPendingExpiresAt: "" } });
    const names = new Set(payload.collections.map(collection => collection.name));
    if (names.has("waiterpushsubscriptions")) await target.collection("waiterpushsubscriptions").deleteMany({});
    if (names.has("backupconfigs")) {
      await target.collection("backupconfigs").updateMany({}, { $set: { enabled: false, afterClosing: false, nextRunAt: null } });
      await target.collection("backupconfigs").updateMany({ drive: { $type: "object" } }, { $set: { "drive.enabled": false } });
    }
    if (names.has("smsmessages")) await target.collection("smsmessages").updateMany({ status: { $in: ["PENDING", "SENDING"] } }, { $set: { status: "SKIPPED", failureCode: "BACKUP_RESTORE", finishedAt: new Date() } });
    await target.collection("backuprestoreinfo").insertOne({ sourceBackup: id, businessId: new ObjectId(businessId), restoredAt: new Date(), sourceDatabase: sourceDb.databaseName, verified: true });
    return { database: targetName, documents: payload.collections.reduce((sum, collection) => sum + collection.documents.length, 0), backupCreatedAt: new Date(payload.createdAt).toISOString() };
  } catch { throw new Error(`Restore did not pass verification. The original database is unchanged. Partial database: ${targetName}. Do not switch to it.`); }
}

export async function importBusinessBackup(bytes) {
  const payload = decodeBackup(bytes);
  validateBackupPayload(payload, payload.businessId);
  const directory = await businessDirectory(payload.businessId), id = `${Date.now()}-${randomBytes(8).toString("hex")}.rpos`;
  const metadata = { id, createdAt: new Date(payload.createdAt).toISOString(), reason: payload.reason || "IMPORTED", bytes: bytes.length, documents: payload.collections.reduce((sum, collection) => sum + collection.documents.length, 0), collections: payload.collections.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await atomicWrite(path.join(/* turbopackIgnore: true */ directory, id), bytes);
  await atomicWrite(path.join(/* turbopackIgnore: true */ directory, `${id}.json`), JSON.stringify(metadata));
  return { ...metadata, businessId: payload.businessId };
}
