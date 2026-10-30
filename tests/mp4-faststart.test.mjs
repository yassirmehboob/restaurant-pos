import assert from "node:assert/strict";
import test from "node:test";
import { fastStartMp4, mp4Layout } from "../lib/mp4-faststart.ts";

const u32 = (...values) => { const out = Buffer.alloc(values.length * 4); values.forEach((value, index) => out.writeUInt32BE(value >>> 0, index * 4)); return out; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]); };
const full = (type, version, flags, ...parts) => box(type, u32(((version << 24) | flags) >>> 0), ...parts);
const mvhd = (scale, duration) => full("mvhd", 0, 0, u32(0, 0, scale, duration), Buffer.alloc(80));
const tkhd = (id, duration) => full("tkhd", 0, 3, u32(0, 0, id, 0, duration), Buffer.alloc(60));
const mdhd = (scale, duration) => full("mdhd", 0, 0, u32(0, 0, scale, duration), Buffer.alloc(4));
const stsd = format => full("stsd", 0, 0, u32(1), box(format, Buffer.alloc(8)));
const emptyTables = format => [stsd(format), full("stts", 0, 0, u32(0)), full("stsc", 0, 0, u32(0)), full("stsz", 0, 0, u32(0, 0)), full("stco", 0, 0, u32(0))];
const trak = (id, scale, format, tables = emptyTables(format)) => box("trak", tkhd(id, 0), box("mdia", mdhd(scale, 0), full("hdlr", 0, 0, Buffer.alloc(20)), box("minf", box("stbl", ...tables))));
// Sample payloads carry their track and index so any mix-up is detected.
const payload = (track, index, size) => Buffer.alloc(size, track * 16 + index);

// moov + (moof + mdat) x2, video track 1 (3000/s, keyframe then deltas, with CTS offsets) and audio track 2 (all sync).
function fragmented() {
  const ftyp = box("ftyp", Buffer.from("iso5", "latin1"), u32(1), Buffer.from("iso5dash", "latin1"));
  const moov = box("moov", mvhd(1000, 0), trak(1, 3000, "avc1"), trak(2, 48000, "mp4a"), box("mvex", full("trex", 0, 0, u32(1, 1, 100, 0, 0)), full("trex", 0, 0, u32(2, 1, 1024, 0, 0))));
  const parts = [ftyp, moov];
  let fragmentIndex = 0;
  for (const [videoSizes, audioSizes] of [[[40, 10, 12], [7, 7]], [[38, 11], [7, 7, 7]]]) {
    const videoData = Buffer.concat(videoSizes.map((size, index) => payload(1, fragmentIndex * 4 + index, size)));
    const audioData = Buffer.concat(audioSizes.map((size, index) => payload(2, fragmentIndex * 4 + index, size)));
    // trun flags: data offset, first-sample flags, per-sample size and CTS offset (video); data offset + sizes (audio).
    const videoRun = offset => full("trun", 0, 0x1 | 0x4 | 0x200 | 0x800, u32(videoSizes.length, offset, 0x02000000), ...videoSizes.flatMap((size, index) => [u32(size, index === 0 ? 0 : 200)]));
    const audioRun = offset => full("trun", 0, 0x1 | 0x200, u32(audioSizes.length, offset), ...audioSizes.map(size => u32(size)));
    // tfhd: default-base-is-moof, default flags = non-sync for video so only first-sample flags mark a keyframe.
    const build = (videoOffset, audioOffset) => box("moof", full("mfhd", 0, 0, u32(fragmentIndex + 1)), box("traf", full("tfhd", 0, 0x20000 | 0x20, u32(1, 0x01010000)), full("tfdt", 0, 0, u32(0)), videoRun(videoOffset)), box("traf", full("tfhd", 0, 0x20000, u32(2)), full("tfdt", 0, 0, u32(0)), audioRun(audioOffset)));
    const size = build(0, 0).length;
    parts.push(build(size + 8, size + 8 + videoData.length), box("mdat", videoData, audioData));
    fragmentIndex++;
  }
  return Buffer.concat(parts);
}

