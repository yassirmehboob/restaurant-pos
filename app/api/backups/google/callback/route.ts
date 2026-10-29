import { timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import { DriveError, decryptDriveToken, driveAccountEmail, driveFolderName, driveOAuthConfig, encryptDriveToken, ensureDriveFolder, exchangeDriveCode, revokeDriveToken } from "@/lib/backup-drive.mjs";
import { backupsPage, DRIVE_COOKIE_PATH, DRIVE_STATE_COOKIE } from "@/lib/backup-drive-server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: NextRequest) {
  const oauth = driveOAuthConfig(), stored = request.cookies.get(DRIVE_STATE_COOKIE)?.value ?? "";
  const finish = (notice: string) => {
    const response = NextResponse.redirect(backupsPage(oauth, request, notice));
    response.cookies.set(DRIVE_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: DRIVE_COOKIE_PATH, maxAge: 0 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  if (user.role !== "OWNER") return finish("owner-only");
  if (!oauth) return finish("not-configured");
  const params = request.nextUrl.searchParams, [state = "", verifier = "", userId = ""] = stored.split(".");
  if (params.get("error")) return finish("cancelled");
  // The state binds this response to the browser and owner that started the connection.
  if (!state || !verifier || userId !== user.id || !same(state, params.get("state") ?? "")) return finish("expired");
  const code = params.get("code");
  if (!code || code.length > 2048) return finish("failed");
  try {
    const tokens = await exchangeDriveCode(oauth, { code, redirectUri: oauth.redirectUri, verifier });
    const email = await driveAccountEmail(tokens.accessToken);
    await connectToDatabase();
    const db = mongoose.connection.db!, businessId = new mongoose.Types.ObjectId(user.businessId);
    const previous = (await db.collection("backupconfigs").findOne({ businessId }))?.drive;
    // Reconnecting the same account keeps its folder; another account cannot see it and gets a new one.
    const folderId = await ensureDriveFolder(tokens.accessToken, { folderId: previous?.folderId, name: driveFolderName(user.businessName) });
    await db.collection("backupconfigs").updateOne({ businessId }, { $set: { businessId, drive: { refreshToken: encryptDriveToken(tokens.refreshToken, env().AUTH_SECRET, user.businessId), email, folderId, enabled: previous?.enabled ?? true, mode: previous?.mode === "EVERY" ? "EVERY" : "DAILY", connectedAt: new Date(), connectedBy: new mongoose.Types.ObjectId(user.id) } } }, { upsert: true });
    if (previous?.folderId !== folderId) await db.collection("backupdriveuploads").deleteMany({ businessId });
    if (previous?.refreshToken) { try { await revokeDriveToken(decryptDriveToken(previous.refreshToken, env().AUTH_SECRET, user.businessId)); } catch { /* The replaced token is unusable anyway. */ } }
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "CONNECT_BACKUP_DRIVE", entityType: "Backup", description: `Connected Google Drive backup copies${email ? ` (${email})` : ""}` });
    return finish("connected");
  } catch (error) {
    return finish(error instanceof DriveError && error.code === "SCOPE" ? "scope" : error instanceof DriveError && error.code === "CLIENT" ? "client" : "failed");
  }
}
