import mongoose from "mongoose";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { loadAppEnv } from "./load-env.mjs";
import { createBusinessBackup, decodeBackup, importBusinessBackup, listBusinessBackups, restoreBusinessBackup, validateBackupPayload } from "../lib/backups.mjs";
import { mongoDatabaseUri } from "../lib/backup-switch.mjs";

loadAppEnv(process.env.NODE_ENV ?? "production");
const [command, ...args] = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Use --option value pairs."); options[args[i].slice(2)] = args[i + 1]; }

async function switchDatabase() {
  if (options.confirm !== "SWITCH") throw new Error("Stop the app and use --confirm SWITCH after reviewing the verified restore database.");
  try {
    const running = JSON.parse(await readFile(path.resolve(".restaurant-pos-runtime.json"), "utf8"));
    for (const pid of [running.pid, running.appPid].filter(Number.isInteger)) {
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") throw new Error("Cannot confirm the app is stopped."); }
      if (alive) throw new Error("Stop the app before switching databases.");
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const current = mongoose.connection.db, targetName = options.database;
  if (typeof targetName !== "string" || !/^[a-zA-Z0-9_-]{1,63}$/.test(targetName) || targetName === current.databaseName) throw new Error("Choose a different, verified restore database.");
  const marker = await mongoose.connection.getClient().db(targetName).collection("backuprestoreinfo").findOne({ verified: true });
  const rollback = await current.collection("backuprestoreinfo").findOne({ verified: true, sourceDatabase: targetName });
  if (!marker && !rollback) throw new Error("The target is not a verified restore or the original database recorded by a restore.");
  if (marker && marker.sourceDatabase !== current.databaseName) throw new Error("The target was not prepared from the currently selected database.");
  if (marker && await current.collection("businesses").countDocuments({ _id: { $ne: marker.businessId } })) throw new Error("Shared database: use a separate app instance for this restaurant restore. Switching this shared app would hide other restaurants.");
  const envPath = path.resolve(".env.local"), text = await readFile(envPath, "utf8"), local = parseEnv(text);
  if (!local.MONGODB_URI || local.MONGODB_URI !== process.env.MONGODB_URI) throw new Error("MONGODB_URI is managed outside .env.local. Update your service environment to use the verified target database, then restart.");
  const credentials = mongoose.connection.getClient().options.credentials;
  const uri = mongoDatabaseUri(local.MONGODB_URI, targetName, credentials?.source);
  const updated = text.replace(/^\s*MONGODB_URI\s*=.*$/m, `MONGODB_URI=${JSON.stringify(uri)}`);
  const temporary = `${envPath}.${randomBytes(8).toString("hex")}.tmp`;
  try { await writeFile(temporary, updated, { flag: "wx", mode: 0o600 }); await rename(temporary, envPath); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  console.log(`Database selection updated to ${targetName}. Start the app and sign in again. Original database retained: ${marker?.sourceDatabase || targetName}.`);
}

try {
  if (command === "verify") {
    if (!options.file) throw new Error("Provide --file with an encrypted .rpos backup.");
    const payload = decodeBackup(await readFile(path.resolve(options.file)));
    validateBackupPayload(payload, payload.businessId);
    console.log(`Backup verified for restaurant ${payload.businessId}. No database was changed.`);
  } else {
    if (!["create", "create-all", "list", "restore", "switch"].includes(command)) throw new Error("Commands: create --business ID; create-all; list --business ID; verify --file PATH; restore --file PATH --confirm RESTORE; restore --business ID --backup FILE --confirm RESTORE; switch --database NAME --confirm SWITCH.");
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db, client = mongoose.connection.getClient();
    if (command === "switch") await switchDatabase();
    else if (command === "create") console.log(JSON.stringify(await createBusinessBackup(client, db, options.business), null, 2));
    // Used by update-pos.bat: one backup per active restaurant before new code is installed.
    else if (command === "create-all") {
      const businesses = await db.collection("businesses").find({ isActive: true }, { projection: { name: 1 } }).toArray();
      for (const business of businesses) { const backup = await createBusinessBackup(client, db, String(business._id)); console.log(`Backed up ${business.name}: ${backup.id} (${backup.documents} records)`); }
      console.log(businesses.length ? `${businesses.length} restaurant backup(s) created.` : "No restaurants to back up.");
    }
    else if (command === "list") console.log(JSON.stringify(await listBusinessBackups(options.business), null, 2));
    else {
      if (options.confirm !== "RESTORE") throw new Error("Use --confirm RESTORE to prepare a separate restore database.");
      let businessId = options.business, id = options.backup;
      if (options.file) { const imported = await importBusinessBackup(await readFile(path.resolve(options.file))); businessId = imported.businessId; id = imported.id; }
      const result = await restoreBusinessBackup(client, db, businessId, id);
      console.log(JSON.stringify(result, null, 2));
      console.log("Original database unchanged. Stop the app, switch to this verified database, then restart.");
    }
  }
} catch (error) {
  const message = /^(Stop |Choose |Use |Provide |Commands:|Backup |This is not |Use the original |Restore |Invalid |Could not read|MONGODB_URI |The target |Shared database:|A stable |AUTH_SECRET |Cannot confirm)/.test(error.message) ? error.message : "Backup command failed. Check keys, storage access, replica-set support and database permissions. Connection details have not been printed.";
  console.error(message); process.exitCode = 1;
} finally { await mongoose.disconnect(); }
