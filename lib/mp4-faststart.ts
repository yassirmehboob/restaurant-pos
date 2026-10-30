// Rewrites MP4 files so playback can start immediately: the index (moov) goes first and
// fragmented files (moof/mdat pairs from phones, screen recorders and streaming tools) become
// one ordinary sample table. Video and audio data are copied byte for byte; nothing is re-encoded.

type Box = { type: string; start: number; end: number; body: number };

function boxes(buffer: Buffer, start = 0, end = buffer.length): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset), header = 8;
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (size === 1) { if (offset + 16 > end) break; size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
    else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new Error(`Damaged MP4 box ${type}.`);
    found.push({ type, start: offset, end: offset + size, body: offset + header });
    offset += size;
  }
  return found;
}
const child = (buffer: Buffer, parent: Box, type: string, skip = 0) => boxes(buffer, parent.body + skip, parent.end).find(item => item.type === type);
const children = (buffer: Buffer, parent: Box, type: string, skip = 0) => boxes(buffer, parent.body + skip, parent.end).filter(item => item.type === type);

function box(type: string, ...parts: Buffer[]) {
  const body = Buffer.concat(parts), header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8); header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}
function fullBox(type: string, version: number, flags: number, ...parts: Buffer[]) {
  const head = Buffer.alloc(4); head.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff));
  return box(type, head, ...parts);
}
function uints(values: number[]) { const out = Buffer.alloc(values.length * 4); values.forEach((value, index) => out.writeUInt32BE(value >>> 0, index * 4)); return out; }
const raw = (buffer: Buffer, item: Box) => buffer.subarray(item.start, item.end);

type Sample = { offset: number; size: number; duration: number; sync: boolean; cto: number };
type Run = { track: number; samples: Sample[] };

// MP4 layout facts needed to decide whether a rewrite helps.
export function mp4Layout(buffer: Buffer) {
  const top = boxes(buffer), moov = top.findIndex(item => item.type === "moov"), mdat = top.findIndex(item => item.type === "mdat");
  return { fragmented: top.some(item => item.type === "moof"), moovFirst: moov >= 0 && (mdat < 0 || moov < mdat), valid: moov >= 0 && mdat >= 0 };
}

// Returns null when the file is already fast-start (or is not something this rewriter understands).
export function fastStartMp4(buffer: Buffer): Buffer | null {
  if (buffer.length < 16 || buffer.toString("latin1", 4, 8) !== "ftyp") return null;
  const top = boxes(buffer), ftyp = top.find(item => item.type === "ftyp"), moov = top.find(item => item.type === "moov");
  if (!ftyp || !moov || !top.some(item => item.type === "mdat")) return null;
  const layout = mp4Layout(buffer);
  if (layout.fragmented) return defragment(buffer, ftyp, moov, top);
  if (!layout.moovFirst) return moveIndexFirst(buffer, ftyp, moov, top);
  return null;
}

// Ordinary MP4 with its index after the media: move moov before mdat and shift every chunk offset.
function moveIndexFirst(buffer: Buffer, ftyp: Box, moov: Box, top: Box[]) {
  const media = top.filter(item => item.type === "mdat");
  const moovCopy = Buffer.from(raw(buffer, moov));
  const shift = (moovCopy: Buffer, delta: number) => {
    for (const trak of children(moovCopy, boxes(moovCopy)[0], "trak")) {
      const stbl = path(moovCopy, trak, ["mdia", "minf", "stbl"]);
      if (!stbl) continue;
      for (const table of boxes(moovCopy, stbl.body, stbl.end)) {
        if (table.type === "stco") { const count = moovCopy.readUInt32BE(table.body + 4); for (let index = 0; index < count; index++) { const at = table.body + 8 + index * 4, next = moovCopy.readUInt32BE(at) + delta; if (next > 0xffffffff) throw new Error("Use co64"); moovCopy.writeUInt32BE(next, at); } }
        if (table.type === "co64") { const count = moovCopy.readUInt32BE(table.body + 4); for (let index = 0; index < count; index++) { const at = table.body + 8 + index * 8; moovCopy.writeBigUInt64BE(moovCopy.readBigUInt64BE(at) + BigInt(delta), at); } }
      }
    }
  };
  // New layout: ftyp, moov, then every mdat in original order. Media moves by (moov size + ftyp end - first mdat start).
  const firstMedia = media[0].start, delta = (ftyp.end - ftyp.start) + moovCopy.length - firstMedia;
  const between = top.filter(item => item.start >= firstMedia && item.type !== "moov");
  if (between.some(item => item.type !== "mdat" && item.type !== "free" && item.type !== "skip")) return null;
  shift(moovCopy, delta);
  return Buffer.concat([raw(buffer, ftyp), moovCopy, buffer.subarray(firstMedia, Math.max(...between.map(item => item.end)))]);
}

