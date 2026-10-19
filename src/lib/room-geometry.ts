import { CAPTURE_FLAG_EXCLUDED, type CaptureCamera, type CaptureManifest, type CaptureOutline, type CapturePhoto, type PixelPoint, type SketchFlag, type Vec2 } from './capture-types';

export type Vec3 = readonly [number, number, number];
export interface RoomRay { origin: Vec3; direction: Vec3 }
export interface RoomHit { position: Vec3; distance: number; surface: 'floor' | 'wall'; wallIndex: number | null }
export interface DoorGap { start: number; end: number }
export interface RoomWall { index: number; start: Vec2; end: Vec2; length: number; gaps: readonly DoorGap[] }
export interface RoomGeometry { points: readonly Vec2[]; floorY: number; walls: readonly RoomWall[] }

/** Drawing assumptions only. Neither the wall height nor door width is a measurement. */
export const ROOM_WALL_HEIGHT = 2.4;
export const ROOM_DOOR_WIDTH = 0.9;
const DOOR_SNAP_DISTANCE = 0.65;
const EPS = 1e-7;
const MIN_EDGE = 1e-4;
export const ROOM_MIN_HIT_DISTANCE = 0.2;
export const ROOM_MAX_HIT_DISTANCE = 15;

const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const finite2 = (p: Vec2) => p.length === 2 && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 50);
const finite3 = (p: Vec3) => p.length === 3 && p.every(Number.isFinite);
const interpolate = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const signedOutlineArea = (points: readonly Vec2[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]!), 0) / 2;

function onSegment(p: Vec2, a: Vec2, b: Vec2) {
  return Math.abs(cross(sub(p, a), sub(b, a))) <= EPS
    && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const ab = sub(b, a), cd = sub(d, c), s1 = cross(ab, sub(c, a)), s2 = cross(ab, sub(d, a)), s3 = cross(cd, sub(a, c)), s4 = cross(cd, sub(b, c));
  const opposite = (x: number, y: number) => (x > EPS && y < -EPS) || (x < -EPS && y > EPS);
  return (opposite(s1, s2) && opposite(s3, s4)) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

/** Open simple polylines can be drawn; only a nondegenerate closed polygon can be used for placement. */
export function drawableRoomOutline(outline: CaptureOutline | null): CaptureOutline | null {
  if (!outline || outline.points.length < 3 || outline.points.length > 32 || !outline.points.every(finite2)) return null;
  const { points, closed } = outline, count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_EDGE) return null;
    for (let j = i + 1; j < count; j++) {
      if (j === i + 1 || (closed && i === 0 && j === count - 1)) continue;
      if (segmentsMeet(a, b, points[j]!, points[(j + 1) % points.length]!)) return null;
    }
  }
  // Adjacent edges may continue straight but must not double back over one another.
  for (let i = closed ? 0 : 1; i < (closed ? points.length : points.length - 1); i++) {
    const a = sub(points[(i - 1 + points.length) % points.length]!, points[i]!), b = sub(points[(i + 1) % points.length]!, points[i]!);
    if (Math.abs(cross(a, b)) <= EPS && a[0] * b[0] + a[1] * b[1] > 0) return null;
  }
  if (closed && Math.abs(signedOutlineArea(points)) < 1e-6) return null;
  return outline;
}

/** Boundary points count as inside; all callers use validated, simple polygons. */
export function pointInRoom(point: Vec2, points: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!, b = points[i]!;
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function buildRoomGeometry(capture: Pick<CaptureManifest, 'mode' | 'floorY' | 'outline' | 'doors'>): RoomGeometry | null {
  const outline = drawableRoomOutline(capture.outline);
  if (capture.mode !== 'arkit' || !outline?.closed || capture.floorY === null || !Number.isFinite(capture.floorY)) return null;
  const points = outline.points;
  const walls: RoomWall[] = points.map((start, index) => {
    const end = points[(index + 1) % points.length]!;
    return { index, start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]), gaps: [] };
  });
  const gaps = walls.map(() => [] as DoorGap[]);
  for (const door of capture.doors) {
    if (!finite2(door)) continue;
    let best: { wall: RoomWall; t: number; distance: number } | null = null;
    for (const wall of walls) {
      const edge = sub(wall.end, wall.start), offset = sub(door, wall.start);
      const t = Math.max(0, Math.min(1, (offset[0] * edge[0] + offset[1] * edge[1]) / wall.length ** 2));
      const point = interpolate(wall.start, wall.end, t), distance = Math.hypot(door[0] - point[0], door[1] - point[1]);
      if (!best || distance < best.distance) best = { wall, t, distance };
    }
    // A tap near a wall is snapped to that wall. Remote taps cannot open unrelated walls.
    if (best && best.distance <= DOOR_SNAP_DISTANCE) {
      const half = ROOM_DOOR_WIDTH / (2 * best.wall.length);
      gaps[best.wall.index]!.push({ start: Math.max(0, best.t - half), end: Math.min(1, best.t + half) });
    }
  }
  return { points, floorY: capture.floorY, walls: walls.map((wall, i) => {
    const merged: DoorGap[] = [];
    for (const gap of gaps[i]!.sort((a, b) => a.start - b.start)) {
      const previous = merged.at(-1);
      if (previous && gap.start <= previous.end + EPS) previous.end = Math.max(previous.end, gap.end);
      else merged.push({ ...gap });
    }
    return { ...wall, gaps: merged };
  }) };
}

