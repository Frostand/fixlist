import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Blob, validateNativeCaptureResult } from './capture-model';
import { parseCaptureBundle, buildCaptureBundle } from './capture-bundle';
import { createMemoryCaptureStore } from './capture-storage';
import { validateCaptureVideos, validateCaptureVideoBlob } from './capture-video';
import { validateMp4 } from './mp4-validator';
import type { CaptureVideos } from './capture-types';
import fixture from '../../scan/tests/capture-parity/valid-bundle.json';

const bytes = new Uint8Array(readFileSync(new URL('./__fixtures__/portrait.mp4', import.meta.url)));
async function data() {
  const parsed = await parseCaptureBundle(JSON.stringify(fixture));
  if (!parsed.ok) throw new Error(parsed.error);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const videos: CaptureVideos = { format: 'fixlist-capture-videos', version: 1, captureId: parsed.value.manifest.captureId, roomId: parsed.value.manifest.roomId, clips: [{ videoId: 'v01', takenAt: parsed.value.manifest.createdAt, mimeType: 'video/mp4', codec: 'avc1', width: 128, height: 224, durationMs: 1000, byteLength: blob.size, sha256: await sha256Blob(blob) }] };
  return { ...parsed.value, blob, videos, videoBlobs: new Map([['v01', blob]]) };
}
function mutate(type: string, offset: number, value: number): Uint8Array<ArrayBuffer> {
  const b = bytes.slice(), index = Buffer.from(b).indexOf(type);
  new DataView(b.buffer).setUint32(index + offset, value); return b;
}
describe('local capture video contract and real synthetic MP4', () => {
  it.each([
    ['native-180x320.mp4', 180, 320, 2067],
    ['native-720x1280.mp4', 720, 1280, 1200],
  ] as const)('accepts production AVAssetWriter output %s, including extended-size mdat', async (file, width, height, durationMs) => {
    const d = await data();
    // Public synthetic pixel buffers encoded by the actual CaptureVideoWriter.
    const blob = new Blob([readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url))], { type: 'video/mp4' });
    const clip = { ...d.videos.clips[0], width, height, durationMs, byteLength: blob.size, sha256: await sha256Blob(blob) };
    validateMp4(new Uint8Array(await blob.arrayBuffer()), clip);
    await validateCaptureVideoBlob(blob, clip);
  });
  it('rejects altered chroma extensions and a movie extending beyond its actual samples', async () => {
    const d = await data();
    const original = new Uint8Array(readFileSync(new URL('./__fixtures__/native-180x320.mp4', import.meta.url)));
    const badChroma = original.slice(), shortChroma = original.slice(), longerMovie = original.slice();
    const chroma = Buffer.from(original).indexOf('chrm');
    badChroma[chroma + 5] = 1;
    new DataView(shortChroma.buffer).setUint32(chroma - 4, 9);
    const movie = new DataView(longerMovie.buffer);
    for (const [type, offset] of [['mvhd', 20], ['tkhd', 24], ['elst', 12]] as const) {
      movie.setUint32(Buffer.from(original).indexOf(type) + offset, 1241);
    }
    for (const bytes of [badChroma, shortChroma, longerMovie]) {
      const blob = new Blob([bytes], { type: 'video/mp4' });
      const clip = { ...d.videos.clips[0], width: 180, height: 320, durationMs: bytes === longerMovie ? 2069 : 2067, byteLength: blob.size, sha256: await sha256Blob(blob) };
      await expect(validateCaptureVideoBlob(blob, clip)).rejects.toThrow();
    }
  });
  it('accepts a real silent portrait AVC clip and normalizes photo-only records', async () => {
    const d = await data(), store = createMemoryCaptureStore();
    expect(validateCaptureVideos(d.videos, d.manifest).ok).toBe(true);
    await validateCaptureVideoBlob(d.blob, d.videos.clips[0]);
    await store.writeCapture(d.manifest, d.photos);
    expect(await store.read(d.manifest.roomId)).toMatchObject({ videos: null, videoBlobs: new Map() });
    await store.writeCapture(d.manifest, d.photos, true, undefined, d.manifest.captureId, d);
    expect((await store.read(d.manifest.roomId))?.videos).toEqual(d.videos);
  });
  it('rejects forged sidecars and exact file union/path violations', async () => {
    const d = await data(), clip = d.videos.clips[0];
    for (const bad of [{ ...d.videos, extra: 1 }, { ...d.videos, captureId: 'cap-other-room-001' }, { ...d.videos, roomId: 'hallway' }, { ...d.videos, clips: [] }, { ...d.videos, clips: [clip, clip] }, ...[{ videoId: 'v02' }, { width: 127 }, { width: 226 }, { height: 1282 }, { durationMs: 999 }, { durationMs: 30001 }, { byteLength: 12582913 }, { sha256: clip.sha256.toUpperCase() }, { takenAt: '2026-02-30T00:00:00Z' }, { codec: 'hvc1' }].map(change => ({ ...d.videos, clips: [{ ...clip, ...change }] }))]) expect(validateCaptureVideos(bad, d.manifest).ok).toBe(false);
    const prefix = `file:///var/app/Library/Caches/fixlist-captures/${d.manifest.captureId}/`;
    const files = { ...Object.fromEntries(d.manifest.photos.map(p => [p.photoId, `${prefix}${p.photoId}.jpg`])), v01: `${prefix}v01.mp4` };
    expect(validateNativeCaptureResult({ ...d.manifest, videos: d.videos, files }).ok).toBe(true);
    for (const path of ['v01.jpg', 'nested/v01.mp4', '../v01.mp4', './v01.mp4', '%76%30%31.mp4', '%2e%2e/v01.mp4', 'v01.mp4?x', 'v01.mp4#x', 'v01.mp4?', 'v01.mp4#', 'v01.mp4/']) expect(validateNativeCaptureResult({ ...d.manifest, videos: d.videos, files: { ...files, v01: prefix + path } }).ok).toBe(false);
    for (const path of [prefix.replace('file:///', 'file://localhost/') + 'v01.mp4', prefix.replace('file:///', 'file:/') + 'v01.mp4', prefix.replace('/var/app/', '/var/other/') + 'v01.mp4']) expect(validateNativeCaptureResult({ ...d.manifest, videos: d.videos, files: { ...files, v01: path } }).ok).toBe(false);
    expect(validateNativeCaptureResult({ ...d.manifest, files }).ok).toBe(false);
    expect(validateNativeCaptureResult({ ...d.manifest, videos: d.videos, files: { ...files, p01: prefix + 'wrong.jpg' } }).ok).toBe(false);
  });
  it('rejects malformed, truncated, audio, fragmented and external-reference structures despite matching hashes', async () => {
    const d = await data();
    const audio = bytes.slice(); audio.set(new TextEncoder().encode('soun'), Buffer.from(audio).indexOf('vide'));
    const fragment = bytes.slice(); fragment.set(new TextEncoder().encode('moof'), Buffer.from(fragment).indexOf('free'));
    const metadata = new Uint8Array(8); new DataView(metadata.buffer).setUint32(0, 8); metadata.set(new TextEncoder().encode('udta'), 4);
    const track = bytes.slice(148, 940), extraTrack = new Uint8Array(bytes.length + track.length);
    extraTrack.set(bytes.slice(0, 940)); extraTrack.set(track, 940); extraTrack.set(bytes.slice(940), 940 + track.length); new DataView(extraTrack.buffer).setUint32(32, 908 + track.length);
    const bads = [bytes.slice(0, 32), bytes.slice(0, -1), audio, fragment, extraTrack, new Uint8Array([...bytes, ...metadata]), mutate('moov', -4, bytes.length + 1), mutate('mdat', 0, 0x66726565), mutate('url ', 4, 0), mutate('stco', 12, 8), mutate('stsc', 16, 2), mutate('stts', 16, 512), mutate('stsz', 12, 9999999), mutate('avcC', 4, 0), mutate('tkhd', 44, 0), mutate('mvhd', 40, 0)];
    for (const b of bads) { const blob = new Blob([b], { type: 'video/mp4' }); await expect(validateCaptureVideoBlob(blob, { ...d.videos.clips[0], byteLength: blob.size, sha256: await sha256Blob(blob) })).rejects.toThrow(); }
  });
  it('snapshots assets before queued writes and rejects replacements atomically', async () => {
    const d = await data(), store = createMemoryCaptureStore();
    const writing = store.writeCapture(d.manifest, d.photos, false, undefined, null, d);
    const expected = structuredClone(d.videos); d.videos.roomId = 'hallway'; d.videoBlobs.clear(); await writing;
    expect((await store.read(d.manifest.roomId))?.videos).toEqual(expected);
    const good = await data();
    for (const assets of [{ ...good, videoBlobs: new Map() }, { ...good, videos: null }, { ...good, videoBlobs: new Map([['other', good.blob]]) }, { ...good, videoBlobs: new Map([['v01', good.blob], ['other', good.blob]]) }, { ...good, videoBlobs: new Map([['v01', new Blob(['forged'], { type: 'video/mp4' })]]) }]) await expect(store.writeCapture(good.manifest, good.photos, true, undefined, good.manifest.captureId, assets)).rejects.toThrow();
    await expect(store.writeCapture(good.manifest, good.photos, true, undefined, 'cap-stale-identity', good)).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    expect((await store.read(d.manifest.roomId))?.videos).toEqual(expected);
    const exported = JSON.parse((await buildCaptureBundle(d.manifest, d.photos)).text);
    expect(exported).toEqual(fixture); expect(exported).not.toHaveProperty('videos');
  });
  it('counts clip and sidecar bytes in capacity and deletes/replaces the whole record', async () => {
    const d = await data(), photoBytes = [...d.photos.values()].reduce((s, b) => s + b.size, 0), budget = photoBytes + new Blob([JSON.stringify(d.manifest), 'null']).size;
    const store = createMemoryCaptureStore(budget); await store.writeCapture(d.manifest, d.photos);
    await expect(store.writeCapture(d.manifest, d.photos, true, undefined, d.manifest.captureId, d)).rejects.toMatchObject({ code: 'CAPACITY' });
    expect((await store.read(d.manifest.roomId))?.videos).toBeNull();
    const exact = budget + d.blob.size + new Blob([JSON.stringify(d.videos)]).size;
    await expect(createMemoryCaptureStore(exact - 1).writeCapture(d.manifest, d.photos, false, undefined, null, d)).rejects.toMatchObject({ code: 'CAPACITY' });
    await expect(createMemoryCaptureStore(exact).writeCapture(d.manifest, d.photos, false, undefined, null, d)).resolves.toBeUndefined();
    const roomy = createMemoryCaptureStore(); await roomy.writeCapture(d.manifest, d.photos, false, undefined, null, d);
    await roomy.writeCapture(d.manifest, d.photos, true); expect((await roomy.read(d.manifest.roomId))?.videoBlobs?.size).toBe(0);
    await roomy.writeCapture(d.manifest, d.photos, true, undefined, undefined, d); await roomy.remove(d.manifest.roomId, d.manifest.captureId); expect(await roomy.read(d.manifest.roomId)).toBeNull();
  });
});
