import type { CaptureManifest, CaptureTourStop, SketchFlag } from './capture-types';
import { pixelToWorldRay, type Vec3 } from './room-geometry';
import type { AIReview, VisionHazard } from './vision-hazards';
export const normalizeDirection = (v: Vec3): Vec3 | null => { const n = Math.hypot(...v); return Number.isFinite(n) && n > 1e-6 ? [v[0] / n, v[1] / n, v[2] / n] : null; };
/** Pixel centres follow the native stitcher convention, including the half pixel. */
export function equirectToDirection(u: number, v: number, width = 4096, height = 2048): Vec3 {
  const lambda = ((u + 0.5) / width - 0.5) * 2 * Math.PI, phi = (0.5 - (v + 0.5) / height) * Math.PI;
  return [Math.sin(lambda) * Math.cos(phi), Math.sin(phi), -Math.cos(lambda) * Math.cos(phi)];
}
export function directionToEquirect(direction: Vec3, width = 4096, height = 2048): { u: number; v: number } | null {
  const d = normalizeDirection(direction); if (!d) return null;
  return { u: (Math.atan2(d[0], -d[2]) / (2 * Math.PI) + 0.5) * width - 0.5, v: (0.5 - Math.asin(Math.max(-1, Math.min(1, d[1]))) / Math.PI) * height - 0.5 };
}
/** Ground target is the destination's X/Z, on the captured floor rather than at eye height. */
export function stopArrowPosition(from: CaptureTourStop, to: CaptureTourStop, floorY: number | null): Vec3 | null {
  if (Math.hypot(to.position[0] - from.position[0], to.position[2] - from.position[2]) < 0.15) return null;
  return [to.position[0], floorY === null ? from.position[1] - 1.3 : floorY + 0.03, to.position[2]];
}
export function photoPointDirection(capture: CaptureManifest, stop: CaptureTourStop, photoId: string, point: { u: number; v: number }): Vec3 | null {
  const photo = capture.photos.find(p => p.photoId === photoId), ray = photo && pixelToWorldRay(photo, point); if (!ray) return null;
  const floorDistance = capture.floorY !== null && ray.direction[1] < -1e-5 ? (capture.floorY - ray.origin[1]) / ray.direction[1] : -1;
  const distance = floorDistance >= 0.2 && floorDistance <= 15 ? floorDistance : 2;
  return normalizeDirection(ray.origin.map((v, i) => v + ray.direction[i]! * distance - stop.position[i]!) as unknown as Vec3);
}
export interface TourHazard extends VisionHazard { id: string; sourceId: string; kind: 'photo' | 'panorama' | 'flag'; direction: Vec3 | null }
export function tourHazards(capture: CaptureManifest, review: AIReview | null | undefined, flags: readonly SketchFlag[], stop: CaptureTourStop): TourHazard[] {
  const result: TourHazard[] = [];
  for (const source of review?.sources ?? []) for (const [index, hazard] of source.hazards.entries()) {
    if (source.kind === 'panorama' && source.id !== stop.stopId) continue;
    const photo = capture.photos.find(p => p.photoId === source.id);
    const box = hazard.box;
    const direction = source.kind === 'panorama' ? hazard.direction : photo && box
      ? photoPointDirection(capture, stop, photo.photoId, { u: Math.min(photo.width - 1, (box.x + box.w / 2) * photo.width), v: Math.min(photo.height - 1, (box.y + box.h / 2) * photo.height) }) : null;
    result.push({ ...hazard, id: `ai-${source.kind}-${source.id}-${index}`, sourceId: source.id, kind: source.kind, direction });
  }
  for (const flag of flags) result.push({ id: flag.id, sourceId: flag.photoId, kind: 'flag', label: flag.label, detail: '', tip: '', category: 'other', severity: 'medium', box: null, thumbnail: null,
    direction: flag.point ? photoPointDirection(capture, stop, flag.photoId, flag.point) : null });
  return result;
}
