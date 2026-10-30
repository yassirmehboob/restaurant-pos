import assert from "node:assert/strict";
import test from "node:test";
import { detectVideoType, pages, parseByteRange, screenSettingsSchema, slideSchema } from "../lib/signage.ts";

test("videos are recognised by their contents, not their name", () => {
  const mp4 = Buffer.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0, 2, 0]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  assert.equal(detectVideoType(mp4), "video/mp4");
  assert.equal(detectVideoType(webm), "video/webm");
  assert.equal(detectVideoType(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(detectVideoType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0])), null, "a PNG is not a video");
});

test("byte ranges let TVs stream, seek and loop videos", () => {
  assert.equal(parseByteRange(null, 1000), null);
  assert.deepEqual(parseByteRange("bytes=0-", 1000), { start: 0, end: 999 });
  assert.deepEqual(parseByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 }, "an end past the file is clamped");
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 }, "suffix range");
  for (const bad of ["bytes=1000-", "bytes=500-100", "bytes=-", "items=0-1", "bytes=0-1,5-9"]) assert.equal(parseByteRange(bad, 1000), "invalid", bad);
});

test("long menus continue over several pages", () => {
  assert.deepEqual(pages([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(pages([], 8), []);
});

test("playlists are validated on the server", () => {
  const slide = { id: "a1", type: "MENU", durationSeconds: 12 };
  assert.deepEqual(slideSchema.parse(slide).productIds, []);
  const fails = patch => !slideSchema.safeParse({ ...slide, ...patch }).success;
  assert.ok(fails({ durationSeconds: 2 }) && fails({ durationSeconds: 301 }) && fails({ durationSeconds: 4.5 }));
  assert.ok(fails({ type: "VIDEO" }), "a video slide needs a video");
  assert.ok(fails({ type: "ITEM" }), "a featured slide needs an item");
  assert.ok(fails({ type: "SCRIPT" }));
  assert.ok(fails({ categoryId: "not-an-id" }) && fails({ productIds: ["$where"] }));
  assert.ok(fails({ id: "<script>" }));
  const screen = { name: "Counter", orientation: "LANDSCAPE", theme: "DARK", showPrices: true, footerText: "", slides: [slide] };
  assert.ok(screenSettingsSchema.safeParse(screen).success);
  assert.ok(!screenSettingsSchema.safeParse({ ...screen, theme: "NEON" }).success);
  assert.ok(!screenSettingsSchema.safeParse({ ...screen, slides: Array.from({ length: 41 }, (_, index) => ({ ...slide, id: `s${index}` })) }).success);
});
