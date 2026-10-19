import { describe, expect, it } from 'vitest';
import { encodeSampleSplats, generateSampleRoom } from './scan-sample';
import { validateScanAsset } from './scan-model';

describe('generated Gaussian-splat sample', () => {
  it('encodes the 32-byte little-endian position, linear scale, RGBA and WXYZ byte layout', () => {
    const encoded = encodeSampleSplats([{ position: [1.5, -2, 3.25], scale: [0.5, 0.25, 0.125], rgba: [12, 34, 56, 240], rotation: [1, 0, -1, 0.5] }]);
    const view = new DataView(encoded);
    expect(encoded.byteLength).toBe(32);
    expect([...new Uint8Array(encoded, 0, 4)]).toEqual([0, 0, 192, 63]);
    expect([0, 4, 8, 12, 16, 20].map((offset) => view.getFloat32(offset, true))).toEqual([1.5, -2, 3.25, 0.5, 0.25, 0.125]);
    expect([...new Uint8Array(encoded, 24, 8)]).toEqual([12, 34, 56, 240, 255, 128, 0, 191]);
  });
  it('strides consecutive records without overlapping their rotation/color bytes', () => {
    const encoded = encodeSampleSplats([
      { position: [1, 2, 3], scale: [1, 1, 1], rgba: [1, 2, 3, 4], rotation: [1, 0, 0, 0] },
      { position: [-4, -5, -6], scale: [0.5, 0.5, 0.5], rgba: [5, 6, 7, 8], rotation: [0, 1, 0, 0] },
    ]);
    expect(encoded.byteLength).toBe(64);
    expect(new DataView(encoded).getFloat32(32, true)).toBe(-4);
    expect([...new Uint8Array(encoded, 56, 8)]).toEqual([5, 6, 7, 8, 128, 255, 128, 128]);
  });
  it('builds 30–80k finite y-up splats in memory, explicitly generated without pipeline provenance', async () => {
    const asset = generateSampleRoom(), bytes = await asset.blob.arrayBuffer(), view = new DataView(bytes);
    expect(asset.kind).toBe('generated');
    expect(asset.metadata).toBeNull();
    expect(validateScanAsset(asset).ok).toBe(true);
    expect(bytes.byteLength / 32).toBeGreaterThanOrEqual(30000);
    expect(bytes.byteLength / 32).toBeLessThanOrEqual(80000);
    let maxY = 0, minY = Infinity, invalidNumbers = 0, invalidScales = 0, invalidRotations = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += 32) {
      for (let field = 0; field < 24; field += 4) if (!Number.isFinite(view.getFloat32(offset + field, true))) invalidNumbers++;
      const y = view.getFloat32(offset + 4, true);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (view.getFloat32(offset + 12, true) <= 0) invalidScales++;
      if (view.getUint8(offset + 28) !== 255) invalidRotations++;
    }
    expect({ invalidNumbers, invalidScales, invalidRotations }).toEqual({ invalidNumbers: 0, invalidScales: 0, invalidRotations: 0 });
    expect(minY).toBe(0);
    expect(maxY).toBe(3);
  });
  it('generates reproducible bytes without any committed binary asset', async () => {
    const a = await generateSampleRoom().blob.arrayBuffer(), b = await generateSampleRoom().blob.arrayBuffer();
    const bytesA = new Uint8Array(a), bytesB = new Uint8Array(b);
    expect(bytesA.byteLength).toBe(bytesB.byteLength);
    expect(bytesA.every((value, index) => value === bytesB[index])).toBe(true);
  });
});
