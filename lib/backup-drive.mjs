import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// drive.file only grants access to files this app creates, never the rest of the owner's Drive.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_UPLOAD_MODES = ["EVERY", "DAILY"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN_URL = "https://oauth2.googleapis.com/token", REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3", UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

export class DriveError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const reconnect = () => new DriveError("RECONNECT", "Google Drive access was revoked or has expired. Reconnect Google Drive in Backups settings.");

const purposeKey = (secret, purpose) => { if (!secret || secret.length < 32) throw new DriveError("CONFIG", "AUTH_SECRET is required to protect the Google Drive connection."); return createHmac("sha256", secret).update(`restaurant-pos/${purpose}/v1`).digest(); };
function seal(value, secret, businessId, purpose) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", purposeKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(String(businessId)));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}
function open(encoded, secret, businessId, purpose) {
  const [iv, tag, ciphertext] = String(encoded).split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", purposeKey(secret, purpose), iv);
  decipher.setAAD(Buffer.from(String(businessId))); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export const encryptDriveToken = (token, secret, businessId) => seal(token, secret, businessId, "google-drive-token");
export function decryptDriveToken(encoded, secret, businessId) {
  try { return open(encoded, secret, businessId, "google-drive-token"); } catch (error) { if (error instanceof DriveError) throw error; throw reconnect(); }
}
export const DRIVE_CALLBACK_PATH = "/api/backups/google/callback";

// One Google Cloud OAuth client belongs to the server operator and is shared by every restaurant;
// each owner only grants access to their own Drive.
export function driveOAuthConfig(environment = process.env) {
  const clientId = environment.GOOGLE_DRIVE_CLIENT_ID?.trim(), clientSecret = environment.GOOGLE_DRIVE_CLIENT_SECRET?.trim(), redirectUri = environment.GOOGLE_DRIVE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== DRIVE_CALLBACK_PATH || url.search || url.hash) return null;
  } catch { return null; }
  return { clientId, clientSecret, redirectUri };
}

export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function driveAuthUrl(config, { redirectUri, state, challenge }) {
  const url = new URL(AUTH_URL);
  for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
  return url.toString();
}

async function googleJson(fetchImpl, url, init, timeout = 30000) {
  let response;
  try { response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new DriveError("NETWORK", "Google Drive could not be reached. Check the internet connection, then retry the upload."); }
  const body = await response.json().catch(() => null);
  return { response, body };
}

export async function exchangeDriveCode(config, { code, redirectUri, verifier }, fetchImpl = fetch) {
  const { response, body } = await googleJson(fetchImpl, TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }) });
  if (body?.error === "invalid_client" || body?.error === "unauthorized_client") throw new DriveError("CLIENT", "Google rejected the client ID or secret.");
  if (!response.ok || typeof body?.access_token !== "string") throw new DriveError("CONNECT", "Google did not accept the connection. Try connecting again.");
  // Granular consent lets the owner untick Drive access; refuse a connection that cannot upload.
  if (!String(body.scope ?? "").split(" ").includes(DRIVE_SCOPE)) throw new DriveError("SCOPE", "Allow the app to create files in Google Drive, then try connecting again.");
  if (typeof body.refresh_token !== "string") throw new DriveError("CONNECT", "Google did not provide offline access. Remove the app under your Google Account's third-party access, then connect again.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function driveAccessToken(config, refreshToken, fetchImpl = fetch) {
  const { response, body } = await googleJson(fetchImpl, TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  if (body?.error === "invalid_grant") throw reconnect();
  if (body?.error === "invalid_client" || body?.error === "unauthorized_client") throw new DriveError("AUTH", "Google Drive sign-in failed. Check GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET on the server.");
  if (!response.ok || typeof body?.access_token !== "string") throw new DriveError("AUTH", "Google Drive sign-in failed. Retry the upload.");
  return body.access_token;
}

export async function revokeDriveToken(token, fetchImpl = fetch) {
  try { await fetchImpl(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(15000) }); } catch { /* Local disconnection still succeeds. */ }
}

async function driveApi(fetchImpl, accessToken, url, init = {}, timeout) {
  const result = await googleJson(fetchImpl, url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } }, timeout);
  if (result.response.status === 401) throw reconnect();
  if (result.response.status === 403 && /storageQuotaExceeded|quotaExceeded/.test(JSON.stringify(result.body?.error ?? ""))) throw new DriveError("QUOTA", "Google Drive storage is full. Free up space in the connected Google account, then retry the upload.");
  return result;
}

export async function driveAccountEmail(accessToken, fetchImpl = fetch) {
  const { response, body } = await driveApi(fetchImpl, accessToken, `${API}/about?fields=user(emailAddress)`);
  if (!response.ok) throw new DriveError("CONNECT", "Could not read the connected Google account.");
  return typeof body?.user?.emailAddress === "string" ? body.user.emailAddress.slice(0, 200) : "";
}

