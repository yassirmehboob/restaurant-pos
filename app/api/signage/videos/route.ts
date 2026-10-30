import mongoose from "mongoose";
import { getCurrentUser } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { detectVideoType, MAX_VIDEO_BYTES, MAX_VIDEOS_PER_BUSINESS, VIDEO_TYPES } from "@/lib/signage";
import { optimizeStoredVideo, videoBucket } from "@/lib/signage-server";

const fail = (message: string, status: number) => Response.json({ ok: false, message }, { status });

async function write(stream: mongoose.mongo.GridFSBucketWriteStream, chunks: Buffer[]) {
  for (const chunk of chunks) if (!stream.write(chunk)) await new Promise<void>(resolve => stream.once("drain", () => resolve()));
}

// Streams the upload into the database chunk by chunk; videos are far over the 6 MB Server Action limit.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Please sign in again.", 401);
  if (user.role !== "OWNER") return fail("Only the owner can upload display videos.", 403);
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return fail("Choose a video file.", 411);
  if (declared > MAX_VIDEO_BYTES) return fail("Videos must be 100 MB or smaller.", 413);
  const claimed = String(request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(VIDEO_TYPES as readonly string[]).includes(claimed)) return fail("Upload an MP4 or WebM video.", 415);
  let title = "";
  try { title = decodeURIComponent(request.headers.get("x-video-title") ?? "").trim().slice(0, 80); } catch { /* An undecodable title falls back to the default below. */ }
  const durationSeconds = Math.max(0, Math.min(3600, Math.round(Number(request.headers.get("x-video-duration")) || 0)));
  if (!request.body) return fail("Choose a video file.", 400);
  await connectToDatabase();
  const store = videoBucket();
  if ((await store.find({ "metadata.businessId": user.businessId }).toArray()).length >= MAX_VIDEOS_PER_BUSINESS) return fail(`Delete an old video first. Up to ${MAX_VIDEOS_PER_BUSINESS} videos can be stored.`, 409);

  const reader = request.body.getReader(), pending: Buffer[] = [];
  let upload: mongoose.mongo.GridFSBucketWriteStream | null = null, received = 0;
  const abort = async (message: string, status: number) => { await reader.cancel().catch(() => {}); if (upload) await upload.abort().catch(() => {}); return fail(message, status); };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_VIDEO_BYTES) return await abort("Videos must be 100 MB or smaller.", 413);
      const chunk = Buffer.from(value);
      if (upload) { await write(upload, [chunk]); continue; }
      // Nothing is stored until the first bytes prove the file really is the declared video type.
      pending.push(chunk);
      if (received < 16) continue;
      if (detectVideoType(Buffer.concat(pending).subarray(0, 16)) !== claimed) return await abort("The file contents must be an MP4 or WebM video.", 415);
      upload = store.openUploadStream((title || "video").slice(0, 120), { metadata: { businessId: user.businessId, title: title || "Untitled video", contentType: claimed, durationSeconds: durationSeconds || null, uploadedBy: user.id } });
      await write(upload, pending.splice(0));
    }
    if (!upload) return fail("The file contents must be an MP4 or WebM video.", 415);
    const finished = upload;
    await new Promise<void>((resolve, reject) => { finished.once("finish", () => resolve()); finished.once("error", reject); finished.end(); });
    // Phone and screen-recorder MP4s are rewritten so TVs can start them without scanning the whole file.
    let videoId = String(finished.id);
    try { videoId = await optimizeStoredVideo(user.businessId, videoId); } catch { /* The original upload still plays, just more slowly. */ }
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UPLOAD_DISPLAY_VIDEO", entityType: "SignageVideo", entityId: videoId, description: `Uploaded display video ${title || "Untitled video"} (${(received / 1048576).toFixed(1)} MB)` });
    return Response.json({ ok: true, id: videoId });
  } catch { return await abort("Upload failed. Please try again.", 500); }
}
