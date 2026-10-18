import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureScanImage, isAnnotatedScanImage, isSmallJpeg, scanImageAnnotation, shareableScanPins } from './scan-image';
import { testJpeg } from './scan-suggestions.fixture';

function canvasHarness() {
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  const output = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => testJpeg) };
  vi.stubGlobal('document', { createElement: () => output });
  return { context, output, canvas: { width: 1600, height: 900 } as HTMLCanvasElement };
}
afterEach(() => vi.unstubAllGlobals());
describe('marked location crop for review and export', () => {
  it.each([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 0.1, y: 0.9 }])('keeps the point, full cross and local context inside the bounded image: %j', (point) => {
    const a = scanImageAnnotation(1600, 900, point)!;
    expect(a.size).toBe(450); expect(a.output).toBe(320);
    expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x + a.size).toBeLessThanOrEqual(1600);
    expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y + a.size).toBeLessThanOrEqual(900);
    expect(a.markerX - a.radius - 5).toBeGreaterThanOrEqual(0); expect(a.markerX + a.radius + 5).toBeLessThanOrEqual(a.output);
    expect(a.markerY - a.radius - 5).toBeGreaterThanOrEqual(0); expect(a.markerY + a.radius + 5).toBeLessThanOrEqual(a.output);
    expect(a.x + (a.markerX - a.inset) / a.content * a.size).toBeCloseTo(point.x * 1600);
    expect(a.y + (a.markerY - a.inset) / a.content * a.size).toBeCloseTo(point.y * 900);
  });
  it('draws the crop and visible ring/cross into the actual exported canvas', () => {
    const h = canvasHarness(), image = captureScanImage(h.canvas, { x: 0.5, y: 0.5 });
    expect([h.output.width, h.output.height]).toEqual([320, 320]);
    expect(h.context.drawImage).toHaveBeenCalledWith(h.canvas, 575, 225, 450, 450, 16, 16, 288, 288);
    expect(h.context.arc).toHaveBeenCalledWith(160, 160, 10, 0, Math.PI * 2);
    expect(h.context.lineTo).toHaveBeenCalledWith(175, 160); expect(h.context.lineTo).toHaveBeenCalledWith(160, 175);
    expect(h.context.stroke).toHaveBeenCalledTimes(2);
    expect(isAnnotatedScanImage(image)).toBe(true); expect(isSmallJpeg(image)).toBe(true);
  });
  it('excludes legacy whole-room images from export without changing stored pins', () => {
    const h = canvasHarness(), image = captureScanImage(h.canvas, { x: 0.5, y: 0.5 })!;
    const pins = [testJpeg, image].map((value, index) => ({ id: `pin-${index}`, concernId: 'rug-concern', position: [0, 0, 0] as [number, number, number], createdAt: '2026-10-18T14:00:00Z', image: value }));
    expect(shareableScanPins(pins).map((pin) => pin.image)).toEqual([null, image]);
    expect(pins[0]!.image).toBe(testJpeg); expect(isAnnotatedScanImage(testJpeg)).toBe(false);
  });
  it('rejects out-of-frame/non-finite points rather than inventing a location', () => {
    for (const point of [{ x: -0.1, y: 0.5 }, { x: 1.1, y: 0.5 }, { x: NaN, y: 0.5 }]) expect(scanImageAnnotation(800, 600, point)).toBeNull();
  });
});
