"use server";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { MAX_SCREENS_PER_BUSINESS, ORIENTATIONS, screenSettingsSchema } from "@/lib/signage";
import { hashSecret, listVideos, newDisplayToken, videoBucket } from "@/lib/signage-server";
import { Category } from "@/models/Category";
import { Deal } from "@/models/Deal";
import { Product } from "@/models/Product";
import { SignagePairing } from "@/models/SignagePairing";
import { SignageScreen } from "@/models/SignageScreen";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const message = (error: unknown, fallback: string) => error instanceof z.ZodError ? error.issues[0]?.message ?? fallback : error instanceof Error && error.constructor === Error ? error.message : fallback;
async function owner() {
  const user = await requireUser();
  if (user.role !== "OWNER") throw new Error("Only the owner can manage display screens.");
  await connectToDatabase();
  return user;
}

export async function loadSignage() {
  const user = await owner();
  const [screens, videos, categories, products, deals] = await Promise.all([
    SignageScreen.find({ businessId: user.businessId }).sort({ createdAt: 1 }).lean(),
    listVideos(user.businessId),
    Category.find({ businessId: user.businessId, isActive: true }).sort({ sortOrder: 1, name: 1 }).select("name").lean(),
    Product.find({ businessId: user.businessId, isActive: true }).sort({ sortOrder: 1, name: 1 }).select("name categoryId").lean(),
    Deal.find({ businessId: user.businessId, isActive: true }).sort({ sortOrder: 1, name: 1 }).select("name").lean(),
  ]);
  return {
    screens: screens.map(screen => ({
      id: String(screen._id), name: String(screen.name), orientation: (screen.orientation ?? "LANDSCAPE") as "LANDSCAPE" | "PORTRAIT", theme: (screen.theme ?? "DARK") as "DARK" | "LIGHT" | "WARM",
      showPrices: screen.showPrices !== false, footerText: String(screen.footerText ?? ""), paired: !!screen.tokenHash,
      pairedAt: screen.pairedAt ? new Date(screen.pairedAt).toISOString() : null, lastSeenAt: screen.lastSeenAt ? new Date(screen.lastSeenAt).toISOString() : null,
      // Decided once on the server so the page renders the same status during hydration.
      online: !!screen.tokenHash && !!screen.lastSeenAt && Date.now() - new Date(screen.lastSeenAt).getTime() < 3 * 60_000,
      slides: (screen.slides ?? []).map((slide: Record<string, unknown>) => ({ id: String(slide.id), type: slide.type as never, durationSeconds: Number(slide.durationSeconds), title: String(slide.title ?? ""), message: String(slide.message ?? ""), categoryId: String(slide.categoryId ?? ""), productIds: (slide.productIds as string[] | undefined) ?? [], dealIds: (slide.dealIds as string[] | undefined) ?? [], productId: String(slide.productId ?? ""), videoId: String(slide.videoId ?? ""), sound: !!slide.sound })),
    })),
    videos,
    categories: categories.map(row => ({ id: String(row._id), name: String(row.name) })),
    products: products.map(row => ({ id: String(row._id), name: String(row.name), categoryId: String(row.categoryId) })),
    deals: deals.map(row => ({ id: String(row._id), name: String(row.name) })),
  };
}
export type SignageData = Awaited<ReturnType<typeof loadSignage>>;

// A new screen starts with the logo, the full menu and all deals, so it shows something useful at once.
export async function createScreen(name: string, orientation: string) {
  try {
    const user = await owner();
    const clean = z.string().trim().min(1, "Enter a screen name.").max(40).parse(name), layout = z.enum(ORIENTATIONS).parse(orientation);
    if (await SignageScreen.countDocuments({ businessId: user.businessId }) >= MAX_SCREENS_PER_BUSINESS) throw new Error(`Up to ${MAX_SCREENS_PER_BUSINESS} display screens can be added.`);
    const slide = (type: string, durationSeconds: number) => ({ id: new mongoose.Types.ObjectId().toString(), type, durationSeconds, title: "", message: "", categoryId: "", productIds: [], dealIds: [], productId: "", videoId: "", sound: false });
    const screen = await SignageScreen.create({ businessId: user.businessId, name: clean, orientation: layout, slides: [slide("BRAND", 8), slide("MENU", 12), slide("DEALS", 12)] });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "CREATE_DISPLAY_SCREEN", entityType: "SignageScreen", entityId: String(screen._id), description: `Added display screen ${clean}` });
    revalidatePath("/settings/signage");
    return { ok: true as const, id: String(screen._id) };
  } catch (error) { return { ok: false as const, message: message(error, "Could not add the screen.") }; }
}

