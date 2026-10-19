import { describe, expect, it } from 'vitest';
import { createPickIndex, pickAlongRay, PICK_MIN_OPACITY, isSurfaceOccludingMarker, isMarkerOccluded } from './scan-pick';

function index(points: readonly [number, number, number, number, number][]) {
  return createPickIndex(points.length, (add) => { for (const point of points) add(...point); });
}

describe('scan pin picking', () => {
  it('returns the nearest splat in front of the camera along the ray', () => {
    const pick = index([[0, 0, 5, 0.1, 1], [0, 0, 2, 0.1, 1], [0, 0, -3, 0.1, 1]]);
    expect(pickAlongRay(pick, [0, 0, 0], [0, 0, 1], 0.001, 1)).toBeCloseTo(2);
  });

  it('never returns a point behind the camera or before the near distance', () => {
    const pick = index([[0, 0, -1, 0.1, 1], [0, 0, 0.05, 0.1, 1]]);
    expect(pickAlongRay(pick, [0, 0, 0], [0, 0, 1], 0.001, 1, 0.1)).toBeNull();
  });

  it('accepts thin splats near the ray within the screen-space tolerance', () => {
    const pick = index([[0.04, 0, 4, 0.001, 1]]);
    expect(pickAlongRay(pick, [0, 0, 0], [0, 0, 1], 0.02, 1)).toBeCloseTo(4);
    expect(pickAlongRay(pick, [0, 0, 0], [0, 0, 1], 0.001, 1)).toBeNull();
  });

  it('skips transparent and non-finite splats and caps oversized radii', () => {
    const pick = index([[0, 0, 1, 0.1, PICK_MIN_OPACITY / 2], [0, 0, Number.NaN, 0.1, 1], [3, 0, 2, 50, 1], [0, 0, 6, 0.1, 1]]);
    expect(pick.count).toBe(2);
    expect(pickAlongRay(pick, [0, 0, 0], [0, 0, 1], 0.001, 0.5)).toBeCloseTo(6);
  });
});

describe('marker surface occlusion for both family pins and AI markers', () => {
  it.each([[2, 5, 0.1, true], [4.95, 5, 0.1, false], [5, 5, 0.1, false], [8, 5, 0.1, false], [null, 5, 0.1, false], [-1, 5, 0.1, false], [NaN, 5, 0.1, false]])('compares surface %s with marker %s', (surface, depth, margin, expected) => {
    expect(isSurfaceOccludingMarker(surface, depth!, margin!)).toBe(expected);
  });
  it('hides a marker behind a wall and preserves markers on or in front of the wall', () => {
    const wall = index([[0, 0, 2, 0.1, 1]]);
    expect(isMarkerOccluded(wall, [0, 0, 0], [0, 0, 5], 0.001, 10)).toBe(true);
    expect(isMarkerOccluded(wall, [0, 0, 0], [0, 0, 2], 0.001, 10)).toBe(false);
    expect(isMarkerOccluded(wall, [0, 0, 0], [0, 0, 1], 0.001, 10)).toBe(false);
  });
  it('recomputes visibility from the moved camera and rejects off-ray or transparent obstructions', () => {
    const wall = index([[0, 0, 2, 0.1, 1], [0, 0, 4, 0.1, 0.1]]);
    expect(isMarkerOccluded(wall, [0, 0, 6], [0, 0, 5], 0.001, 10)).toBe(false);
    expect(isMarkerOccluded(wall, [0, 0, 0], [2, 0, 5], 0.001, 10)).toBe(false);
    expect(isMarkerOccluded(wall, [0, 0, 0], [0, 0, 0], 0.001, 10)).toBe(false);
  });
});
