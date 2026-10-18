import { describe, expect, it, vi } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { createPrintSnapshot } from './print';
import { pinScanSuggestion } from './scan-suggestion-actions';
import { validateScanPins } from './scan-model';
import { saveScan, loadScan, type ScanStore } from './scan-storage';
import { suggestionDocumentFixture, suggestionCatalogFixture, testJpeg } from './scan-suggestions.fixture';
import { suggestionId } from './scan-suggestions';
import { captureScanImage, isSmallJpeg } from './scan-image';

const at = '2026-10-18T14:00:00.000Z';
const manual = () => ({ id: 'manual-pin', concernId: 'cord-concern', position: [1, 0, 2] as [number, number, number], createdAt: at, origin: 'family' as const, image: testJpeg });
const concerns = new Set(demoScenario.concerns.map((concern) => concern.id));

describe('pure scan pin print snapshot', () => {
  it('includes immutable manual, AI and older pin entries without mutating workflow state', () => {
    const document = suggestionDocumentFixture();
    const pinned = pinScanSuggestion(document, suggestionId(document.suggestions.data.items[0]!), 'ai-pin', at, testJpeg);
    if (!pinned.ok) throw new Error(pinned.error);
    expect(pinned.value.pins[0]).toMatchObject({ image: document.suggestions.data.items[0]!.thumbnail, origin: 'ai-suggestion' });
    const pins = [manual(), ...pinned.value.pins, { id: 'old-pin', concernId: 'rug-concern', position: [0, 0, 0] as [number, number, number], createdAt: at }];
    const state = createInitialState(demoScenario), before = structuredClone(state);
    const snapshot = createPrintSnapshot(state, at, pins);
    expect(snapshot.generatedAt).toBe(at);
    expect(snapshot.scanPins).toEqual([
      { id: 'manual-pin', concernId: 'cord-concern', origin: 'family', image: testJpeg },
      { id: 'ai-pin', concernId: 'rug-concern', origin: 'ai-suggestion', image: testJpeg },
      { id: 'old-pin', concernId: 'rug-concern', origin: 'family', image: null },
    ]);
    pins[0]!.image = null; state.checklistAnswers['rug-check'] = 'yes';
    expect(snapshot.scanPins[0]!.image).toBe(testJpeg);
    expect(snapshot.state).toEqual(before);
    expect(Object.isFrozen(snapshot.scanPins[0])).toBe(true);
    expect(snapshot.scanPins[0]).not.toHaveProperty('position');
  });
  it('roundtrips pin image and origin through validated IndexedDB data', async () => {
    const document = suggestionDocumentFixture(); document.pins = [manual()];
    let raw: unknown;
    const store: ScanStore = { read: async () => raw, write: async (value) => { raw = value; }, clear: async () => {} };
    expect((await saveScan(store, document, concerns, suggestionCatalogFixture)).ok).toBe(true);
    expect((await loadScan(store, concerns, suggestionCatalogFixture)).document?.pins).toEqual(document.pins);
  });
  it.each([{ image: 'https://example.test/private.jpg' }, { image: 'data:image/svg+xml;base64,PHN2Zz4=' }, { image: testJpeg + 'A'.repeat(128 * 1024) }, { origin: 'detected' }])('rejects untrusted pin field %j', (change) => {
    expect(validateScanPins([{ ...manual(), ...change }], concerns).ok).toBe(false);
  });
});

describe('same-frame bounded JPEG capture', () => {
  it('copies the rendered canvas to at most 320px and encodes a local JPEG', () => {
    const drawImage = vi.fn(), toDataURL = vi.fn(() => testJpeg);
    const small = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL };
    const source = { width: 1600, height: 900 } as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => small) });
    try {
      expect(captureScanImage(source)).toBe(testJpeg);
      expect([small.width, small.height]).toEqual([320, 180]);
      expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 320, 180);
      expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.72);
    } finally { vi.unstubAllGlobals(); }
  });
  it('returns no image if the canvas cannot be copied', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => { throw new Error('Unavailable'); } }) });
    try { expect(captureScanImage({ width: 640, height: 480 } as HTMLCanvasElement)).toBeNull(); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rejects an oversized JPEG dimension', () => {
    const bytes = atob(testJpeg.split(',')[1]!);
    const sof = bytes.indexOf('\xff\xc0');
    expect(sof).toBeGreaterThan(0);
    const bad = bytes.slice(0, sof + 7) + '\x02\x00' + bytes.slice(sof + 9);
    expect(isSmallJpeg('data:image/jpeg;base64,' + btoa(bad))).toBe(false);
  });
});