/** The same visible wall spans are used by the SVG and 3D drawing. */
export function roomWallSegments(wall: RoomWall): readonly { start: Vec2; end: Vec2 }[] {
  const result: { start: Vec2; end: Vec2 }[] = [];
  let t = 0;
  for (const gap of wall.gaps) {
    if (gap.start > t + EPS) result.push({ start: interpolate(wall.start, wall.end, t), end: interpolate(wall.start, wall.end, gap.start) });
    t = Math.max(t, gap.end);
  }
  if (t < 1 - EPS) result.push({ start: interpolate(wall.start, wall.end, t), end: wall.end });
  return result;
}

/** Defence in depth for rendering callers, even after manifest validation. */
export function usablePhotoCamera(photo: CapturePhoto, requireNormal = false): CaptureCamera | null {
  const c = photo.camera;
  if (!c || (c.tracking !== 'normal' && c.tracking !== 'limited') || (requireNormal && c.tracking !== 'normal')
    || !Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1 || photo.width > 1600 || photo.height > 1600
    || c.transform.length !== 16 || !c.transform.every(Number.isFinite) || c.intrinsics.length !== 4 || !c.intrinsics.every((n) => Number.isFinite(n) && n > 0)) return null;
  const m = c.transform, [, , cx, cy] = c.intrinsics;
  if (cx >= photo.width || cy >= photo.height || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return null;
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
    const dot = m[a * 4]! * m[b * 4]! + m[a * 4 + 1]! * m[b * 4 + 1]! + m[a * 4 + 2]! * m[b * 4 + 2]!;
    if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-3) return null;
  }
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  return Math.abs(det - 1) <= 1e-3 ? c : null;
}

export function pixelToWorldRay(photo: CapturePhoto, point: PixelPoint): RoomRay | null {
  const camera = usablePhotoCamera(photo, true);
  if (!camera || !Number.isFinite(point.u) || !Number.isFinite(point.v) || point.u < 0 || point.u >= photo.width || point.v < 0 || point.v >= photo.height) return null;
  const m = camera.transform, [fx, fy, cx, cy] = camera.intrinsics;
  const x = (point.u - cx) / fx, y = -(point.v - cy) / fy;
  const direction: Vec3 = [m[0]! * x + m[4]! * y - m[8]!, m[1]! * x + m[5]! * y - m[9]!, m[2]! * x + m[6]! * y - m[10]!];
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length < EPS) return null;
  return { origin: [m[12]!, m[13]!, m[14]!], direction: [direction[0] / length, direction[1] / length, direction[2] / length] };
}

/** Inverse rigid transform; points behind the camera have no pixel projection. */
export function worldToPixel(photo: CapturePhoto, point: Vec3): PixelPoint | null {
  const camera = usablePhotoCamera(photo);
  if (!camera || !finite3(point)) return null;
  const m = camera.transform, [fx, fy, cx, cy] = camera.intrinsics;
  const x = point[0] - m[12]!, y = point[1] - m[13]!, z = point[2] - m[14]!;
  const px = m[0]! * x + m[1]! * y + m[2]! * z, py = m[4]! * x + m[5]! * y + m[6]! * z, pz = m[8]! * x + m[9]! * y + m[10]! * z;
  if (pz >= -EPS) return null;
  const u = cx + fx * px / -pz, v = cy - fy * py / -pz;
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
}

