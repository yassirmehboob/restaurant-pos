import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { DRIVE_SCOPE, DriveError, copyBackupToDrive, decryptDriveToken, driveAuthUrl, driveOAuthConfig, driveUploadDue, encryptDriveToken, exchangeDriveCode } from "../lib/backup-drive.mjs";

const secret = "drive-test-secret-0123456789-abcdefghij", clientId = "1234567890-abc.apps.googleusercontent.com", redirectUri = "https://pos.example/api/backups/google/callback";
const environment = { AUTH_SECRET: secret, GOOGLE_DRIVE_CLIENT_ID: clientId, GOOGLE_DRIVE_CLIENT_SECRET: "client-secret-1", GOOGLE_DRIVE_REDIRECT_URI: redirectUri };
const backup = { id: "1793256041969-9041aedddf53c3f8.rpos", createdAt: "2026-10-29T06:40:40.998Z", reason: "MANUAL", documents: 556 };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const businessId = new mongoose.Types.ObjectId(), bytes = Buffer.from("encrypted archive bytes");
function fakeDb(drive, business = { _id: businessId, name: "Indus Food", timezone: "Asia/Karachi" }) {
  const updates = [], uploads = [];
  return {
    updates, uploads,
    collection(name) {
      if (name === "backupconfigs") return { findOne: async () => drive ? { drive } : null, updateOne: async (_filter, update) => { updates.push(update); } };
      if (name === "businesses") return { findOne: async () => business };
      if (name === "backupdriveuploads") return { updateOne: async (filter, update) => { uploads.push({ ...filter, ...update.$set }); } };
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}

// Simulates Google's token, Drive metadata and resumable upload endpoints.
function fakeGoogle({ tokenError, folderMissing = false, existing = null, md5Override } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url), method = init.method ?? "GET";
    calls.push(`${method} ${href.split("?")[0]}`);
    if (href === "https://oauth2.googleapis.com/token") assert.equal(new URLSearchParams(init.body).get("client_secret"), "client-secret-1");
    if (href === "https://oauth2.googleapis.com/token") return tokenError ? json(400, { error: tokenError }) : json(200, { access_token: "access-1" });
    assert.equal(init.headers?.Authorization, "Bearer access-1");
    if (method === "GET" && href.includes("/drive/v3/files/folder-")) return folderMissing ? json(404, { error: { code: 404 } }) : json(200, { id: "folder-existing-1", trashed: false });
    if (method === "POST" && href.startsWith("https://www.googleapis.com/drive/v3/files?")) return json(200, { id: "folder-created-1" });
    if (method === "GET" && href.startsWith("https://www.googleapis.com/drive/v3/files?")) return json(200, { files: existing ? [existing] : [] });
    if (method === "POST" && href.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) {
      const metadata = JSON.parse(init.body);
      assert.equal(metadata.appProperties.rposBackupId, backup.id);
      return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc" } });
    }
    if (method === "PUT" && href.includes("upload_id=abc")) return json(200, { id: "drive-file-1", size: String(init.body.length), md5Checksum: md5Override ?? createHash("md5").update(init.body).digest("hex") });
    throw new Error(`Unexpected request ${method} ${href}`);
  };
  return { calls, fetchImpl };
}

const connected = (extra = {}) => ({ refreshToken: encryptDriveToken("refresh-1", secret, String(businessId)), folderId: "folder-existing-1", enabled: true, mode: "EVERY", ...extra });

test("Drive tokens are encrypted and bound to one restaurant", () => {
  const encoded = encryptDriveToken("refresh-token", secret, "a".repeat(24));
  assert.equal(encoded.includes("refresh-token"), false);
  assert.equal(decryptDriveToken(encoded, secret, "a".repeat(24)), "refresh-token");
  assert.throws(() => decryptDriveToken(encoded, secret, "b".repeat(24)), error => error instanceof DriveError && error.code === "RECONNECT");
});