export async function saveScreen(screenId: string, raw: unknown) {
  try {
    const user = await owner(); id.parse(screenId);
    const settings = screenSettingsSchema.parse(raw);
    const updated = await SignageScreen.updateOne({ _id: screenId, businessId: user.businessId }, { $set: settings });
    if (!updated.matchedCount) throw new Error("Screen not found.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UPDATE_DISPLAY_SCREEN", entityType: "SignageScreen", entityId: screenId, description: `Updated display screen ${settings.name} (${settings.slides.length} slides)` });
    revalidatePath("/settings/signage");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not save the screen.") }; }
}

export async function deleteScreen(screenId: string) {
  try {
    const user = await owner(); id.parse(screenId);
    const screen = await SignageScreen.findOneAndDelete({ _id: screenId, businessId: user.businessId }).lean();
    if (!screen) throw new Error("Screen not found.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "DELETE_DISPLAY_SCREEN", entityType: "SignageScreen", entityId: screenId, description: `Removed display screen ${screen.name}` });
    revalidatePath("/settings/signage");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not remove the screen.") }; }
}

// Links the TV showing this code to a screen. A screen has one TV; pairing a new one disconnects the old.
export async function pairScreen(screenId: string, code: string) {
  try {
    const user = await owner(); id.parse(screenId);
    const clean = String(code ?? "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(clean)) throw new Error("Enter the 6-digit code shown on the display.");
    if (!(await allowAuthAttempt("display-code:" + user.id, 20))) throw new Error("Too many attempts. Wait five minutes and try again.");
    const screen = await SignageScreen.findOne({ _id: screenId, businessId: user.businessId }).lean();
    if (!screen) throw new Error("Screen not found.");
    const token = newDisplayToken();
    const pairing = await SignagePairing.findOneAndUpdate({ code: clean, status: "PENDING", expiresAt: { $gt: new Date() } }, { $set: { status: "APPROVED", token, businessId: user.businessId, screenId } }, { returnDocument: "after" }).lean();
    if (!pairing) throw new Error("That code was not found or has expired. Check the code on the display.");
    await SignageScreen.updateOne({ _id: screenId }, { $set: { tokenHash: hashSecret(token), pairedAt: new Date() }, $unset: { lastSeenAt: "" } });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "PAIR_DISPLAY_SCREEN", entityType: "SignageScreen", entityId: screenId, description: `Connected a display device to ${screen.name}` });
    revalidatePath("/settings/signage");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not connect the display.") }; }
}

export async function disconnectScreen(screenId: string) {
  try {
    const user = await owner(); id.parse(screenId);
    const screen = await SignageScreen.findOneAndUpdate({ _id: screenId, businessId: user.businessId }, { $unset: { tokenHash: "", pairedAt: "", lastSeenAt: "" } }).lean();
    if (!screen) throw new Error("Screen not found.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UNPAIR_DISPLAY_SCREEN", entityType: "SignageScreen", entityId: screenId, description: `Disconnected the display device from ${screen.name}` });
    revalidatePath("/settings/signage");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not disconnect the display.") }; }
}

export async function deleteVideo(videoId: string) {
  try {
    const user = await owner(); id.parse(videoId);
    const store = videoBucket(), objectId = new mongoose.Types.ObjectId(videoId);
    const [file] = await store.find({ _id: objectId, "metadata.businessId": user.businessId }).limit(1).toArray();
    if (!file) throw new Error("Video not found.");
    await store.delete(objectId);
    // Screens skip the removed video instead of showing a blank slide.
    await SignageScreen.updateMany({ businessId: user.businessId }, { $pull: { slides: { type: "VIDEO", videoId } } });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "DELETE_DISPLAY_VIDEO", entityType: "SignageVideo", entityId: videoId, description: `Deleted display video ${file.metadata?.title ?? file.filename}` });
    revalidatePath("/settings/signage");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not delete the video.") }; }
}
