import { describe, expect, it } from 'vitest';
import type { CapturePhoto } from './capture-types';
import { pixelToWorldRay } from './room-geometry';
import { layoutRoomMarkers, rankSurfacePhotos, roomPhotoFrameCorners, roomTextureSize, selectRoomTexturePhotos, surfacePhotoScore, worldToPhotoUv, type PhotoSurface } from './room-photo-projection';

const photo = (photoId = 'p01', x = 0): CapturePhoto => ({
  photoId, checklistItemId: null, takenAt: '2026-10-25T12:00:00Z', width: 1200, height: 1600, sha256: '0'.repeat(64),
  camera: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 1.5, 2, 1], intrinsics: [1000, 1000, 600, 800], tracking: 'normal' },
});
const wall: PhotoSurface = { vertices: [[-.5, 1, 0], [.5, 1, 0], [.5, 2, 0], [-.5, 2, 0]], normal: [0, 0, 1] };

describe('photo texture projection', () => {
  it('round trips an off-centre saved JPEG pixel through the ARKit ray into bottom-left texture UV', () => {
    const p = photo(), point = { u: 300, v: 1200 }, ray = pixelToWorldRay(p, point)!;
    const world = ray.origin.map((n, i) => n + ray.direction[i]! * 3) as [number, number, number];
    const uv = worldToPhotoUv(p, world)!;
    expect(uv[0]).toBeCloseTo(.25, 12); expect(uv[1]).toBeCloseTo(.25, 12);
    expect(worldToPhotoUv(p, [0, 1.5, 3])).toBeNull();
    expect(worldToPhotoUv(p, [10, 1.5, 0])![0]).toBeGreaterThan(1);
  });
  it('projects a translated rotated camera and all frame corners with the same convention', () => {
    const p = photo(); p.camera = { ...p.camera!, transform: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 1.5, 2, 1] };
    expect(worldToPhotoUv(p, [0, .7, 2.6])![0]).toBeCloseTo(.25);
    expect(worldToPhotoUv(p, [0, .7, 2.6])![1]).toBeCloseTo(.25);
    const corners = roomPhotoFrameCorners(p, 0)!;
    for (let i = 0; i < corners.length; i++) {
      const uv = worldToPhotoUv(p, corners[i]!)!, expected = [[0, 1], [1, 1], [1, 0], [0, 0]][i]!;
      expect(uv[0]).toBeCloseTo(expected[0]!, 12); expect(uv[1]).toBeCloseTo(expected[1]!, 12);
    }
  });
  it('ranks coverage and head-on views above oblique views; rejects back faces and behind-camera surfaces', () => {
    const headOn = photo('head-on'), oblique = photo('oblique', .9), absent = photo('outside', 20);
    const backwards = photo('backwards'); backwards.camera = { ...backwards.camera!, transform: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 1.5, 2, 1] };
    expect(rankSurfacePhotos([oblique, absent, backwards, headOn], wall).map((p) => p.photoId)).toEqual(['head-on', 'oblique']);
    expect(surfacePhotoScore(headOn, { ...wall, normal: [0, 0, -1] })).toBe(0);
    expect(surfacePhotoScore({ ...headOn, camera: null }, wall)).toBe(0);
  });
  it('caps 40 photos at 12, preserves the useful viewpoint, excludes missing/invalid cameras, and is deterministic', () => {
    const photos = Array.from({ length: 40 }, (_, i) => photo(`p${i}`, i ? i / 20 + .1 : 0));
    const urls = new Map(photos.map((p) => [p.photoId, `blob:${p.photoId}`]));
    const selected = selectRoomTexturePhotos(photos, urls, 0, [wall]);
    expect(selected).toHaveLength(12); expect(new Set(selected.map((p) => p.photoId)).size).toBe(12);
    expect(selected[0]!.photoId).toBe('p0');
    expect(selectRoomTexturePhotos(photos, urls, 0, [wall])).toEqual(selected);
    urls.delete('p0'); photos[1]!.camera = null;
    expect(selectRoomTexturePhotos(photos, urls, 0, [wall]).map((p) => p.photoId)).not.toContain('p0');
    expect(selectRoomTexturePhotos(photos, urls, 0, [wall]).map((p) => p.photoId)).not.toContain('p1');
    expect(selectRoomTexturePhotos([photos[2]!, photos[2]!], urls, 0, [])).toHaveLength(1);
  });
  it('caps both portrait and landscape textures without upscaling', () => {
    expect(roomTextureSize(1200, 1600)).toEqual([768, 1024]); expect(roomTextureSize(1600, 900)).toEqual([1024, 576]);
    expect(roomTextureSize(400, 600)).toEqual([400, 600]);
  });
  it('prioritizes selected markers, offsets collisions, and keeps labels inside the mobile canvas', () => {
    const positions = layoutRoomMarkers(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, x: 160, y: 140, priority: i === 39 ? 3 : 1 })), 330, 290, 24);
    expect(positions.get('p39')).toEqual([160, 140]); expect(positions.size).toBeGreaterThan(1); expect(positions.size).toBeLessThan(40);
    const values = [...positions.values()];
    values.forEach((p, i) => values.slice(i + 1).forEach((q) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(29)));
  });
});