test("consent URL requests only app-created Drive files with offline access and PKCE", async () => {
  const url = new URL(driveAuthUrl({ clientId: "client-id" }, { redirectUri: "http://localhost:3000/api/backups/google/callback", state: "state-1", challenge: "challenge-1" }));
  assert.equal(url.searchParams.get("scope"), DRIVE_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state-1");
  const declined = async () => json(200, { access_token: "a", refresh_token: "r", scope: "openid" });
  await assert.rejects(exchangeDriveCode({ clientId: "c", clientSecret: "s" }, { code: "x", redirectUri: "http://x", verifier: "v" }, declined), error => error.code === "SCOPE");
});

test("a backup is uploaded with a verified checksum and recorded", async () => {
  const db = fakeDb(connected()), google = fakeGoogle(), now = new Date("2026-10-29T10:00:00Z");
  const result = await copyBackupToDrive(db, { businessId, backup, bytes, now, fetchImpl: google.fetchImpl, environment });
  assert.deepEqual(result, { status: "UPLOADED", fileId: "drive-file-1" });
  assert.equal(db.updates[0].$set["drive.lastUploadAt"], now);
  assert.deepEqual(db.uploads, [{ businessId, backupId: backup.id, fileId: "drive-file-1", folderId: "folder-existing-1", uploadedAt: now }]);
});

test("a missing folder is recreated and an already uploaded backup is not duplicated", async () => {
  const md5 = createHash("md5").update(bytes).digest("hex");
  const google = fakeGoogle({ folderMissing: true, existing: { id: "drive-file-old", md5Checksum: md5 } });
  const result = await copyBackupToDrive(fakeDb(connected()), { businessId, backup, bytes, fetchImpl: google.fetchImpl, environment });
  assert.deepEqual(result, { status: "UPLOADED", fileId: "drive-file-old" });
  assert.equal(google.calls.some(call => call.startsWith("PUT")), false);
  assert.equal(google.calls.includes("POST https://www.googleapis.com/drive/v3/files"), true);
});

test("checksum mismatches and revoked access fail the copy without throwing", async () => {
  const mismatch = await copyBackupToDrive(fakeDb(connected()), { businessId, backup, bytes, fetchImpl: fakeGoogle({ md5Override: "0".repeat(32) }).fetchImpl, environment });
  assert.equal(mismatch.status, "FAILED"); assert.match(mismatch.message, /did not match/);
  const db = fakeDb(connected());
  const revoked = await copyBackupToDrive(db, { businessId, backup, bytes, fetchImpl: fakeGoogle({ tokenError: "invalid_grant" }).fetchImpl, environment });
  assert.equal(revoked.status, "FAILED"); assert.match(revoked.message, /Reconnect Google Drive/);
  assert.equal(db.updates.at(-1).$set["drive.needsReconnect"], true);
  assert.equal(JSON.stringify(db.updates).includes("refresh-1"), false);
});

test("uploads are skipped when disconnected, switched off, or already done today", async () => {
  const noFetch = async () => { throw new Error("Network must not be used"); };
  assert.deepEqual(await copyBackupToDrive(fakeDb(null), { businessId, backup, bytes, fetchImpl: noFetch, environment }), { status: "SKIPPED" });
  assert.deepEqual(await copyBackupToDrive(fakeDb(connected({ enabled: false })), { businessId, backup, bytes, fetchImpl: noFetch, environment }), { status: "SKIPPED" });
  // 23:30 and 00:30 Karachi time fall on different restaurant days.
  const daily = connected({ mode: "DAILY", lastUploadAt: new Date("2026-10-29T18:30:00Z") });
  assert.equal(driveUploadDue(daily, { now: new Date("2026-10-29T18:45:00Z") }), false);
  assert.equal(driveUploadDue(daily, { now: new Date("2026-10-29T19:30:00Z") }), true);
  assert.equal(driveUploadDue(daily, { manual: true, now: new Date("2026-10-29T18:45:00Z") }), true);
  assert.equal(driveUploadDue(connected({ needsReconnect: true }), { manual: true }), false);
});

test("one server OAuth client from the environment serves every restaurant", async () => {
  assert.deepEqual(driveOAuthConfig({ ...environment, GOOGLE_DRIVE_CLIENT_ID: ` ${clientId} ` }), { clientId, clientSecret: "client-secret-1", redirectUri });
  for (const missing of ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REDIRECT_URI"]) assert.equal(driveOAuthConfig({ ...environment, [missing]: "" }), null, missing);
  for (const bad of ["not a url", "ftp://pos.example/api/backups/google/callback", "https://pos.example/wrong/callback", "https://pos.example/api/backups/google/callback?x=1"]) assert.equal(driveOAuthConfig({ ...environment, GOOGLE_DRIVE_REDIRECT_URI: bad }), null, bad);
  const unconfigured = await copyBackupToDrive(fakeDb(connected()), { businessId, backup, bytes, fetchImpl: async () => { throw new Error("no network"); }, environment: { AUTH_SECRET: secret } });
  assert.equal(unconfigured.status, "FAILED"); assert.match(unconfigured.message, /GOOGLE_DRIVE_CLIENT_ID/);
});
