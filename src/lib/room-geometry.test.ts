import { describe, expect, it } from 'vitest';
import type { CaptureManifest, CapturePhoto, SketchFlag, Vec2 } from './capture-types';
import { buildRoomGeometry, createPlanProjection, drawableRoomOutline, intersectRoomRay, pixelToWorldRay, placeSketchFlag, pointInRoom, roomWallSegments, usablePhotoCamera, worldToPixel, type Vec3 } from './room-geometry';

const photo = (patch: Partial<CapturePhoto> = {}): CapturePhoto => ({
  photoId: 'p01', checklistItemId: 'rug-check', takenAt: '2026-10-18T12:00:00.000Z', width: 1000, height: 1000, sha256: '0'.repeat(64),
  camera: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 1.5, 2, 1], intrinsics: [500, 500, 500, 500], tracking: 'normal' }, ...patch,
});
const manifest = (patch: Partial<CaptureManifest> = {}): CaptureManifest => ({
  format: 'fixlist-room-capture', version: 1, captureId: 'cap-synthetic001', roomId: 'living-room', createdAt: '2026-10-18T12:00:00.000Z', mode: 'arkit', floorY: 0,
  outline: { closed: true, points: [[0, 0], [4, 0], [4, 4], [0, 4]] }, doors: [], photos: [photo()], ...patch,
});
const flag = (patch: Partial<SketchFlag> = {}): SketchFlag => ({ id: 'flag-rug', checklistItemId: 'rug-check', photoId: 'p01', point: { u: 500, v: 500 }, label: 'Review this photo', ...patch });
const square = buildRoomGeometry(manifest())!;
function close3(actual: Vec3, expected: Vec3) { actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 10)); }

describe('upright column-major camera projection', () => {
  it('uses negative camera Z, positive image-right X and downward image V', () => {
    const centre = pixelToWorldRay(photo(), { u: 500, v: 500 })!;
    expect(centre).toEqual({ origin: [2, 1.5, 2], direction: [0, 0, -1] });
    const ray = pixelToWorldRay(photo(), { u: 750, v: 750 })!;
    close3(ray.direction, [1 / Math.sqrt(6), -1 / Math.sqrt(6), -2 / Math.sqrt(6)]);
    const world = ray.origin.map((n, i) => n + ray.direction[i]! * 3) as unknown as Vec3;
    expect(worldToPixel(photo(), world)).toEqual({ u: 750, v: 750 });
    expect(worldToPixel(photo(), [2, 1.5, 3])).toBeNull();
  });
  it('rotates the ray and inverts a translated camera pose', () => {
    const p = photo({ camera: { ...photo().camera!, transform: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 1.5, 2, 1] } });
    const ray = pixelToWorldRay(p, { u: 500, v: 500 })!;
    expect(ray.origin).toEqual([2, 1.5, 2]); close3(ray.direction, [-1, 0, 0]);
    expect(worldToPixel(p, [0, .5, 1])).toEqual({ u: 750, v: 750 });
  });
  it.each([{ u: -1, v: 1 }, { u: 1000, v: 1 }, { u: 1, v: 1000 }, { u: 1, v: NaN }, { u: Infinity, v: 1 }])('refuses invalid pixels %j', (point) => {
    expect(pixelToWorldRay(photo(), point)).toBeNull();
  });
  it('keeps limited tracking drawable but never uses it for placement', () => {
    const p = photo({ camera: { ...photo().camera!, tracking: 'limited' } });
    expect(usablePhotoCamera(p)).not.toBeNull(); expect(pixelToWorldRay(p, { u: 500, v: 500 })).toBeNull();
    expect(placeSketchFlag(manifest({ photos: [p] }), flag())).toBeNull();
  });
  it('rejects absent, scaled, reflected, nonfinite and non-affine cameras', () => {
    expect(pixelToWorldRay(photo({ camera: null }), { u: 500, v: 500 })).toBeNull();
    for (const [index, value] of [[0, 2], [0, -1], [4, .01], [3, .01], [15, .99], [12, Infinity]] as const) {
      const transform = [...photo().camera!.transform]; transform[index] = value;
      expect(usablePhotoCamera(photo({ camera: { ...photo().camera!, transform } }))).toBeNull();
    }
    for (const intrinsics of [[0, 500, 500, 500], [500, 500, 1000, 500], [500, 500, 0, 500], [500, Infinity, 500, 500]] as const) expect(usablePhotoCamera(photo({ camera: { ...photo().camera!, intrinsics } }))).toBeNull();
  });
});

