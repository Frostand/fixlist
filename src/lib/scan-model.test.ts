import { describe, expect, it } from 'vitest';
import {
  importScanFiles, MAX_SCAN_BYTES, MAX_SCAN_PINS, MAX_SPLATS, parseScanMetadata,
  scanExtension, validateScanAsset, validateScanDocument, validateScanMetadata, validateScanPins,
  type ScanDocument, type ScanMetadata, type ScanPin,
} from './scan-model';

const at = '2026-10-17T14:00:00.000Z';
export function metadata(): ScanMetadata {
  return { format: 'fixlist-scan-metadata', version: 1, splatFile: 'scene.splat', splatCount: 1,
    coordinateSystem: 'y-up-right-handed', units: 'arbitrary', bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    initialCamera: { position: [3, 2, 3], target: [0, 1, 0] },
    source: { inputFrames: 12, registeredFrames: 10, createdAt: at, pipeline: 'Synthetic test fixture', trainingSteps: 100 },
  };
}
export function scanDocument(): ScanDocument {
  return { version: 1, asset: { name: 'scene.splat', blob: new Blob([new Uint8Array(32)]), metadata: metadata(), kind: 'imported' }, flipUpright: false, pins: [] };
}
export function pin(): ScanPin { return { id: 'pin-1', concernId: 'rug', position: [1, 0, -1], createdAt: at }; }
const concerns = new Set(['rug']);

describe('scan metadata validation', () => {
  it('reconstructs a strictly typed y-up metadata document', () => {
    const input = metadata(), result = validateScanMetadata(input);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok) { result.value.bounds.min[0] = -4; expect(input.bounds.min[0]).toBe(-1); }
  });
  it.each([null, [], {}, { ...metadata(), extra: 'unsupported' }, { ...metadata(), version: 2 }, { ...metadata(), format: 'other' }])('rejects unsupported or extra root fields: %j', (value) => {
    expect(validateScanMetadata(value).ok).toBe(false);
  });
  it.each(['http://example.com/scene.splat', '../scene.splat', 'scene.obj', '', 'x'.repeat(256) + '.splat'])('rejects a nonlocal or unsupported filename: %s', (splatFile) => {
    expect(validateScanMetadata({ ...metadata(), splatFile }).ok).toBe(false);
  });
  it.each([0, -1, 1.5, Infinity, NaN, MAX_SPLATS + 1, '1'])('rejects invalid splat counts: %s', (splatCount) => {
    expect(validateScanMetadata({ ...metadata(), splatCount }).ok).toBe(false);
  });
  it.each([
    { min: [0, 0], max: [1, 1, 1] }, { min: [0, 0, 0, 0], max: [1, 1, 1] },
    { min: [NaN, 0, 0], max: [1, 1, 1] }, { min: [0, 0, 0], max: [Infinity, 1, 1] },
    { min: [2, 0, 0], max: [1, 1, 1] }, { min: [0, 0, 0], max: [0, 0, 0] },
    { min: [-1e9, 0, 0], max: [1, 1, 1] }, { min: [0, '0', 0], max: [1, 1, 1] },
  ])('rejects malformed bounds: %j', (bounds) => {
    expect(validateScanMetadata({ ...metadata(), bounds }).ok).toBe(false);
  });
  it.each([
    { position: [0, 0, 0], target: [0, 0, 0] }, { position: [Infinity, 1, 1], target: [0, 0, 0] },
    { position: [1, 1], target: [0, 0, 0] }, { position: [1, 1, 1], target: [0, 0, 0], extra: true },
  ])('rejects unusable camera metadata: %j', (initialCamera) => {
    expect(validateScanMetadata({ ...metadata(), initialCamera }).ok).toBe(false);
  });
  it.each([
    { ...metadata().source, inputFrames: 0 }, { ...metadata().source, registeredFrames: 13 },
    { ...metadata().source, registeredFrames: -1 }, { ...metadata().source, trainingSteps: 1.2 },
    { ...metadata().source, pipeline: '' }, { ...metadata().source, pipeline: 'bad\nlabel' },
    { ...metadata().source, createdAt: 'not a date' }, { ...metadata().source, extra: 'bad' },
    { ...metadata().source, createdAt: '2026-02-30T00:00:00Z' }, { ...metadata().source, createdAt: '2026-10-17T25:00:00Z' },
  ])('rejects invalid provenance fields: %j', (source) => {
    expect(validateScanMetadata({ ...metadata(), source }).ok).toBe(false);
  });
  it('does not silently reinterpret unsupported coordinates or units', () => {
    expect(validateScanMetadata({ ...metadata(), coordinateSystem: 'y-down' }).ok).toBe(false);
    expect(validateScanMetadata({ ...metadata(), units: 'meters' }).ok).toBe(false);
  });
  it('reports malformed and oversized JSON without casting it', () => {
    expect(parseScanMetadata('{oops')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(parseScanMetadata(' '.repeat(65 * 1024))).toMatchObject({ ok: false, error: expect.stringContaining('64 KiB') });
    expect(parseScanMetadata(JSON.stringify(metadata()))).toEqual({ ok: true, value: metadata() });
  });
  it('accepts ISO provenance timestamps with a UTC offset from Python pipelines', () => {
    expect(validateScanMetadata({ ...metadata(), source: { ...metadata().source, createdAt: '2026-10-17T14:00:00.123456+00:00' } }).ok).toBe(true);
  });
});

