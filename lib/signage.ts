import { z } from "zod";

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEOS_PER_BUSINESS = 30;
export const MAX_SCREENS_PER_BUSINESS = 10;
export const MAX_SLIDES = 40;
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;
export const SLIDE_TYPES = ["BRAND", "MENU", "DEALS", "ITEM", "VIDEO"] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];
export const SLIDE_LABELS: Record<SlideType, string> = { BRAND: "Logo & message", MENU: "Menu items", DEALS: "Deals", ITEM: "Featured item", VIDEO: "Video" };
export const THEMES = ["DARK", "LIGHT", "WARM"] as const;
export const ORIENTATIONS = ["LANDSCAPE", "PORTRAIT"] as const;
// Items and deals shown per page; longer lists continue on further pages of the same slide.
export const PAGE_SIZES = { LANDSCAPE: { items: 8, deals: 3 }, PORTRAIT: { items: 8, deals: 3 } } as const;

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const text = (max: number) => z.string().trim().max(max).default("");
export const slideSchema = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  type: z.enum(SLIDE_TYPES),
  durationSeconds: z.number().int().min(3, "Show each slide for at least 3 seconds.").max(300, "Show each slide for at most 5 minutes."),
  title: text(60),
  message: text(160),
  categoryId: z.union([z.literal(""), objectId]).default(""),
  productIds: z.array(objectId).max(40).default([]),
  dealIds: z.array(objectId).max(20).default([]),
  productId: z.union([z.literal(""), objectId]).default(""),
  videoId: z.union([z.literal(""), objectId]).default(""),
  sound: z.boolean().default(false),
}).superRefine((slide, ctx) => {
  if (slide.type === "ITEM" && !slide.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Choose the featured item." });
  if (slide.type === "VIDEO" && !slide.videoId) ctx.addIssue({ code: "custom", path: ["videoId"], message: "Choose a video for each video slide." });
});
export type Slide = z.infer<typeof slideSchema>;

export const screenSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a screen name.").max(40),
  orientation: z.enum(ORIENTATIONS),
  theme: z.enum(THEMES),
  showPrices: z.boolean(),
  footerText: text(140),
  slides: z.array(slideSchema).max(MAX_SLIDES, `A screen can have at most ${MAX_SLIDES} slides.`),
});
export type ScreenSettings = z.infer<typeof screenSettingsSchema>;

export function detectVideoType(bytes: Uint8Array): (typeof VIDEO_TYPES)[number] | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

// Parses a single HTTP byte range. Returns null when absent, "invalid" when unsatisfiable.
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  let start: number, end: number;
  if (!match[1]) { start = Math.max(size - Number(match[2]), 0); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  return start > end || start >= size ? "invalid" : { start, end };
}

export function pages<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
