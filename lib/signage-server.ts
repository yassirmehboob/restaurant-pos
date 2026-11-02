import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { MAX_IMAGE_BYTES, validateImageBytes } from "@/lib/image-upload";
import { MAX_VIDEO_BYTES, parseByteRange, type Slide } from "@/lib/signage";
import { fastStartMp4 } from "@/lib/mp4-faststart";
import { Business } from "@/models/Business";
import { Category } from "@/models/Category";
import { Deal } from "@/models/Deal";
import { Product } from "@/models/Product";
import { SignageScreen } from "@/models/SignageScreen";

export const VIDEO_BUCKET = "signage";
export const newDisplayToken = () => randomBytes(32).toString("base64url");
export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export const isDisplayToken = (value: string) => /^[\w-]{43}$/.test(value);

function bucket(name: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database is not available.");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: name });
}
export const videoBucket = () => bucket(VIDEO_BUCKET);
export const imageBucket = () => bucket("images");

// Resolves a paired display. lastSeenAt is written at most once a minute per screen.
export async function screenByToken(token: string) {
  if (!isDisplayToken(token)) return null;
  await connectToDatabase();
  const screen = await SignageScreen.findOne({ tokenHash: hashSecret(token) }).lean();
  if (!screen) return null;
  const now = new Date();
  if (!screen.lastSeenAt || now.getTime() - new Date(screen.lastSeenAt).getTime() > 60000) await SignageScreen.updateOne({ _id: screen._id }, { $set: { lastSeenAt: now } });
  return screen;
}

export async function listVideos(businessId: string) {
  await connectToDatabase();
  const files = await videoBucket().find({ "metadata.businessId": businessId }).sort({ uploadDate: -1 }).toArray();
  return files.map(file => ({ id: String(file._id), title: String(file.metadata?.title ?? file.filename), bytes: file.length, durationSeconds: Number(file.metadata?.durationSeconds) || null, uploadedAt: file.uploadDate.toISOString() }));
}

// Pictures uploaded for display screens, kept apart from product, deal and logo images.
export async function listImages(businessId: string) {
  await connectToDatabase();
  const files = await imageBucket().find({ "metadata.businessId": businessId, "metadata.kind": "signage" }).sort({ uploadDate: -1 }).toArray();
  return files.map(file => ({ id: String(file._id), title: String(file.metadata?.title ?? file.filename), bytes: file.length, uploadedAt: file.uploadDate.toISOString() }));
}

type Line = { name: string; quantity: number };
export type FeedItem = { id: string; name: string; description: string; image: string | null; price: number; prices: { name: string; price: number }[] };
export type FeedDeal = { id: string; name: string; description: string; image: string | null; price: number; items: Line[] };
export type FeedSlide =
  | { id: string; type: "BRAND"; durationSeconds: number; title: string; message: string }
  | { id: string; type: "MENU"; durationSeconds: number; title: string; groups: { title: string; items: FeedItem[] }[] }
  | { id: string; type: "DEALS"; durationSeconds: number; title: string; deals: FeedDeal[] }
  | { id: string; type: "ITEM"; durationSeconds: number; title: string; message: string; item: FeedItem }
  | { id: string; type: "IMAGE"; durationSeconds: number; title: string; image: string }
  | { id: string; type: "VIDEO"; durationSeconds: number; title: string; video: string; sound: boolean };
export type SignageFeed = { screen: { name: string; orientation: "LANDSCAPE" | "PORTRAIT"; theme: "DARK" | "LIGHT" | "WARM"; showPrices: boolean; footerText: string }; business: { name: string; logo: string | null }; slides: FeedSlide[]; version: string };

type ScreenDoc = { businessId: unknown; name: string; orientation?: string; theme?: string; showPrices?: boolean; footerText?: string | null; slides?: Slide[] };