export function intersectRoomRay(room: RoomGeometry, ray: RoomRay): RoomHit | null {
  if (!finite3(ray.origin) || !finite3(ray.direction) || !pointInRoom([ray.origin[0], ray.origin[2]], room.points) || ray.origin[1] < room.floorY - EPS) return null;
  const length = Math.hypot(...ray.direction);
  if (!Number.isFinite(length) || length < EPS) return null;
  const d: Vec3 = [ray.direction[0] / length, ray.direction[1] / length, ray.direction[2] / length];
  const at = (distance: number): Vec3 => [ray.origin[0] + d[0] * distance, ray.origin[1] + d[1] * distance, ray.origin[2] + d[2] * distance];
  const boundaries: { distance: number; wall: RoomWall; along: number }[] = [];
  for (const wall of room.walls) {
    const edge = sub(wall.end, wall.start), offset = sub(wall.start, [ray.origin[0], ray.origin[2]]), direction: Vec2 = [d[0], d[2]];
    const divisor = cross(direction, edge);
    if (Math.abs(divisor) < EPS) continue;
    const distance = cross(offset, edge) / divisor, along = cross(offset, direction) / divisor;
    if (distance > EPS && along >= -EPS && along <= 1 + EPS) boundaries.push({ distance, wall, along });
  }
  boundaries.sort((a, b) => a.distance - b.distance);
  const boundary = boundaries[0];
  const floorDistance = d[1] < -EPS ? (room.floorY - ray.origin[1]) / d[1] : Infinity;
  const distance = Math.min(floorDistance, boundary?.distance ?? Infinity);
  if (!Number.isFinite(distance) || distance < ROOM_MIN_HIT_DISTANCE || distance > ROOM_MAX_HIT_DISTANCE) return null;
  const position = at(distance);
  if (boundary && boundary.distance <= floorDistance + EPS) {
    // A doorway is an exit, not permission to hit a far wall or floor beyond the room.
    const firstBoundaries = boundaries.filter((hit) => Math.abs(hit.distance - boundary.distance) <= EPS);
    if (firstBoundaries.some((hit) => hit.wall.gaps.some((gap) => hit.along >= gap.start - EPS && hit.along <= gap.end + EPS))) return null;
    if (position[1] < room.floorY - EPS || position[1] > room.floorY + ROOM_WALL_HEIGHT + EPS) return null;
    return { position, distance, surface: 'wall', wallIndex: boundary.wall.index };
  }
  return pointInRoom([position[0], position[2]], room.points) ? { position, distance, surface: 'floor', wallIndex: null } : null;
}

export function placeSketchFlag(capture: CaptureManifest, flag: SketchFlag, room = buildRoomGeometry(capture)): RoomHit | null {
  if (!room || !flag.point || CAPTURE_FLAG_EXCLUDED.has(flag.checklistItemId)) return null;
  const photo = capture.photos.find((p) => p.photoId === flag.photoId);
  const ray = photo ? pixelToWorldRay(photo, flag.point) : null;
  return ray ? intersectRoomRay(room, ray) : null;
}

/** Rotate around the first corner so the first wall is horizontal, with arbitrary heading. */
export function createRoomFrame(points: readonly Vec2[]) {
  const origin = points[0] ?? [0, 0], next = points[1] ?? [1, 0];
  const angle = Math.atan2(next[1] - origin[1], next[0] - origin[0]), c = Math.cos(angle), s = Math.sin(angle);
  const direction = (p: Vec2): Vec2 => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
  return { point: (p: Vec2): Vec2 => direction(sub(p, origin)), direction };
}

export function createPlanProjection(points: readonly Vec2[], extraPoints: readonly Vec2[] = []) {
  const width = 1000, height = 750, padding = 100, frame = createRoomFrame(points);
  const local = [...points, ...extraPoints.filter(finite2)].map(frame.point);
  if (!local.length) local.push([0, 0]);
  const xs = local.map((p) => p[0]), ys = local.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 2 * padding) / Math.max(maxX - minX, MIN_EDGE), (height - 2 * padding) / Math.max(maxY - minY, MIN_EDGE));
  return { width, height, project: (p: Vec2): Vec2 => {
    const q = frame.point(p);
    return [width / 2 + (q[0] - (minX + maxX) / 2) * scale, height / 2 + (q[1] - (minY + maxY) / 2) * scale];
  }, direction: frame.direction };
}
