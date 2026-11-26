import type { CapturePhoto } from './capture-types';
import { usableRoomPhotoCamera, worldToPixel, type Vec3 } from './room-geometry';

export const ROOM_TEXTURE_LIMIT = 12;
export const ROOM_TEXTURE_EDGE = 1024;
export const PHOTO_FRAME_DEPTH = 0.5;
export interface PhotoSurface { vertices: readonly Vec3[]; normal: Vec3 }

/** Texture UVs have their origin at the bottom left; saved upright JPEG pixels start at the top left. */
export function worldToPhotoUv(photo: CapturePhoto, point: Vec3): readonly [number, number] | null {
  const pixel = worldToPixel(photo, point);
  return pixel ? [pixel.u / photo.width, 1 - pixel.v / photo.height] : null;
}

const mean = (points: readonly Vec3[]): Vec3 => [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis]!, 0) / points.length) as unknown as Vec3;

/** Sample inside each tile, so corners lying exactly on a photo edge do not dominate coverage. */
export function surfacePhotoScore(photo: CapturePhoto, surface: PhotoSurface): number {
  if (!photo.camera || !surface.vertices.length) return 0;
  const centre = mean(surface.vertices), m = photo.camera.transform;
  const dx = m[12]! - centre[0], dy = m[13]! - centre[1], dz = m[14]! - centre[2], distance = Math.hypot(dx, dy, dz);
  const incidence = (dx * surface.normal[0] + dy * surface.normal[1] + dz * surface.normal[2]) / distance;
  if (!Number.isFinite(incidence) || incidence <= 0.03) return 0;
  const samples: Vec3[] = [centre, ...surface.vertices.map((p): Vec3 => [p[0] * .85 + centre[0] * .15, p[1] * .85 + centre[1] * .15, p[2] * .85 + centre[2] * .15])];
  let coverage = 0;
  for (const sample of samples) {
    const uv = worldToPhotoUv(photo, sample);
    if (uv && uv.every((v) => v >= 0 && v <= 1)) coverage++;
  }
  return coverage / samples.length * (.25 + .75 * incidence) / (1 + distance * .015) * (photo.camera.tracking === 'normal' ? 1 : .6);
}

export function rankSurfacePhotos(photos: readonly CapturePhoto[], surface: PhotoSurface): CapturePhoto[] {
  return photos.map((photo, index) => ({ photo, index, score: surfacePhotoScore(photo, surface) }))
    .filter((p) => p.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map((p) => p.photo);
}

/** Greedy coverage gain, then pose/view diversity. Never decode the other saved photos for the scene. */
export function selectRoomTexturePhotos(photos: readonly CapturePhoto[], urls: ReadonlyMap<string, string>, floorY: number, surfaces: readonly PhotoSurface[]): CapturePhoto[] {
  const ids = new Set<string>();
  const candidates = photos.filter((photo) => {
    if (ids.has(photo.photoId) || !urls.get(photo.photoId) || !usableRoomPhotoCamera(photo, floorY)) return false;
    ids.add(photo.photoId); return true;
  });
  if (candidates.length <= ROOM_TEXTURE_LIMIT) return candidates;
  const scores = candidates.map((photo) => surfaces.map((surface) => surfacePhotoScore(photo, surface)));
  const covered = surfaces.map(() => 0), selected: number[] = [];
  while (selected.length < ROOM_TEXTURE_LIMIT) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (selected.includes(i)) continue;
      const m = candidates[i]!.camera!.transform;
      const diversity = selected.length ? Math.min(...selected.map((j) => {
        const n = candidates[j]!.camera!.transform;
        const distance = Math.min(3, Math.hypot(m[12]! - n[12]!, m[13]! - n[13]!, m[14]! - n[14]!)) / 3;
        const facing = (1 - (m[8]! * n[8]! + m[9]! * n[9]! + m[10]! * n[10]!)) / 2;
        return distance + facing;
      })) : 0;
      const gain = scores[i]!.reduce((sum, score, k) => sum + Math.max(0, score - covered[k]!), 0) + .025 * diversity;
      if (gain > bestScore) { bestScore = gain; best = i; }
    }
    selected.push(best);
    scores[best]!.forEach((score, k) => { covered[k] = Math.max(covered[k]!, score); });
  }
  return selected.map((i) => candidates[i]!);
}

/** Top-left, top-right, bottom-right, bottom-left, in the original capture world frame. */
export function roomPhotoFrameCorners(photo: CapturePhoto, floorY: number, depth = PHOTO_FRAME_DEPTH): readonly Vec3[] | null {
  const camera = usableRoomPhotoCamera(photo, floorY);
  if (!camera) return null;
  const m = camera.transform, [fx, fy, cx, cy] = camera.intrinsics;
  return [[0, 0], [photo.width, 0], [photo.width, photo.height], [0, photo.height]].map(([u, v]): Vec3 => {
    const x = (u! - cx) / fx * depth, y = (cy - v!) / fy * depth;
    return [m[12]! + m[0]! * x + m[4]! * y - m[8]! * depth, m[13]! + m[1]! * x + m[5]! * y - m[9]! * depth, m[14]! + m[2]! * x + m[6]! * y - m[10]! * depth];
  });
}

export function roomTextureSize(width: number, height: number): readonly [number, number] {
  const scale = Math.min(1, ROOM_TEXTURE_EDGE / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** A bounded screen-space search. Dense nonselected labels defer to the accessible photo list. */
export function layoutRoomMarkers(markers: readonly { id: string; x: number; y: number; priority: number }[], width: number, height: number, diameter: number): Map<string, readonly [number, number]> {
  const result = new Map<string, readonly [number, number]>();
  const offsets = [[0, 0], [0, -30], [30, 0], [-30, 0], [0, 30], [30, -30], [-30, -30], [30, 30], [-30, 30]];
  for (const marker of [...markers].sort((a, b) => b.priority - a.priority)) {
    for (const [dx, dy] of offsets) {
      const x = marker.x + dx!, y = marker.y + dy!;
      if (x < diameter || x > width - diameter || y < diameter || y > height - diameter) continue;
      if ([...result.values()].some((p) => Math.hypot(x - p[0], y - p[1]) < diameter + 5)) continue;
      result.set(marker.id, [x, y]); break;
    }
  }
  return result;
}
