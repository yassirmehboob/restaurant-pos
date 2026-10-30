import { secureCookies } from "@/lib/env";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/data/auth";
import { createPkcePair, driveAuthUrl, driveOAuthConfig } from "@/lib/backup-drive.mjs";
import { backupsPage, DRIVE_COOKIE_PATH, DRIVE_STATE_COOKIE } from "@/lib/backup-drive-server";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  const oauth = driveOAuthConfig();
  if (user.role !== "OWNER") return NextResponse.redirect(backupsPage(oauth, request, "owner-only"));
  if (!oauth) return NextResponse.redirect(backupsPage(oauth, request, "not-configured"));
  const state = randomBytes(24).toString("base64url"), { verifier, challenge } = createPkcePair();
  const response = NextResponse.redirect(driveAuthUrl(oauth, { redirectUri: oauth.redirectUri, state, challenge }));
  response.cookies.set(DRIVE_STATE_COOKIE, `${state}.${verifier}.${user.id}`, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: DRIVE_COOKIE_PATH, maxAge: 600 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
