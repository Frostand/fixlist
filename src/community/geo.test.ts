import { describe, expect, it } from 'vitest';
import { distanceMiles, nextSlotDate } from './geo';

describe('community geography and local slots', () => {
  it('uses haversine miles, rounded to one decimal, symmetrically', () => {
    const a = { lat: 0, lng: 0 }, b = { lat: 1, lng: 0 };
    expect(distanceMiles(a, a)).toBe(0);
    expect(distanceMiles(a, b)).toBe(69.1);
    expect(distanceMiles(a, b)).toBe(distanceMiles(b, a));
    expect(distanceMiles({ lat: 0, lng: 180 }, { lat: 0, lng: -180 })).toBe(0);
    expect(Number.isFinite(distanceMiles(a, { lat: 0, lng: 180 }))).toBe(true);
  });
  it.each([['morning', 9], ['afternoon', 14], ['evening', 18]] as const)('finds the next local %s', (part, hour) => {
    const now = new Date(2026, 9, 23, 8, 0, 0), target = new Date(2026, 9, 23, hour, 0, 0);
    expect(nextSlotDate({ day: now.getDay() as 5, part }, now.toISOString())).toBe(target.toISOString());
    target.setDate(target.getDate() + 7);
    expect(nextSlotDate({ day: now.getDay() as 5, part }, new Date(2026, 9, 23, hour).toISOString())).toBe(target.toISOString());
  });
  it('moves to the next weekday and skips an already passed slot', () => {
    const now = new Date(2026, 9, 23, 10), next = new Date(2026, 9, 24, 9);
    expect(nextSlotDate({ day: 6, part: 'morning' }, now.toISOString())).toBe(next.toISOString());
    expect(() => nextSlotDate({ day: 6, part: 'morning' }, 'bad')).toThrow(RangeError);
  });
});
