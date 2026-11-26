import { describe, expect, it } from 'vitest';
import { directionToEquirect, equirectToDirection, photoPointDirection, stopArrowPosition, tourHazards } from './room-tour-geometry';
import { reviewFixture, tourFixture } from './__fixtures__/capture-tour';
describe('native panorama convention and room navigation', () => {
  it('looks -Z at centre, +X to the right, +Y above, with exact half-pixel centres', () => {
    expect(equirectToDirection(2047.5, 1023.5)).toEqual([0, 0, -1]);
    const right = equirectToDirection(3071.5, 1023.5); expect(right[0]).toBeCloseTo(1); expect(right[2]).toBeCloseTo(0);
    expect(equirectToDirection(2047.5, -0.5)[1]).toBeCloseTo(1);
    for (const [u, v] of [[0, 0], [4095, 2047], [789, 456], [2047.5, 1023.5]]) {
      const back = directionToEquirect(equirectToDirection(u!, v!))!; expect(back.u).toBeCloseTo(u!, 6); expect(back.v).toBeCloseTo(v!, 6);
    }
    expect(directionToEquirect([0, 0, 0])).toBeNull();
  });
  it('puts the destination arrow on floorY, retaining world X/Z and a fallback below the eye', async () => {
    const record = await tourFixture(), [a, b] = record.manifest.tour!.stops;
    expect(stopArrowPosition(a!, b!, -0.4)).toEqual([1, -0.37, -2]);
    expect(stopArrowPosition(a!, b!, null)).toEqual([1, 0.19999999999999996, -2]);
    expect(stopArrowPosition(a!, a!, 0)).toBeNull();
  });
  it('shows panorama pins only at their own stop and projects photo pixel flags best effort', async () => {
    const r = await tourFixture(true), stop = r.manifest.tour!.stops[0]!, review = reviewFixture(r.manifest);
    const flags = [{ id: 'flag-a', checklistItemId: 'rug-check', photoId: 'p01', point: { u: 8, v: 12 }, label: 'Review rug' }];
    const h = tourHazards(r.manifest, review, flags, stop);
    expect(h.filter(x => x.kind === 'panorama')).toHaveLength(1); expect(h[0]!.sourceId).toBe('s1');
    const d = photoPointDirection(r.manifest, stop, 'p01', { u: 8, v: 12 }); expect(d).not.toBeNull(); expect(Math.hypot(...d!)).toBeCloseTo(1);
    expect(photoPointDirection(r.manifest, stop, 'missing', { u: 0, v: 0 })).toBeNull();
  });
});