function path(buffer: Buffer, from: Box, types: string[]) {
  let current: Box | undefined = from;
  for (const type of types) { current = current && child(buffer, current, type); if (!current) return undefined; }
  return current;
}

function defragment(buffer: Buffer, ftyp: Box, moov: Box, top: Box[]) {
  const mvhd = child(buffer, moov, "mvhd");
  if (!mvhd) return null;
  const movieScale = buffer.readUInt32BE(mvhd.body + (buffer[mvhd.body] === 1 ? 20 : 12));
  const defaults = new Map<number, { duration: number; size: number; flags: number }>();
  const mvex = child(buffer, moov, "mvex");
  for (const trex of mvex ? children(buffer, mvex, "trex") : []) defaults.set(buffer.readUInt32BE(trex.body + 4), { duration: buffer.readUInt32BE(trex.body + 12), size: buffer.readUInt32BE(trex.body + 16), flags: buffer.readUInt32BE(trex.body + 20) });

  // Read every fragment's sample runs in file order.
  const runs: Run[] = [];
  for (const moof of top.filter(item => item.type === "moof")) {
    for (const traf of children(buffer, moof, "traf")) {
      const tfhd = child(buffer, traf, "tfhd");
      if (!tfhd) return null;
      const flags = buffer.readUInt32BE(tfhd.body) & 0xffffff, track = buffer.readUInt32BE(tfhd.body + 4), fallback = defaults.get(track) ?? { duration: 0, size: 0, flags: 0 };
      let at = tfhd.body + 8, base = moof.start;
      if (flags & 0x1) { base = Number(buffer.readBigUInt64BE(at)); at += 8; }
      if (flags & 0x2) at += 4;
      const duration = flags & 0x8 ? buffer.readUInt32BE((at += 4) - 4) : fallback.duration;
      const size = flags & 0x10 ? buffer.readUInt32BE((at += 4) - 4) : fallback.size;
      const sampleFlags = flags & 0x20 ? buffer.readUInt32BE(at) : fallback.flags;
      let next = base;
      for (const trun of children(buffer, traf, "trun")) {
        const head = buffer.readUInt32BE(trun.body), version = head >>> 24, runFlags = head & 0xffffff, count = buffer.readUInt32BE(trun.body + 4);
        let cursor = trun.body + 8;
        if (runFlags & 0x1) { next = base + buffer.readInt32BE(cursor); cursor += 4; }
        let firstFlags: number | null = null;
        if (runFlags & 0x4) { firstFlags = buffer.readUInt32BE(cursor); cursor += 4; }
        const samples: Sample[] = [];
        for (let index = 0; index < count; index++) {
          const sampleDuration = runFlags & 0x100 ? buffer.readUInt32BE((cursor += 4) - 4) : duration;
          const sampleSize = runFlags & 0x200 ? buffer.readUInt32BE((cursor += 4) - 4) : size;
          const flagsHere = runFlags & 0x400 ? buffer.readUInt32BE((cursor += 4) - 4) : index === 0 && firstFlags !== null ? firstFlags : sampleFlags;
          const cto = runFlags & 0x800 ? (version === 0 ? buffer.readUInt32BE((cursor += 4) - 4) : buffer.readInt32BE((cursor += 4) - 4)) : 0;
          if (next + sampleSize > buffer.length) throw new Error("MP4 sample data is missing.");
          samples.push({ offset: next, size: sampleSize, duration: sampleDuration, sync: !(flagsHere & 0x10000), cto });
          next += sampleSize;
        }
        if (samples.length) runs.push({ track, samples });
      }
    }
  }
  if (!runs.length) return null;

  const traks = children(buffer, moov, "trak");
  const trackIds = new Map(traks.map(trak => { const tkhd = child(buffer, trak, "tkhd")!; return [buffer.readUInt32BE(tkhd.body + (buffer[tkhd.body] === 1 ? 20 : 12)), trak] as const; }));
  const mediaBytes = runs.reduce((sum, run) => sum + run.samples.reduce((total, sample) => total + sample.size, 0), 0);

  // Builds the sample table for one track; chunk offsets are relative to the start of the new media data.
  const stblFor = (trak: Box, track: number, mediaStart: number) => {
    const own = runs.filter(run => run.track === track), all = own.flatMap(run => run.samples);
    const stbl = path(buffer, trak, ["mdia", "minf", "stbl"])!, stsd = child(buffer, stbl, "stsd")!;
    const rle = (values: number[]) => { const out: number[][] = []; for (const value of values) { const last = out.at(-1); if (last && last[1] === value) last[0]++; else out.push([1, value]); } return out; };
    const stts = rle(all.map(sample => sample.duration)), ctts = all.some(sample => sample.cto) ? rle(all.map(sample => sample.cto)) : null, negative = all.some(sample => sample.cto < 0);
    const sync = all.every(sample => sample.sync) ? null : all.flatMap((sample, index) => sample.sync ? [index + 1] : []);
    const stsc: number[][] = []; own.forEach((run, index) => { const last = stsc.at(-1); if (!last || last[1] !== run.samples.length) stsc.push([index + 1, run.samples.length, 1]); });
    let offset = mediaStart;
    const chunkOffsets: number[] = [];
    for (const run of runs) { if (run.track === track) chunkOffsets.push(offset); offset += run.samples.reduce((total, sample) => total + sample.size, 0); }
    const wide = chunkOffsets.some(value => value > 0xffffffff);
    const tables = [
      raw(buffer, stsd),
      fullBox("stts", 0, 0, uints([stts.length, ...stts.flat()])),
      ...(ctts ? [fullBox("ctts", negative ? 1 : 0, 0, uints([ctts.length, ...ctts.flat()]))] : []),
      ...(sync ? [fullBox("stss", 0, 0, uints([sync.length, ...sync]))] : []),
      fullBox("stsc", 0, 0, uints([stsc.length, ...stsc.flat()])),
      fullBox("stsz", 0, 0, uints([0, all.length, ...all.map(sample => sample.size)])),
      wide ? fullBox("co64", 0, 0, uints([chunkOffsets.length]), Buffer.concat(chunkOffsets.map(value => { const out = Buffer.alloc(8); out.writeBigUInt64BE(BigInt(value)); return out; }))) : fullBox("stco", 0, 0, uints([chunkOffsets.length, ...chunkOffsets])),
    ];
    return { stbl: box("stbl", ...tables), duration: all.reduce((sum, sample) => sum + sample.duration, 0) };
  };

  // Rebuilds moov without mvex, with real durations and the new sample tables.
  const buildMoov = (mediaStart: number) => {
    let movieDuration = 0;
    const rebuilt = boxes(buffer, moov.body, moov.end).flatMap(item => {
      if (item.type === "mvex") return [];
      if (item.type !== "trak") return [raw(buffer, item)];
      const track = [...trackIds.entries()].find(([, trak]) => trak.start === item.start)?.[0];
      if (track === undefined || !runs.some(run => run.track === track)) return [];
      const mdhd = path(buffer, item, ["mdia", "mdhd"])!, mediaScale = buffer.readUInt32BE(mdhd.body + (buffer[mdhd.body] === 1 ? 20 : 12));
      const { stbl, duration } = stblFor(item, track, mediaStart);
      const movieTime = Math.round(duration * movieScale / mediaScale);
      movieDuration = Math.max(movieDuration, movieTime);
      return [rebuildTrak(buffer, item, stbl, duration, movieTime)];
    });
    const mvhdCopy = Buffer.from(raw(buffer, mvhd)), mvhdBody = mvhdCopy.readUInt32BE(0) === 1 ? 16 : 8;
    setDuration(mvhdCopy, mvhdBody, movieDuration);
    return box("moov", ...rebuilt.map(part => part.equals(raw(buffer, mvhd)) ? mvhdCopy : part));
  };

  // Offsets depend on moov size, and moov size depends on offset width; two passes settle it.
  const mdatHeader = (size: number) => { if (size + 8 <= 0xffffffff) { const out = Buffer.alloc(8); out.writeUInt32BE(size + 8); out.write("mdat", 4, "latin1"); return out; } const out = Buffer.alloc(16); out.writeUInt32BE(1); out.write("mdat", 4, "latin1"); out.writeBigUInt64BE(BigInt(size + 16), 8); return out; };
  const head = raw(buffer, ftyp), header = mdatHeader(mediaBytes);
  let moovOut = buildMoov(0);
  moovOut = buildMoov(head.length + moovOut.length + header.length);
  const media = Buffer.concat(runs.flatMap(run => run.samples.map(sample => buffer.subarray(sample.offset, sample.offset + sample.size))));
  return Buffer.concat([head, moovOut, header, media]);
}

