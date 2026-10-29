import "server-only";
import type { NextRequest } from "next/server";
import type { DriveOAuthConfig } from "./backup-drive.mjs";

export const DRIVE_STATE_COOKIE = "rpos_drive_oauth";
export const DRIVE_COOKIE_PATH = "/api/backups/google";

// Return to the same origin as the registered redirect URI, so the state cookie is sent back.
export function backupsPage(oauth: DriveOAuthConfig | null, request: NextRequest, notice: string) {
  const origin = oauth ? new URL(oauth.redirectUri).origin : request.nextUrl.origin;
  return new URL(`/settings/backups?drive=${encodeURIComponent(notice)}`, origin);
}
