import { describe, expect, it, vi } from 'vitest';
import { getLocalDemoScans, loadLocalDemoScan, validateLocalScanIndex, type LocalDemoScan } from './local-scan-loader';
import { MAX_SCAN_BYTES } from './scan-model';
import { suggestionCatalogFixture as catalog, suggestionsFixture } from './scan-suggestions.fixture';

const metadata = { format: 'fixlist-scan-metadata', version: 1, splatFile: 'scene.splat', splatCount: 1, coordinateSystem: 'y-up-right-handed', units: 'arbitrary',
  bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, initialCamera: { position: [3, 2, 3], target: [0, 0, 0] },
  source: { inputFrames: 2, registeredFrames: 2, createdAt: '2026-10-17T14:00:00Z', pipeline: 'Synthetic test fixture', trainingSteps: 1 } };
const files: Record<string, Blob> = { 'scene.splat': new Blob([new Uint8Array(32)]), 'scene.json': new Blob([JSON.stringify(metadata)]), 'suggestions.json': new Blob([JSON.stringify(suggestionsFixture())]) };
const entry: LocalDemoScan = { name: 'test-room-1', sizes: { 'scene.splat': files['scene.splat']!.size, 'scene.json': files['scene.json']!.size, 'suggestions.json': files['suggestions.json']!.size } };
const fetchFiles = async (url: string) => new Response(files[url.split('/').at(-1)!], { status: 200 });

describe('dev/preview local scan client', () => {
  it('uses the shared manual-import path for binary, metadata and suggestions', async () => {
    const fetcher = vi.fn(fetchFiles);
    const result = await loadLocalDemoScan(entry, catalog, fetcher);
    expect(result).toMatchObject({ ok: true, value: { version: 2, asset: { name: 'scene.splat', metadata, kind: 'imported' }, suggestions: { data: suggestionsFixture() } } });
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(['/local-scans/test-room-1/scene.json', '/local-scans/test-room-1/scene.splat', '/local-scans/test-room-1/suggestions.json']);
  });
  it('permits a binary-only local scan', async () => {
    expect(await loadLocalDemoScan({ ...entry, sizes: { 'scene.splat': 32, 'scene.json': null, 'suggestions.json': null } }, catalog, fetchFiles)).toMatchObject({ ok: true, value: { suggestions: null, asset: { metadata: null } } });
  });
  it('rejects model and metadata mismatch through the importer even when index sizes match', async () => {
    const wrongSuggestions = new Blob([JSON.stringify({ ...suggestionsFixture(), scan: { ...suggestionsFixture().scan, splatCount: 2 } })]);
    const changed: LocalDemoScan = { ...entry, sizes: { ...entry.sizes, 'suggestions.json': wrongSuggestions.size } };
    expect(await loadLocalDemoScan(changed, catalog, async (url) => url.endsWith('suggestions.json') ? new Response(wrongSuggestions) : fetchFiles(url))).toMatchObject({ ok: false, error: expect.stringContaining('splatCount') });
    const wrongMetadata = new Blob([JSON.stringify({ ...metadata, splatCount: 2 })]);
    expect(await loadLocalDemoScan({ ...entry, sizes: { ...entry.sizes, 'scene.json': wrongMetadata.size } }, catalog, async (url) => url.endsWith('scene.json') ? new Response(wrongMetadata) : fetchFiles(url))).toMatchObject({ ok: false, error: expect.stringContaining('splatCount') });
  });
  it('handles missing files, server failure and changing bytes without a partial import', async () => {
    for (const fetcher of [async () => new Response('missing', { status: 404 }), async () => { throw new Error('Offline'); }, async () => new Response('changed')]) {
      expect(await loadLocalDemoScan(entry, catalog, fetcher)).toMatchObject({ ok: false });
    }
  });
  it('hides unavailable or production SPA-fallback endpoints', async () => {
    for (const response of [new Response('', { status: 404 }), new Response('<html>Production app</html>'), new Response('{}')]) expect(await getLocalDemoScans(async () => response)).toEqual([]);
    expect(await getLocalDemoScans(async () => { throw new Error('Unavailable'); })).toEqual([]);
    expect(await getLocalDemoScans(async () => new Response(JSON.stringify([entry])))).toEqual([entry]);
  });
  it.each(['../secrets', '..', 'room/name', 'room\\name', 'room%2fname', 'room.json', '', 'x'.repeat(101)])('rejects unsafe scan names before fetching: %s', async (name) => {
    const fetcher = vi.fn(fetchFiles);
    expect(validateLocalScanIndex([{ ...entry, name }])).toEqual([]);
    expect((await loadLocalDemoScan({ ...entry, name }, catalog, fetcher)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates list caps, uniqueness and bounded file sizes', () => {
    for (const value of [[entry, entry], Array.from({ length: 101 }, (_, i) => ({ ...entry, name: `room-${i}` })), [{ ...entry, sizes: { ...entry.sizes, 'scene.splat': MAX_SCAN_BYTES + 1 } }], [{ ...entry, sizes: { ...entry.sizes, 'scene.json': Infinity } }]]) expect(validateLocalScanIndex(value)).toEqual([]);
  });
});
