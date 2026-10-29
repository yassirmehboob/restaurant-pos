import "server-only";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as Runtime from "./backups.mjs";

// Keep runtime filesystem inspection outside the dev bundler. Otherwise changes
// to the inspected directories (including dev output/logs) can trigger reloads.
const runtime = (): Promise<typeof Runtime> => import(
  /* webpackIgnore: true */ /* turbopackIgnore: true */
  pathToFileURL(path.join(/* turbopackIgnore: true */ process.cwd(), "lib", "backups.mjs")).href
);

export async function backupRoot() { return (await runtime()).backupRoot(); }
export async function listBusinessBackups(businessId: string) { return (await runtime()).listBusinessBackups(businessId); }
export async function readBackupFile(businessId: string, id: string) { return (await runtime()).readBackupFile(businessId, id); }
export async function validateBackupId(id: string) { return (await runtime()).validateBackupId(id); }
