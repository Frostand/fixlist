/**
 * CPU picking for user-placed pins. Spark's splat raycast misses thin, flat Gaussians
 * (floors, rugs) in real scans, so pins use the nearest sufficiently opaque splat whose
 * center lies within a small screen-space tolerance of the click ray. The returned depth
 * is measured along the ray, so the pin always projects back onto the clicked pixel.
 */
export interface PickIndex { readonly centers: Float32Array; readonly radii: Float32Array; readonly count: number }
type Vec3 = readonly [number, number, number];

export const PICK_MIN_OPACITY = 0.3;

export function createPickIndex(capacity: number, visit: (add: (x: number, y: number, z: number, radius: number, opacity: number) => void) => void): PickIndex {
  const centers = new Float32Array(capacity * 3), radii = new Float32Array(capacity);
  let count = 0;
  visit((x, y, z, radius, opacity) => {
    if (count >= capacity || opacity < PICK_MIN_OPACITY || !Number.isFinite(x + y + z + radius)) return;
    centers.set([x, y, z], count * 3);
    radii[count] = Math.max(radius, 0);
    count++;
  });
  return { centers, radii, count };
}

/**
 * Returns the distance along a normalized ray to the nearest pickable splat, or null.
 * `angularTolerance` is the accepted perpendicular offset per unit of depth (a few pixels);
 * `maxRadius` caps how much a single large background splat can widen the target.
 */
export function pickAlongRay(index: PickIndex, origin: Vec3, direction: Vec3, angularTolerance: number, maxRadius: number, near = 0): number | null {
  const [ox, oy, oz] = origin, [dx, dy, dz] = direction;
  const { centers, radii, count } = index;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const vx = centers[i * 3]! - ox, vy = centers[i * 3 + 1]! - oy, vz = centers[i * 3 + 2]! - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if (t <= near || t >= best) continue;
    const tolerance = Math.max(Math.min(radii[i]!, maxRadius), t * angularTolerance);
    const perpendicular2 = vx * vx + vy * vy + vz * vz - t * t;
    if (perpendicular2 <= tolerance * tolerance) best = t;
  }
  return Number.isFinite(best) ? best : null;
}
