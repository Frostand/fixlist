import type { AvailabilitySlot, GeoPoint } from './types';

/** Approximate city centers, not household locations or navigation destinations. */
const CENTROIDS: Record<string, GeoPoint> = {
  cumming: { lat: 34.2073, lng: -84.1402 }, suwanee: { lat: 34.0515, lng: -84.0713 },
  lawrenceville: { lat: 33.9562, lng: -83.9880 }, duluth: { lat: 34.0029, lng: -84.1446 },
  'johns creek': { lat: 34.0289, lng: -84.1986 }, dawsonville: { lat: 34.4212, lng: -84.1199 },
};
export function locationForArea(area: string): GeoPoint {
  const key = area.split(',')[0]?.trim().toLowerCase() ?? '';
  return { ...(CENTROIDS[key] ?? CENTROIDS.cumming!) };
}
export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const radians = (n: number) => n * Math.PI / 180;
  const lat = radians(b.lat - a.lat), lng = radians(b.lng - a.lng);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return Math.round(3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))) * 10) / 10;
}
/** Uses the device's local calendar, including its daylight-saving transitions. */
export function nextSlotDate(slot: AvailabilitySlot, now: string): string {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime()) || ![0, 1, 2, 3, 4, 5, 6].includes(slot.day)
    || !['morning', 'afternoon', 'evening'].includes(slot.part)) throw new RangeError('Invalid date or availability slot.');
  const date = new Date(current);
  date.setDate(date.getDate() + (slot.day - date.getDay() + 7) % 7);
  date.setHours({ morning: 9, afternoon: 14, evening: 18 }[slot.part], 0, 0, 0);
  if (date.getTime() <= current.getTime()) date.setDate(date.getDate() + 7);
  return date.toISOString();
}