describe('nearest room surface with conservative doorway exits', () => {
  it('chooses floor before a wall, with world-space Euclidean distance', () => {
    const hit = intersectRoomRay(square, { origin: [2, 1.5, 2], direction: [0, -1, -1] })!;
    expect(hit.surface).toBe('floor'); close3(hit.position, [2, 0, .5]); expect(hit.distance).toBeCloseTo(1.5 * Math.sqrt(2));
  });
  it('chooses the near wall before a farther floor, regardless of direction magnitude', () => {
    const hit = intersectRoomRay(square, { origin: [2, 1.5, 2], direction: [0, -.2, -1] })!;
    expect(hit.surface).toBe('wall'); close3(hit.position, [2, 1.1, 0]); expect(hit.wallIndex).toBe(0);
    expect(intersectRoomRay(square, { origin: [2, 1.5, 2], direction: [0, 0, -30] })!.distance).toBe(2);
  });
  it('honors inclusive 0.2 and 15 distance bounds and wall height', () => {
    expect(intersectRoomRay(square, { origin: [.2, 1, 2], direction: [-1, 0, 0] })!.distance).toBe(.2);
    expect(intersectRoomRay(square, { origin: [.199, 1, 2], direction: [-1, 0, 0] })).toBeNull();
    const long = (x: number) => buildRoomGeometry(manifest({ outline: { closed: true, points: [[-1, 0], [x, 0], [x, 4], [-1, 4]] } }))!;
    expect(intersectRoomRay(long(15), { origin: [0, 1, 2], direction: [1, 0, 0] })!.distance).toBe(15);
    expect(intersectRoomRay(long(15.1), { origin: [0, 1, 2], direction: [1, 0, 0] })).toBeNull();
    expect(intersectRoomRay(square, { origin: [2, 1.5, 2], direction: [0, 1, -1] })).toBeNull();
    expect(intersectRoomRay(square, { origin: [2, .1, 2], direction: [0, -1, 0] })).toBeNull();
  });
  it('does not place through an approximate door gap; neighbouring solid wall still works', () => {
    const room = buildRoomGeometry(manifest({ doors: [[2, .05]] }))!;
    expect(roomWallSegments(room.walls[0]!)).toHaveLength(2);
    expect(intersectRoomRay(room, { origin: [2, 1.5, 2], direction: [0, 0, -1] })).toBeNull();
    expect(intersectRoomRay(room, { origin: [3, 1.5, 2], direction: [0, 0, -1] })?.surface).toBe('wall');
  });
  it('never jumps through a concave-room doorway to a reentered wall or floor', () => {
    const room = buildRoomGeometry(manifest({ outline: { closed: true, points: [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4]] }, doors: [[1, 3]] }))!;
    expect(intersectRoomRay(room, { origin: [.5, .8, 3], direction: [1, 0, 0] })).toBeNull();
    expect(intersectRoomRay(room, { origin: [.5, .8, 3], direction: [1, -.25, 0] })).toBeNull();
  });
  it('merges overlapping door drawings and ignores a remote tap', () => {
    const room = buildRoomGeometry(manifest({ doors: [[2, 0], [2.1, 0], [30, 30]] }))!;
    expect(room.walls[0]!.gaps).toHaveLength(1); expect(room.walls.slice(1).flatMap((w) => w.gaps)).toHaveLength(0);
    expect(roomWallSegments(room.walls[0]!)).toHaveLength(2);
  });
  it('handles clockwise rooms and a nonzero floor without moving the hit', () => {
    const room = buildRoomGeometry(manifest({ floorY: -1, outline: { closed: true, points: [...square.points].reverse() } }))!;
    const hit = intersectRoomRay(room, { origin: [2, .5, 2], direction: [0, -1, -1] })!;
    close3(hit.position, [2, -1, .5]);
  });
  it.each([
    { origin: [5, 1, 2], direction: [-1, 0, 0] }, { origin: [2, -1, 2], direction: [0, 1, 0] },
    { origin: [2, 1, 2], direction: [0, 0, 0] }, { origin: [2, 1, 2], direction: [NaN, 0, 1] },
  ] as { origin: Vec3; direction: Vec3 }[])('refuses an unusable ray %j', (ray) => expect(intersectRoomRay(square, ray)).toBeNull());
});

describe('outline validity and photo-only fallback', () => {
  it.each(([
    [[0, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [.04, .04], [0, .04], [.04, 0]],
    [[0, 0], [2, 0], [4, 0]],
    [[0, 0], [4, 0], [4, 0], [0, 4]],
    [[0, 0], [4, 0], [4, 4], [0, 0]],
    [[0, 0], [4, 0], [2, 0], [2, 4], [0, 4]],
    [[0, 0], [51, 0], [0, 4]],
  ] as Vec2[][]).map((points) => ({ points })))('rejects degenerate or crossing closed outlines $points', ({ points }) => {
    expect(buildRoomGeometry(manifest({ outline: { closed: true, points } }))).toBeNull();
    expect(drawableRoomOutline({ closed: true, points })).toBeNull();
  });
  it('draws an open outline but uses neither open, absent nor photos-only outlines for placement', () => {
    const open = { closed: false, points: square.points };
    expect(drawableRoomOutline(open)).toBe(open);
    for (const patch of [{ outline: open }, { outline: null }, { mode: 'photos' as const, outline: null, floorY: null }, { floorY: NaN }]) {
      const capture = manifest(patch); expect(buildRoomGeometry(capture)).toBeNull(); expect(placeSketchFlag(capture, flag())).toBeNull();
    }
    expect(placeSketchFlag(manifest(), flag({ point: null }))).toBeNull();
    expect(placeSketchFlag(manifest(), flag({ photoId: 'p99' }))).toBeNull();
    expect(placeSketchFlag(manifest(), flag({ checklistItemId: 'handrail-check' }))).toBeNull();
    expect(placeSketchFlag(manifest(), flag())?.surface).toBe('wall');
  });
  it('fits a rotated plan with first wall horizontal, readable unrotated marker coordinates and arbitrary heading', () => {
    const points: readonly Vec2[] = [[3, 2], [3, 6], [-1, 6], [-1, 2]], projection = createPlanProjection(points, [[5, 8]]);
    const a = projection.project(points[0]!), b = projection.project(points[1]!);
    expect(a[1]).toBeCloseTo(b[1], 10); expect(b[0]).toBeGreaterThan(a[0]);
    for (const point of [...points, [5, 8] as Vec2]) {
      const p = projection.project(point); expect(p[0]).toBeGreaterThanOrEqual(99.99); expect(p[0]).toBeLessThanOrEqual(900.01); expect(p[1]).toBeGreaterThanOrEqual(99.99); expect(p[1]).toBeLessThanOrEqual(650.01);
    }
    expect(pointInRoom([2, 2], square.points)).toBe(true); expect(pointInRoom([0, 2], square.points)).toBe(true); expect(pointInRoom([5, 2], square.points)).toBe(false);
  });
});
