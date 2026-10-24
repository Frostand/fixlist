import { readFileSync } from 'node:fs';
import { sha256Blob } from '../capture-model';
import type { CaptureManifest, CaptureVideoAssets, CaptureVideos } from '../capture-types';

/** Synthetic lavfi portrait clip, no private media. Original 18057 bytes;
 * encoder udta removed and fast-start moov/stco sizes repaired -> 17960 bytes.
 * Real H.264, 15 samples, 1 s, 128x224, silent, identity matrix.
 */
export function syntheticVideoBytes(): Uint8Array<ArrayBuffer> { return new Uint8Array(readFileSync(new URL('./portrait.mp4', import.meta.url))); }
export async function syntheticVideoAssets(manifest: Pick<CaptureManifest, 'captureId' | 'roomId' | 'createdAt'>): Promise<CaptureVideoAssets & { videos: CaptureVideos }> {
  const blob = new Blob([syntheticVideoBytes()], { type: 'video/mp4' });
  return { videos: { format: 'fixlist-capture-videos', version: 1, captureId: manifest.captureId, roomId: manifest.roomId, clips: [{ videoId: 'v01', takenAt: manifest.createdAt, mimeType: 'video/mp4', codec: 'avc1', width: 128, height: 224, durationMs: 1000, byteLength: blob.size, sha256: await sha256Blob(blob) }] }, videoBlobs: new Map([['v01', blob]]) };
}