describe('pin validation and concern catalog boundaries', () => {
  it('keeps local coordinates and creation time, independent of workflow confirmation', () => {
    expect(validateScanPins([pin()], concerns)).toEqual({ ok: true, value: { pins: [pin()], dropped: 0 } });
    expect(Object.keys(pin())).not.toContain('humanConfirmed');
  });
  it('drops only pins with retired concern IDs and counts them for a visible notice', () => {
    expect(validateScanPins([pin(), { ...pin(), id: 'old-pin', concernId: 'retired' }], concerns)).toEqual({ ok: true, value: { pins: [pin()], dropped: 1 } });
  });
  it.each([
    [{ ...pin(), position: [0, 0] }], [{ ...pin(), position: [Infinity, 0, 0] }],
    [{ ...pin(), position: [0, '0', 0] }], [{ ...pin(), position: [1e9, 0, 0] }],
    [{ ...pin(), createdAt: 'yesterday' }], [{ ...pin(), humanConfirmed: true }],
    [{ ...pin(), id: '' }], [{ ...pin(), concernId: '' }], [pin(), pin()], null,
  ].map((value) => ({ value })))('rejects malformed or duplicate pins: %j', ({ value }) => { expect(validateScanPins(value, concerns).ok).toBe(false); });
  it('applies the cap before catalog filtering', () => {
    const pins = Array.from({ length: MAX_SCAN_PINS + 1 }, (_, i) => ({ ...pin(), id: `pin-${i}`, concernId: 'retired' }));
    expect(validateScanPins(pins, concerns).ok).toBe(false);
    expect(validateScanPins(pins.slice(0, MAX_SCAN_PINS), concerns)).toEqual({ ok: true, value: { pins: [], dropped: MAX_SCAN_PINS } });
  });
  it('rejects corruption rather than treating invalid old-catalog pins as safe to drop', () => {
    expect(validateScanPins([{ ...pin(), concernId: 'retired', position: [NaN, 0, 0] }], concerns).ok).toBe(false);
  });
});

