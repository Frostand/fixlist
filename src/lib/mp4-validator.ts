import { MAX_CAPTURE_VIDEO_BYTES, type CaptureVideo } from './capture-types';
import { avcConfiguration } from './mp4-avc';

interface Box { type: string; start: number; data: number; end: number }
const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
/** Strict nonfragmented, self-contained AVC subset emitted by the room recorder.
 * Bounds: <=12 MiB input, 4096 boxes, 450 samples, bounded table lengths. Unknown
 * boxes fail closed, including descriptive/location metadata and track references.
 * This verifies container/sample structure, not full H.264 decodability or camera provenance.
 */
export function validateMp4(bytes: Uint8Array, clip: CaptureVideo): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (message = 'Invalid or unsupported room MP4 structure.'): never => { throw new Error(message); };
  const require = (condition: unknown, message?: string): void => { if (!condition) fail(message); };
  const u16 = (at: number) => view.getUint16(at);
  const u32 = (at: number) => view.getUint32(at);
  const u64 = (at: number) => { const n = u32(at) * 2 ** 32 + u32(at + 4); require(Number.isSafeInteger(n)); return n; };
  const word = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let boxCount = 0;
  function boxes(start: number, end: number, allowed: readonly string[]): Box[] {
    const result: Box[] = [];
    while (start < end) {
      require(++boxCount <= 4096 && end - start >= 8);
      const size = u32(start), type = word(start + 4), header = size === 1 ? 16 : 8;
      require(end - start >= header);
      const length = size === 1 ? u64(start + 8) : size;
      require(length >= header && length <= end - start && allowed.includes(type), `Unsupported or malformed MP4 box: ${type}.`);
      result.push({ type, start, data: start + header, end: start + length }); start += length;
    }
    require(start === end); return result;
  }
  function one(list: Box[], type: string): Box { const found = list.filter(b => b.type === type); require(found.length === 1); return found[0]!; }
  function optional(list: Box[], type: string): Box | undefined { const found = list.filter(b => b.type === type); require(found.length <= 1); return found[0]; }
  const children = (b: Box, allowed: readonly string[]) => boxes(b.data, b.end, allowed);
  function full(b: Box, min: number, versions = [0]): number {
    require(b.end - b.data >= min && versions.includes(bytes[b.data]!));
    const flags = u32(b.data) & 0xffffff;
    require(b.type === 'tkhd' ? flags <= 15 : b.type === 'vmhd' ? flags === 1 : flags === 0);
    return bytes[b.data]!;
  }
  function table(b: Box, stride: number, max: number, versions = [0]): number {
    full(b, 8, versions); const count = u32(b.data + 4); require(count > 0 && count <= max && b.end - b.data === 8 + count * stride); return count;
  }
  function matrix(at: number) { identity.forEach((n, i) => require(u32(at + i * 4) === n, 'Room video must have an identity playback transform.')); }
  function timing(b: Box): { scale: number; duration: number } {
    const version = full(b, 24, [0, 1]), at = b.data + (version ? 20 : 12);
    require(b.end >= at + (version ? 12 : 8)); const scale = u32(at), duration = version ? u64(at + 4) : u32(at + 4);
    require(scale > 0 && duration / scale >= 1 && duration / scale <= 30, 'Room video must last 1–30 seconds.'); return { scale, duration };
  }
  require(bytes.length === clip.byteLength && bytes.length <= MAX_CAPTURE_VIDEO_BYTES);
  const top = boxes(0, bytes.length, ['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide']);
  const ftyp = one(top, 'ftyp'); require(ftyp.start === 0 && ftyp.end - ftyp.data >= 8 && (ftyp.end - ftyp.data) % 4 === 0);
  const brands: string[] = [word(ftyp.data)]; for (let at = ftyp.data + 8; at < ftyp.end; at += 4) brands.push(word(at));
  require(brands.some(b => ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'qt  '].includes(b)));
  const mdat = one(top, 'mdat'); require(mdat.end > mdat.data);
  const moov = children(one(top, 'moov'), ['mvhd', 'trak', 'free']);
  const mvhd = one(moov, 'mvhd'), movie = timing(mvhd), mv1 = bytes[mvhd.data] === 1;
  require(mvhd.end - mvhd.data === (mv1 ? 112 : 100)); matrix(mvhd.data + (mv1 ? 48 : 36));
  require(Math.ceil(movie.duration / movie.scale * 1000) === clip.durationMs, 'Room video duration does not match its sidecar.');
  const trak = children(one(moov, 'trak'), ['tkhd', 'mdia', 'edts', 'free']);
  const tkhd = one(trak, 'tkhd'), tk1 = full(tkhd, 84, [0, 1]) === 1;
  require(tkhd.end - tkhd.data === (tk1 ? 96 : 84));
  const trackDuration = tk1 ? u64(tkhd.data + 28) : u32(tkhd.data + 20);
  require(trackDuration === movie.duration && u32(tkhd.data + (tk1 ? 20 : 12)) > 0);
  matrix(tkhd.data + (tk1 ? 52 : 40));
  require(u32(tkhd.end - 8) === clip.width * 65536 && u32(tkhd.end - 4) === clip.height * 65536, 'Room video dimensions do not match its sidecar.');
  const mdia = children(one(trak, 'mdia'), ['mdhd', 'hdlr', 'minf', 'free']);
  const media = timing(one(mdia, 'mdhd')), hdlr = one(mdia, 'hdlr'); full(hdlr, 24);
  require(word(hdlr.data + 8) === 'vide', 'Room video must have exactly one video track and no audio.');
  const minf = children(one(mdia, 'minf'), ['vmhd', 'dinf', 'stbl', 'hdlr', 'free']);
  full(one(minf, 'vmhd'), 12);
  const dref = one(children(one(minf, 'dinf'), ['dref']), 'dref'); full(dref, 8); require(u32(dref.data + 4) === 1);
  const url = one(boxes(dref.data + 8, dref.end, ['url ']), 'url ');
  require(url.end - url.data === 4 && u32(url.data) === 1, 'Room video cannot reference external media.');
  const stbl = children(one(minf, 'stbl'), ['stsd', 'stts', 'stsc', 'stsz', 'stco', 'co64', 'stss', 'ctts', 'sdtp', 'free']);
  const stsd = one(stbl, 'stsd'); full(stsd, 8); require(u32(stsd.data + 4) === 1);
  const avc = one(boxes(stsd.data + 8, stsd.end, ['avc1']), 'avc1'); require(avc.end - avc.data >= 78);
  require(u16(avc.data + 6) === 1 && u16(avc.data + 24) === clip.width && u16(avc.data + 26) === clip.height && u16(avc.data + 40) === 1);
  const configs = boxes(avc.data + 78, avc.end, ['avcC', 'pasp', 'colr', 'clap', 'btrt', 'fiel', 'chrm']);
  const avcC = one(configs, 'avcC'), config = avcConfiguration(bytes.subarray(avcC.data, avcC.end));
  require(config.width === clip.width && config.height === clip.height, 'H.264 dimensions do not match the room video.');
  const pasp = optional(configs, 'pasp'); if (pasp) require(pasp.end - pasp.data === 8 && u32(pasp.data) > 0 && u32(pasp.data) === u32(pasp.data + 4));
  const clap = optional(configs, 'clap'); if (clap) require(clap.end - clap.data === 32 && u32(clap.data + 4) > 0 && u32(clap.data + 12) > 0 && u32(clap.data) / u32(clap.data + 4) === clip.width && u32(clap.data + 8) / u32(clap.data + 12) === clip.height && u32(clap.data + 16) === 0 && u32(clap.data + 24) === 0);
  const colr = optional(configs, 'colr'); if (colr) require(['nclc', 'nclx'].includes(word(colr.data)) && colr.end - colr.data === (word(colr.data) === 'nclx' ? 11 : 10));
  const btrt = optional(configs, 'btrt'); if (btrt) require(btrt.end - btrt.data === 12);
  const fiel = optional(configs, 'fiel'); if (fiel) require(fiel.end - fiel.data === 2 && bytes[fiel.data] === 1);
  // AVAssetWriter emits this two-byte chroma-location extension. Accept only
  // the zero-valued form produced by our progressive H.264 recorder.
  const chrm = optional(configs, 'chrm'); if (chrm) require(chrm.end - chrm.data === 2 && u16(chrm.data) === 0);
  const stsz = one(stbl, 'stsz'); full(stsz, 12);
  const fixedSize = u32(stsz.data + 4), sampleCount = u32(stsz.data + 8);
  require(sampleCount > 0 && sampleCount <= 450 && stsz.end - stsz.data === 12 + (fixedSize ? 0 : sampleCount * 4));
  const sizes = Array.from({ length: sampleCount }, (_, i) => fixedSize || u32(stsz.data + 12 + i * 4)); require(sizes.every(n => n > 0));
  const stts = one(stbl, 'stts'), timeCount = table(stts, 8, sampleCount), deltas: number[] = [];
  for (let i = 0; i < timeCount; i++) {
    const at = stts.data + 8 + i * 8, count = u32(at), delta = u32(at + 4);
    require(count > 0 && deltas.length + count <= sampleCount && delta * 15 >= media.scale, 'Room video exceeds 15 frames per second.');
    for (let j = 0; j < count; j++) deltas.push(delta);
  }
  require(deltas.length === sampleCount && deltas.reduce((a, b) => a + b, 0) === media.duration);
  const ctts = optional(stbl, 'ctts'), offsets = new Array<number>(sampleCount).fill(0);
  if (ctts) {
    const count = table(ctts, 8, sampleCount, [0, 1]); let sample = 0;
    for (let i = 0; i < count; i++) { const at = ctts.data + 8 + i * 8, n = u32(at), offset = bytes[ctts.data] ? view.getInt32(at + 4) : u32(at + 4); require(n > 0 && sample + n <= sampleCount); for (let j = 0; j < n; j++) offsets[sample++] = offset; }
    require(sample === sampleCount);
  }
  let decodeTime = 0;
  const presentation = deltas.map((delta, i) => { const start = decodeTime + offsets[i]!; decodeTime += delta; return { start, end: start + delta }; }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < presentation.length; i++) require((presentation[i]!.start - presentation[i - 1]!.start) * 15 >= media.scale, 'Room video presentation rate exceeds 15 fps.');
  let mediaStart = 0;
  const edts = optional(trak, 'edts');
  if (edts) {
    const elst = one(children(edts, ['elst']), 'elst'), version = full(elst, 8, [0, 1]);
    require(table(elst, version ? 20 : 12, 1, [0, 1]) === 1);
    const at = elst.data + 8, duration = version ? u64(at) : u32(at), timeAt = at + (version ? 8 : 4);
    mediaStart = version ? u64(timeAt) : view.getInt32(timeAt);
    require(duration === movie.duration && mediaStart >= 0 && u32(timeAt + (version ? 8 : 4)) === 65536);
  }
  // Compare integer clock ticks exactly: 1240 / 600 * 600 can round above
  // 1240 and falsely reject an AVAssetWriter clip whose final sample ends there.
  const coversMovie = BigInt(presentation.at(-1)!.end - mediaStart) * BigInt(movie.scale) >= BigInt(movie.duration) * BigInt(media.scale);
  require(presentation[0]!.start <= mediaStart && coversMovie && (presentation.at(-1)!.end - presentation[0]!.start) / media.scale <= 30);
  const stss = optional(stbl, 'stss'); if (stss) { const count = table(stss, 4, sampleCount); let previous = 0; for (let i = 0; i < count; i++) { const n = u32(stss.data + 8 + i * 4); require(n > previous && n <= sampleCount); previous = n; } require(u32(stss.data + 8) === 1); }
  const sdtp = optional(stbl, 'sdtp'); if (sdtp) { full(sdtp, 4); require(sdtp.end - sdtp.data === 4 + sampleCount); }
  const stco = optional(stbl, 'stco'), co64 = optional(stbl, 'co64'); require(!!stco !== !!co64);
  const chunks = (stco ?? co64)!, stride = co64 ? 8 : 4, chunkCount = table(chunks, stride, sampleCount);
  const stsc = one(stbl, 'stsc'), mapCount = table(stsc, 12, chunkCount);
  const mappings = Array.from({ length: mapCount }, (_, i) => { const at = stsc.data + 8 + i * 12; return { first: u32(at), count: u32(at + 4), description: u32(at + 8) }; });
  mappings.forEach((m, i) => require(m.first >= 1 && m.first <= chunkCount && (i ? m.first > mappings[i - 1]!.first : m.first === 1) && m.count > 0 && m.count <= sampleCount && m.description === 1));
  let sample = 0, mapping = 0, nalCount = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < chunkCount; i++) {
    while (mapping + 1 < mappings.length && mappings[mapping + 1]!.first <= i + 1) mapping++;
    let at = co64 ? u64(chunks.data + 8 + i * stride) : u32(chunks.data + 8 + i * stride); const start = at;
    require(sample + mappings[mapping]!.count <= sampleCount);
    for (let j = 0; j < mappings[mapping]!.count; j++) {
      const end = at + sizes[sample++]!; require(at >= mdat.data && end <= mdat.end);
      let hasPicture = false, hasIdr = false;
      while (at < end) {
        require(++nalCount <= 16384);
        require(at + config.nalLength <= end); let length = 0;
        for (let k = 0; k < config.nalLength; k++) length = length * 256 + bytes[at++]!;
        require(length > 0 && length <= end - at);
        const type = bytes[at]! & 31; require(!(bytes[at]! & 128) && [1, 5, 6, 9, 12].includes(type));
        hasPicture ||= type === 1 || type === 5; hasIdr ||= type === 5; at += length;
      }
      require(at === end && hasPicture && (sample !== 1 || hasIdr), 'Room video must begin with a self-contained keyframe.');
    }
    ranges.push({ start, end: at });
  }
  require(sample === sampleCount);
  ranges.sort((a, b) => a.start - b.start);
  ranges.forEach((range, i) => require(i === 0 || range.start >= ranges[i - 1]!.end));
}