// Writes a duration into a copied mvhd/tkhd/mdhd box (version 0: 32-bit, version 1: 64-bit).
function setDuration(copy: Buffer, body: number, duration: number) {
  const version = copy[body], at = body + (version === 1 ? 4 + 8 + 8 + 4 : 4 + 4 + 4 + 4);
  if (version === 1) copy.writeBigUInt64BE(BigInt(duration), at); else copy.writeUInt32BE(Math.min(duration, 0xffffffff), at);
}

function rebuildTrak(buffer: Buffer, trak: Box, stbl: Buffer, mediaDuration: number, movieDuration: number): Buffer {
  const parts = boxes(buffer, trak.body, trak.end).map(item => {
    if (item.type === "tkhd") {
      const copy = Buffer.from(raw(buffer, item)), body = copy.readUInt32BE(0) === 1 ? 16 : 8, version = copy[body];
      // tkhd keeps track_ID between creation/modification time and duration.
      const at = body + (version === 1 ? 4 + 8 + 8 + 4 + 4 : 4 + 4 + 4 + 4 + 4);
      if (version === 1) copy.writeBigUInt64BE(BigInt(movieDuration), at); else copy.writeUInt32BE(Math.min(movieDuration, 0xffffffff), at);
      return copy;
    }
    if (item.type === "edts") return editList(buffer, item, movieDuration);
    if (item.type !== "mdia") return raw(buffer, item);
    return box("mdia", ...boxes(buffer, item.body, item.end).map(inner => {
      if (inner.type === "mdhd") { const copy = Buffer.from(raw(buffer, inner)); setDuration(copy, copy.readUInt32BE(0) === 1 ? 16 : 8, mediaDuration); return copy; }
      if (inner.type !== "minf") return raw(buffer, inner);
      return box("minf", ...boxes(buffer, inner.body, inner.end).map(part => part.type === "stbl" ? stbl : raw(buffer, part)));
    }));
  });
  return box("trak", ...parts);
}

// Fragmented files often use a zero-length edit meaning "the whole track"; give it the real length.
function editList(buffer: Buffer, edts: Box, movieDuration: number) {
  const copy = Buffer.from(raw(buffer, edts)), elst = boxes(copy, 8, copy.length).find(item => item.type === "elst");
  if (!elst) return copy;
  const version = copy[elst.body], count = copy.readUInt32BE(elst.body + 4);
  for (let index = 0, at = elst.body + 8; index < count; index++, at += version === 1 ? 20 : 12) {
    if (version === 1) { if (copy.readBigUInt64BE(at) === BigInt(0)) copy.writeBigUInt64BE(BigInt(movieDuration), at); }
    else if (copy.readUInt32BE(at) === 0) copy.writeUInt32BE(Math.min(movieDuration, 0xffffffff), at);
  }
  return copy;
}