export async function ensureDriveFolder(accessToken, { folderId, name }, fetchImpl = fetch) {
  if (folderId && /^[\w-]{10,200}$/.test(folderId)) {
    const { response, body } = await driveApi(fetchImpl, accessToken, `${API}/files/${folderId}?fields=id,trashed`);
    if (response.ok && body?.id === folderId && !body.trashed) return folderId;
  }
  const { response, body } = await driveApi(fetchImpl, accessToken, `${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ name, mimeType: FOLDER_TYPE, description: "Encrypted Restaurant POS backups. Restoring requires the restaurant's original AUTH_SECRET / BACKUP_ENCRYPTION_KEY." }) });
  if (!response.ok || typeof body?.id !== "string") throw new DriveError("UPLOAD", "Could not create the Google Drive backup folder. Retry the upload.");
  return body.id;
}

async function findUploaded(fetchImpl, accessToken, folderId, backupId) {
  const q = `'${folderId}' in parents and trashed = false and appProperties has { key='rposBackupId' and value='${backupId}' }`;
  const { response, body } = await driveApi(fetchImpl, accessToken, `${API}/files?${new URLSearchParams({ q, fields: "files(id,md5Checksum)", pageSize: "5" })}`);
  return response.ok && Array.isArray(body?.files) ? body.files[0] ?? null : null;
}

export async function uploadDriveBackup(accessToken, { folderId, backupId, businessId, bytes, description }, fetchImpl = fetch) {
  if (!/^\d{13}-[a-f\d]{16}\.rpos$/.test(backupId)) throw new DriveError("UPLOAD", "Invalid backup file.");
  const md5 = createHash("md5").update(bytes).digest("hex");
  // A retried job must not create a second copy of the same archive.
  const existing = await findUploaded(fetchImpl, accessToken, folderId, backupId);
  if (existing?.md5Checksum === md5) return { fileId: existing.id, alreadyUploaded: true };
  const metadata = { name: backupId, parents: [folderId], mimeType: "application/octet-stream", description, appProperties: { rposBackupId: backupId, rposBusinessId: String(businessId) } };
  const start = await driveApi(fetchImpl, accessToken, `${UPLOAD_API}/files?uploadType=resumable&fields=id,md5Checksum,size`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(bytes.length) }, body: JSON.stringify(metadata) });
  const location = start.response.headers.get("location");
  if (!start.response.ok || !location?.startsWith(`${UPLOAD_API}/`)) throw new DriveError("UPLOAD", "Google Drive did not start the upload. Retry the upload.");
  const timeout = Math.max(120000, Math.ceil(bytes.length / 65536) * 1000);
  const { response, body } = await driveApi(fetchImpl, accessToken, location, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes }, timeout);
  if (!response.ok || typeof body?.id !== "string") throw new DriveError("UPLOAD", "Google Drive did not finish the upload. Retry the upload.");
  if (body.md5Checksum !== md5 || Number(body.size) !== bytes.length) throw new DriveError("VERIFY", "The Google Drive copy did not match the local backup. Retry the upload.");
  return { fileId: body.id, alreadyUploaded: false };
}

const localDate = (date, timezone) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export function driveUploadDue(drive, { manual = false, now = new Date(), timezone = "Asia/Karachi" } = {}) {
  if (!drive?.refreshToken || drive.needsReconnect) return false;
  if (manual) return true;
  if (!drive.enabled) return false;
  return drive.mode !== "DAILY" || !drive.lastUploadAt || localDate(new Date(drive.lastUploadAt), timezone) !== localDate(now, timezone);
}

export const driveFolderName = businessName => `Restaurant POS Backups - ${String(businessName || "Restaurant").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").slice(0, 80).trim()}`;

// Runs in the backup worker. Never throws: a failed copy must not fail the local backup.
export async function copyBackupToDrive(db, { businessId, backup, bytes, manual = false, now = new Date(), fetchImpl = fetch, environment = process.env }) {
  const configs = db.collection("backupconfigs");
  const [config, business] = await Promise.all([configs.findOne({ businessId }), db.collection("businesses").findOne({ _id: businessId }, { projection: { name: 1, timezone: 1 } })]);
  const drive = config?.drive, timezone = business?.timezone || "Asia/Karachi";
  if (!driveUploadDue(drive, { manual, now, timezone })) return { status: "SKIPPED" };
  const oauth = driveOAuthConfig(environment);
  if (!oauth) return { status: "FAILED", message: "Google Drive is not configured on the server. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI, then restart the app." };
  try {
    const accessToken = await driveAccessToken(oauth, decryptDriveToken(drive.refreshToken, environment.AUTH_SECRET, String(businessId)), fetchImpl);
    const folderId = await ensureDriveFolder(accessToken, { folderId: drive.folderId, name: driveFolderName(business?.name) }, fetchImpl);
    const description = `Restaurant POS encrypted backup (${backup.reason ?? "MANUAL"}) created ${new Date(backup.createdAt).toISOString()}. ${backup.documents ?? 0} records.`;
    const uploaded = await uploadDriveBackup(accessToken, { folderId, backupId: backup.id, businessId, bytes, description }, fetchImpl);
    await configs.updateOne({ businessId }, { $set: { "drive.folderId": folderId, "drive.lastUploadAt": now, "drive.lastBackupId": backup.id }, $unset: { "drive.lastError": "" } });
    await db.collection("backupdriveuploads").updateOne({ businessId, backupId: backup.id }, { $set: { fileId: uploaded.fileId, folderId, uploadedAt: now } }, { upsert: true });
    return { status: "UPLOADED", fileId: uploaded.fileId };
  } catch (error) {
    const message = error instanceof DriveError ? error.message : "Google Drive upload failed. Retry the upload.";
    await configs.updateOne({ businessId }, { $set: { "drive.lastError": message, "drive.lastErrorAt": now, ...(error?.code === "RECONNECT" ? { "drive.needsReconnect": true } : {}) } }).catch(() => {});
    return { status: "FAILED", message };
  }
}