// Minimal parser for the rewritten file.
function read(buffer) {
  const list = (start, end) => { const found = []; for (let at = start; at + 8 <= end;) { const size = buffer.readUInt32BE(at); found.push({ type: buffer.toString("latin1", at + 4, at + 8), start: at, end: at + size, body: at + 8 }); at += size; } return found; };
  const top = list(0, buffer.length), moov = top.find(item => item.type === "moov"), find = (parent, type) => list(parent.body, parent.end).find(item => item.type === type);
  const table = (stbl, type) => { const item = find(stbl, type); return item ? { version: buffer[item.body], body: item.body } : null; };
  const tracks = list(moov.body, moov.end).filter(item => item.type === "trak").map(trakBox => {
    const mdia = find(trakBox, "mdia"), stbl = find(find(mdia, "minf"), "stbl"), tk = find(trakBox, "tkhd");
    const sizes = (() => { const { body } = table(stbl, "stsz"); const count = buffer.readUInt32BE(body + 8); return Array.from({ length: count }, (_, index) => buffer.readUInt32BE(body + 12 + index * 4)); })();
    const offsets = (() => { const { body } = table(stbl, "stco"); return Array.from({ length: buffer.readUInt32BE(body + 4) }, (_, index) => buffer.readUInt32BE(body + 8 + index * 4)); })();
    const stsc = (() => { const { body } = table(stbl, "stsc"); return Array.from({ length: buffer.readUInt32BE(body + 4) }, (_, index) => [buffer.readUInt32BE(body + 8 + index * 12), buffer.readUInt32BE(body + 12 + index * 12)]); })();
    const stts = (() => { const { body } = table(stbl, "stts"); return Array.from({ length: buffer.readUInt32BE(body + 4) }, (_, index) => [buffer.readUInt32BE(body + 8 + index * 8), buffer.readUInt32BE(body + 12 + index * 8)]); })();
    const stss = table(stbl, "stss"), ctts = table(stbl, "ctts");
    const sync = stss ? Array.from({ length: buffer.readUInt32BE(stss.body + 4) }, (_, index) => buffer.readUInt32BE(stss.body + 8 + index * 4)) : null;
    // Expand chunks into absolute sample positions.
    const positions = []; let sample = 0;
    offsets.forEach((offset, chunk) => { const perChunk = [...stsc].reverse().find(([first]) => first <= chunk + 1)[1]; let at = offset; for (let index = 0; index < perChunk; index++) { positions.push(at); at += sizes[sample++]; } });
    return { id: buffer.readUInt32BE(tk.body + 12), tkhdDuration: buffer.readUInt32BE(tk.body + 20), mdhdDuration: buffer.readUInt32BE(find(mdia, "mdhd").body + 16), sizes, positions, stts, sync, hasCtts: !!ctts };
  });
  return { top: top.map(item => item.type), mvhdDuration: buffer.readUInt32BE(find(moov, "mvhd").body + 16), hasMvex: !!find(moov, "mvex"), tracks };
}

test("fragmented MP4s become fast-start files with every sample at the right bytes", () => {
  const source = fragmented();
  assert.deepEqual(mp4Layout(source), { fragmented: true, moovFirst: true, valid: true });
  const output = fastStartMp4(source), parsed = read(output);
  assert.deepEqual(parsed.top, ["ftyp", "moov", "mdat"]);
  assert.equal(parsed.hasMvex, false);
  assert.deepEqual(mp4Layout(output), { fragmented: false, moovFirst: true, valid: true });
  const [video, audio] = parsed.tracks;
  assert.deepEqual(video.sizes, [40, 10, 12, 38, 11]);
  assert.deepEqual(audio.sizes, [7, 7, 7, 7, 7]);
  // Every sample still contains its own bytes, for both tracks.
  const expect = (track, sizes, fragments) => { let index = 0; fragments.forEach((count, fragment) => { for (let n = 0; n < count; n++, index++) { const at = (track === 1 ? video : audio).positions[index]; assert.ok(output.subarray(at, at + sizes[index]).every(byte => byte === track * 16 + fragment * 4 + n), `track ${track} sample ${index}`); } }); };
  expect(1, video.sizes, [3, 2]); expect(2, audio.sizes, [2, 3]);
  assert.deepEqual(video.stts, [[5, 100]]); assert.deepEqual(audio.stts, [[5, 1024]]);
  assert.deepEqual(video.sync, [1, 4], "keyframes from first-sample flags are kept");
  assert.equal(audio.sync, null, "all-sync audio needs no sync table");
  assert.equal(video.hasCtts, true);
  assert.equal(video.mdhdDuration, 500); assert.equal(audio.mdhdDuration, 5120);
  assert.equal(video.tkhdDuration, Math.round(500 * 1000 / 3000)); assert.equal(parsed.mvhdDuration, Math.max(Math.round(500 * 1000 / 3000), Math.round(5120 * 1000 / 48000)), "the movie lasts as long as its longest track");
  assert.equal(fastStartMp4(output), null, "an already fast-start file is left alone");
});

test("an index stored after the media is moved to the front with shifted offsets", () => {
  const media = Buffer.concat([payload(1, 0, 30), payload(1, 1, 20)]);
  const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(512));
  const mdat = box("mdat", media), mediaStart = ftyp.length + 8;
  const tables = [stsd("avc1"), full("stts", 0, 0, u32(1, 2, 100)), full("stsc", 0, 0, u32(1, 1, 2, 1)), full("stsz", 0, 0, u32(0, 2, 30, 20)), full("stco", 0, 0, u32(1, mediaStart))];
  const source = Buffer.concat([ftyp, mdat, box("moov", mvhd(1000, 66), trak(1, 3000, "avc1", tables))]);
  assert.deepEqual(mp4Layout(source), { fragmented: false, moovFirst: false, valid: true });
  const output = fastStartMp4(source), parsed = read(output), [video] = parsed.tracks;
  assert.deepEqual(parsed.top, ["ftyp", "moov", "mdat"]);
  assert.ok(output.subarray(video.positions[0], video.positions[0] + 30).every(byte => byte === 16));
  assert.ok(output.subarray(video.positions[1], video.positions[1] + 20).every(byte => byte === 17));
  assert.equal(output.length, source.length, "nothing is added or lost");
});

test("files the rewriter cannot use are returned unchanged", () => {
  assert.equal(fastStartMp4(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), null, "WebM is not an MP4");
  assert.throws(() => fastStartMp4(Buffer.concat([u32(4000), Buffer.from("ftyp", "latin1"), Buffer.alloc(10)])), /Damaged MP4/);
});
