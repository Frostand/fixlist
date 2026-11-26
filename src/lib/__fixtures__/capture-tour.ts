import bundle from '../../../scan/tests/capture-parity/valid-bundle.json';
import type { CaptureManifest, CaptureTour } from '../capture-types';
import { sha256Blob } from '../capture-model';
import type { StoredCapture } from '../capture-storage';
import type { AIReview, VisionHazard } from '../vision-hazards';
/** Header-only panorama for contract tests; rendered QA uses a real generated JPEG. */
export async function tourFixture(withPhotos = false): Promise<StoredCapture> {
  const bytes = Uint8Array.from(atob(bundle.photos[0]!.jpeg), c => c.charCodeAt(0));
  for (let at = 2; at < bytes.length - 8; at++) if (bytes[at] === 255 && bytes[at + 1] === 192) { bytes[at + 5] = 8; bytes[at + 6] = 0; bytes[at + 7] = 16; bytes[at + 8] = 0; break; }
  const blob = new Blob([bytes], { type: 'image/jpeg' }), sha256 = await sha256Blob(blob);
  const tour: CaptureTour = { format: 'fixlist-room-tour', version: 1, stops: [
    { stopId: 's1', position: [0, 1.5, 0], panorama: { fileId: 'pano-s1', width: 4096, height: 2048, sha256, coverage: 0.85 }, capturedAt: bundle.createdAt },
    { stopId: 's2', position: [1, 1.5, -2], panorama: { fileId: 'pano-s2', width: 4096, height: 2048, sha256, coverage: 1 }, capturedAt: bundle.createdAt },
  ] };
  const manifest: CaptureManifest = { ...bundle, tour, photos: withPhotos ? bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) : [] } as unknown as CaptureManifest;
  return { manifest, photos: new Map(withPhotos ? bundle.photos.map(p => [p.photoId, new Blob([Uint8Array.from(atob(p.jpeg), c => c.charCodeAt(0))], { type: 'image/jpeg' })]) : []),
    flags: null, panoramaBlobs: new Map([['pano-s1', blob], ['pano-s2', blob]]), aiReview: null };
}
export const visionModel = { id: 'synthetic-vision', license: 'Synthetic test fixture', bytes: 100_000_000 };
export const visionHazard: VisionHazard = { label: 'Cord across the path', detail: 'A cord crosses the walking route.', tip: 'Ask someone to move the cord away from the path.', category: 'trip', severity: 'high', box: { x: 0.4, y: 0.5, w: 0.2, h: 0.2 }, direction: [0, -0.3, -Math.sqrt(0.91)], thumbnail: null };
export function reviewFixture(capture: CaptureManifest): AIReview {
  return { format: 'fixlist-ai-review', version: 1, captureId: capture.captureId, roomId: capture.roomId, createdAt: capture.createdAt,
    sources: [...(capture.tour?.stops ?? []).map(s => ({ kind: 'panorama' as const, id: s.stopId, sha256: s.panorama.sha256, model: visionModel.id, hazards: [visionHazard] })),
      ...capture.photos.map(p => ({ kind: 'photo' as const, id: p.photoId, sha256: p.sha256, model: visionModel.id, hazards: [visionHazard] }))] };
}