describe('scan file and persisted-document validation', () => {
  it.each(['splat', 'ply', 'spz', 'ksplat'])('allows a .%s binary with no metadata', (extension) => {
    expect(scanExtension(`ROOM.${extension.toUpperCase()}`)).toBe(extension);
    expect(validateScanAsset({ ...scanDocument().asset, name: `room.${extension}`, metadata: null }).ok).toBe(true);
  });
  it('requires metadata to describe the selected binary name and record count', () => {
    expect(validateScanAsset({ ...scanDocument().asset, name: 'other.splat' }).ok).toBe(false);
    expect(validateScanAsset({ ...scanDocument().asset, metadata: { ...metadata(), splatCount: 2 } }).ok).toBe(false);
  });
  it('rejects empty, over-limit and partial-record files without reading their binary', () => {
    const oversized = new Blob([new Uint8Array(32)]);
    Object.defineProperty(oversized, 'size', { value: MAX_SCAN_BYTES + 1 });
    expect(validateScanAsset({ ...scanDocument().asset, blob: oversized, metadata: null })).toMatchObject({ ok: false, code: 'SCAN_COMPLEXITY' });
    for (const blob of [new Blob(), oversized, new Blob([new Uint8Array(33)])]) {
      expect(validateScanAsset({ ...scanDocument().asset, blob, metadata: null }).ok).toBe(false);
    }
  });
  it('requires a Blob and exact document schema and boolean upright flag', () => {
    expect(validateScanAsset({ ...scanDocument().asset, blob: new ArrayBuffer(32) }).ok).toBe(false);
    for (const value of [{ ...scanDocument(), version: 2 }, { ...scanDocument(), flipUpright: 'yes' }, { ...scanDocument(), extra: 1 }]) expect(validateScanDocument(value, concerns).ok).toBe(false);
  });
  it('validates the saved asset and filters retired pins while preserving orientation', () => {
    const input = { ...scanDocument(), flipUpright: true, pins: [pin(), { ...pin(), id: 'old', concernId: 'retired' }] };
    const result = validateScanDocument(input, concerns);
    expect(result).toMatchObject({ ok: true, value: { document: { flipUpright: true, pins: [pin()] }, dropped: 1 } });
    expect(input.pins).toHaveLength(2);
  });
  it('imports one scan and matching scene.json together', async () => {
    const result = await importScanFiles([new File([new Uint8Array(32)], 'scene.splat'), new File([JSON.stringify(metadata())], 'scene.json')]);
    expect(result).toMatchObject({ ok: true, value: { name: 'scene.splat', metadata: metadata(), kind: 'imported' } });
  });
  it('permits a third-party scan without metadata and preserves binary bytes', async () => {
    const file = new File([new Uint8Array(64)], 'room.splat');
    expect(await importScanFiles([file])).toEqual({ ok: true, value: { name: file.name, blob: file, metadata: null, kind: 'imported' } });
  });
  it.each([
    [], [new File(['{}'], 'scene.json')], [new File(['x'], 'room.obj')],
    [new File(['x'], 'room.ply'), new File(['x'], 'other.ply')],
    [new File(['x'], 'room.ply'), new File(['{}'], 'metadata.json')],
    [new File(['x'], 'room.ply'), new File(['{}'], 'scene.json'), new File(['x'], 'extra.txt')],
  ].map((files) => ({ files })))('rejects ambiguous or unsupported selections', async ({ files }) => { expect((await importScanFiles(files)).ok).toBe(false); });
  it('reports metadata read failures and malformed JSON precisely', async () => {
    const broken = new File(['{}'], 'scene.json');
    Object.defineProperty(broken, 'text', { value: async () => { throw new Error('Disk unavailable'); } });
    expect(await importScanFiles([new File(['x'], 'room.ply'), broken])).toMatchObject({ ok: false, error: expect.stringContaining('could not be read') });
    expect(await importScanFiles([new File(['x'], 'room.ply'), new File(['{oops'], 'scene.json')])).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
  });
});

describe('decoded complexity preflight before Spark allocation', () => {
  it('rejects oversized raw-record counts before reading bytes', async () => {
    const { preflightScanComplexity, MAX_SPLATS } = await import('./scan-model');
    const blob = new Blob([new Uint8Array(32)]);
    Object.defineProperty(blob, 'size', { value: 32 * (MAX_SPLATS + 1) });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => { throw new Error('must not allocate'); } });
    expect(validateScanAsset({ name: 'scene.splat', blob, metadata: null, kind: 'imported' })).toMatchObject({ ok: false, code: 'SCAN_COMPLEXITY' });
    expect(await preflightScanComplexity({ name: 'scene.splat', blob, metadata: null, kind: 'imported' })).toMatchObject({ ok: false, code: 'SCAN_COMPLEXITY' });
  });
  it('checks the bounded PLY header and rejects decompression without a bound', async () => {
    const { preflightScanComplexity, MAX_SPLATS } = await import('./scan-model');
    for (const count of [0, MAX_SPLATS + 1]) {
      const blob = new Blob([`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\nend_header\n`]);
      expect((await preflightScanComplexity({ name: 'scene.ply', blob, metadata: null, kind: 'imported' })).ok).toBe(false);
    }
    const blob = new Blob(['ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n']);
    expect(await preflightScanComplexity({ name: 'scene.ply', blob, metadata: null, kind: 'imported' })).toEqual({ ok: true, value: 3 });
    for (const extension of ['spz', 'ksplat']) {
      expect(await preflightScanComplexity({ name: `scene.${extension}`, blob: new Blob([new Uint8Array(32)]), metadata: null, kind: 'imported' })).toMatchObject({ ok: false, code: 'SCAN_COMPLEXITY' });
    }
  });
});
