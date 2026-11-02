import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_IMAGE_BYTES, validateImageBytes } from "@/lib/image-upload";

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** UPLOADS_DIRECTORY in .env, kept outside the project so updates never touch it; defaults to a sibling restaurant-pos-uploads folder. */
export const uploadsRoot = () => path.resolve(/* turbopackIgnore: true */ process.env.UPLOADS_DIRECTORY || path.join(/* turbopackIgnore: true */ process.cwd(), "..", "restaurant-pos-uploads"));

/** Resolves a path stored relative to the uploads folder and refuses anything outside it. */
function absolutePhotoPath(relative: string) {
  const root = uploadsRoot(), absolute = path.resolve(/* turbopackIgnore: true */ root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Invalid photo path.");
  return absolute;
}

/** Saves to {uploads}/{businessId}/staff_photo and returns the path (relative to the uploads folder) stored on the staff record. */
export async function saveStaffPhoto(file: File | null | undefined, businessId: string) {
  if (!file || !(file instanceof File) || file.size === 0) return undefined;
  if (!/^[a-f\d]{24}$/i.test(businessId)) throw new Error("Invalid business.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Photo must be 5 MB or smaller.");
  const buffer = Buffer.from(await file.arrayBuffer()), contentType = validateImageBytes(buffer, file.type);
  const folder = path.join(businessId, "staff_photo");
  const relative = path.join(folder, `${randomUUID()}.${EXTENSIONS[contentType]}`).split(path.sep).join("/");
  const absolute = absolutePhotoPath(relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer, { flag: "wx" });
  return relative;
}

export async function readStaffPhoto(relative: string) {
  const buffer = await readFile(absolutePhotoPath(relative));
  return { buffer, contentType: validateImageBytes(buffer, typeFromExtension(relative)) };
}

export async function deleteStaffPhoto(relative: string | null | undefined) {
  if (!relative) return;
  await unlink(absolutePhotoPath(relative)).catch(() => {});
}

function typeFromExtension(relative: string) {
  const ext = path.extname(relative).slice(1).toLowerCase();
  return Object.keys(EXTENSIONS).find(type => EXTENSIONS[type] === ext) ?? "";
}
