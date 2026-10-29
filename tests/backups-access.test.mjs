import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";

const state = globalThis.__backupAccessTest = { user: null, jobs: [] };
const permissionModule = pathToFileURL(`${process.cwd()}/lib/permissions.ts`).href;
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "@/data/auth": `import {can} from ${JSON.stringify(permissionModule)}; export async function requirePermission(permission){const user=globalThis.__backupAccessTest.user;if(!user||!can(user,permission))throw new Error('Permission denied');return user}`,
      "@/lib/db": "export async function connectToDatabase(){}",
      "next/headers": "export async function headers(){return new Headers()}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});
const originalDb = mongoose.connection.db;
mongoose.connection.db = { collection() { return { createIndex: async () => {}, insertOne: async job => { state.jobs.push(job); } }; } };
const { requestManualBackup, requestBackupRestore, saveBackupSettings } = await import("../app/(dashboard)/settings/backups/actions.ts");

test("server actions allow cashier backups but deny cashier/admin schedule changes and restores", async () => {
  for (const role of ["CASHIER", "ADMIN"]) {
    state.user = { id: String(new mongoose.Types.ObjectId()), businessId: String(new mongoose.Types.ObjectId()), role };
    assert.equal((await requestManualBackup()).ok, true);
    const job = state.jobs.at(-1);
    assert.equal(String(job.businessId), state.user.businessId);
    assert.equal(String(job.userId), state.user.id);
    assert.equal(job.type, "BACKUP");
    assert.equal(job.reason, "MANUAL");
    const configuration = await saveBackupSettings({});
    assert.equal(configuration.ok, false); assert.match(configuration.message, /Only the owner/);
    const restore = await requestBackupRestore({ backupId: "1234567890123-aaaaaaaaaaaaaaaa.rpos", confirmation: "RESTORE", password: "anything", code: "" });
    assert.equal(restore.ok, false); assert.match(restore.message, /Only the owner/);
  }
  for (const role of ["WAITER", "KITCHEN"]) {
    state.user = { id: String(new mongoose.Types.ObjectId()), businessId: String(new mongoose.Types.ObjectId()), role, privileges: ["backups"] };
    assert.equal((await requestManualBackup()).ok, false);
  }
  assert.equal(state.jobs.length, 2);
});

test.after(() => { mongoose.connection.db = originalDb; });