// Turns a playlist into display data. Inactive or unavailable items, deals and missing pictures or videos are left out.
export async function buildFeed(screen: ScreenDoc, mediaUrl: (kind: "image" | "video", id: string) => string): Promise<SignageFeed> {
  const businessId = String(screen.businessId), slides = (screen.slides ?? []) as Slide[];
  await connectToDatabase();
  const [business, categories, products, deals, videos, pictures] = await Promise.all([
    Business.findOne({ _id: businessId, isActive: true }).select("name logoUrl").lean(),
    Category.find({ businessId, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    Product.find({ businessId, isActive: true, isAvailable: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    Deal.find({ businessId, isActive: true, isAvailable: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    slides.some(slide => slide.type === "VIDEO") ? listVideos(businessId) : Promise.resolve([]),
    slides.some(slide => slide.type === "IMAGE") ? listImages(businessId) : Promise.resolve([]),
  ]);
  if (!business) throw new Error("Restaurant unavailable.");
  const image = (url?: string | null) => { const id = /^\/api\/images\/([a-f\d]{24})$/i.exec(url ?? "")?.[1]; return id ? mediaUrl("image", id) : null; };
  const productMap = new Map(products.map(row => [String(row._id), row])), allProducts = new Map((await Product.find({ businessId }).select("name").lean()).map(row => [String(row._id), String(row.name)]));
  const item = (row: (typeof products)[number]): FeedItem => ({ id: String(row._id), name: String(row.name), description: String(row.description ?? ""), image: image(row.imageUrl), price: Number(row.salePrice), prices: (row.variants ?? []).map((variant: { name: string; salePrice: number }) => ({ name: variant.name, price: Number(variant.salePrice) })) });
  const deal = (row: (typeof deals)[number]): FeedDeal => ({ id: String(row._id), name: String(row.name), description: String(row.description ?? ""), image: image(row.imageUrl), price: Number(row.salePrice), items: row.items.map((line: { productId: unknown; quantity: number }) => ({ name: allProducts.get(String(line.productId)) ?? "Item", quantity: line.quantity })) });
  const videoIds = new Set(videos.map(video => video.id)), imageIds = new Set(pictures.map(picture => picture.id));
  const resolved: FeedSlide[] = [];
  for (const slide of slides) {
    const base = { id: slide.id, durationSeconds: slide.durationSeconds };
    if (slide.type === "BRAND") resolved.push({ ...base, type: "BRAND", title: slide.title || String(business.name), message: slide.message ?? "" });
    else if (slide.type === "MENU") {
      const chosen = slide.productIds?.length ? slide.productIds.map(id => productMap.get(id)).filter(row => !!row) : null;
      const groups = chosen ? [{ title: slide.title || "Our menu", items: chosen.map(item) }]
        : categories.filter(category => !slide.categoryId || String(category._id) === slide.categoryId).map(category => ({ title: slide.categoryId && slide.title ? slide.title : String(category.name), items: products.filter(row => String(row.categoryId) === String(category._id)).map(item) }));
      const filled = groups.filter(group => group.items.length);
      if (filled.length) resolved.push({ ...base, type: "MENU", title: slide.title || "Our menu", groups: filled });
    } else if (slide.type === "DEALS") {
      const chosen = (slide.dealIds?.length ? deals.filter(row => slide.dealIds.includes(String(row._id))) : deals).map(deal);
      if (chosen.length) resolved.push({ ...base, type: "DEALS", title: slide.title || "Deals", deals: chosen });
    } else if (slide.type === "ITEM") {
      const row = productMap.get(slide.productId);
      if (row) resolved.push({ ...base, type: "ITEM", title: slide.title ?? "", message: slide.message ?? "", item: item(row) });
    } else if (slide.type === "IMAGE" && imageIds.has(slide.imageId)) resolved.push({ ...base, type: "IMAGE", title: slide.title ?? "", image: mediaUrl("image", slide.imageId) });
    else if (slide.type === "VIDEO" && videoIds.has(slide.videoId)) resolved.push({ ...base, type: "VIDEO", title: slide.title ?? "", video: mediaUrl("video", slide.videoId), sound: !!slide.sound });
  }
  const feed = { screen: { name: String(screen.name), orientation: screen.orientation === "PORTRAIT" ? "PORTRAIT" as const : "LANDSCAPE" as const, theme: (["LIGHT", "WARM"].includes(String(screen.theme)) ? screen.theme : "DARK") as SignageFeed["screen"]["theme"], showPrices: screen.showPrices !== false, footerText: String(screen.footerText ?? "") }, business: { name: String(business.name), logo: image(business.logoUrl) }, slides: resolved };
  return { ...feed, version: createHash("sha1").update(JSON.stringify(feed)).digest("hex") };
}

const NO_SNIFF = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };

// Serves one restaurant's image or video. Videos support byte ranges so players can stream and loop.
export async function mediaResponse(request: Request, businessId: string, kind: string, id: string, cache: string) {
  if (!/^[a-f\d]{24}$/i.test(id) || !["image", "video"].includes(kind)) return new Response("Not found", { status: 404 });
  await connectToDatabase();
  const store = bucket(kind === "image" ? "images" : VIDEO_BUCKET), objectId = new mongoose.Types.ObjectId(id);
  const [file] = await store.find({ _id: objectId, "metadata.businessId": businessId }).limit(1).toArray();
  if (!file) return new Response("Not found", { status: 404 });
  if (kind === "image") {
    if (file.length > MAX_IMAGE_BYTES) return new Response("Image too large", { status: 413 });
    const chunks: Buffer[] = [];
    try {
      await new Promise<void>((resolve, reject) => store.openDownloadStream(objectId).on("data", (chunk: Buffer) => chunks.push(chunk)).on("end", resolve).on("error", reject));
      const buffer = Buffer.concat(chunks), type = validateImageBytes(buffer, String(file.metadata?.contentType ?? ""));
      return new Response(buffer, { headers: { "Content-Type": type, "Content-Length": String(buffer.length), "Cache-Control": cache, ...NO_SNIFF } });
    } catch { return new Response("Image unavailable", { status: 404 }); }
  }
  const size = file.length, type = String(file.metadata?.contentType ?? "");
  if (size > MAX_VIDEO_BYTES || !["video/mp4", "video/webm"].includes(type)) return new Response("Video unavailable", { status: 404 });
  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const stream = Readable.toWeb(store.openDownloadStream(objectId, { start, end: end + 1 })) as ReadableStream;
  return new Response(stream, { status: range ? 206 : 200, headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}), "Cache-Control": cache, ...NO_SNIFF } });
}

// Rewrites a stored MP4 so TVs can start it at once (index first, fragments merged). The data is
// unchanged, so a failure simply keeps the original. Returns the id of the video to use.
export async function optimizeStoredVideo(businessId: string, id: string) {
  await connectToDatabase();
  const store = videoBucket(), objectId = new mongoose.Types.ObjectId(id);
  const [file] = await store.find({ _id: objectId, "metadata.businessId": businessId }).limit(1).toArray();
  if (!file || file.metadata?.contentType !== "video/mp4" || file.metadata?.fastStart) return id;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => store.openDownloadStream(objectId).on("data", (chunk: Buffer) => chunks.push(chunk)).on("end", resolve).on("error", reject));
  let rewritten: Buffer | null = null;
  try { rewritten = fastStartMp4(Buffer.concat(chunks)); } catch { rewritten = null; }
  if (!rewritten) { await mongoose.connection.db!.collection(`${VIDEO_BUCKET}.files`).updateOne({ _id: objectId }, { $set: { "metadata.fastStart": true } }); return id; }
  const upload = store.openUploadStream(file.filename, { metadata: { ...file.metadata, fastStart: true } });
  await new Promise<void>((resolve, reject) => { upload.once("finish", () => resolve()); upload.once("error", reject); upload.end(rewritten); });
  const replacement = String(upload.id);
  await SignageScreen.updateMany({ businessId, "slides.videoId": id }, { $set: { "slides.$[slide].videoId": replacement } }, { arrayFilters: [{ "slide.videoId": id }] });
  await store.delete(objectId);
  return replacement;
}
