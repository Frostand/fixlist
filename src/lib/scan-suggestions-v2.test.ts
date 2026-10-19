import { describe, expect, it } from 'vitest';
import disclosureCases from '../../scan/tests/disclosure-parity.json';
import { loadScan, type ScanStore } from './scan-storage';
import { plattProbability, validateScanSuggestions, suggestionForChecklist, visibleSuggestionMarkers, suggestionId } from './scan-suggestions';
import { suggestionCatalogFixture as catalog, suggestionDocumentFixture, suggestionsFixture, suggestionsV2Fixture as fixture, testJpeg } from './scan-suggestions.fixture';
const asset = suggestionDocumentFixture().asset;
const validate = (value: unknown) => validateScanSuggestions(value, catalog, asset);

describe('v2 recomputes every summary and per-frame mapping', () => {
  it('accepts and reconstructs a full v2 catalog', () => {
    const input = fixture(), result = validate(input);
    expect(result).toEqual({ ok: true, value: { data: input, dropped: 0 } });
    if (!result.ok) return;
    result.value.data.items[0]!.perFrame[0]!.probability = 0;
    expect(input.items[0]!.perFrame[0]!.probability).toBe(0.856);
  });
  it.each([
    { score: 0.99 }, { bestFrame: 'frame-2.jpg' }, { meanProbability: 0.7 }, { relevantFrames: 1 },
    { framesAboveThreshold: 2 }, { status: 'below-threshold' }, { thumbnail: null }, { thumbnail: 'data:image/jpeg;base64,/9j/4A==' },
    { question: 'Is the stair handrail loose?' }, { relevanceQuestion: 'different' }, { limitation: 'different' },
  ])('rejects a contradictory derived/catalog field: %j', (change) => {
    const input = fixture(); Object.assign(input.items[0]!, change);
    expect(validate(input).ok).toBe(false);
  });
  it('rejects the 99 percent summary with 1 percent frame evidence', () => {
    const input = fixture(), item = input.items[0]!;
    item.perFrame.forEach((row) => { row.rawProbability = 0.01; row.probability = 0.01; });
    item.score = 0.99;
    expect(validate(input).ok).toBe(false);
  });
  it('rejects probability different from raw when uncalibrated', () => {
    const input = fixture(); input.items[0]!.perFrame[0]!.probability = 0.77;
    expect(validate(input).ok).toBe(false);
  });
  it('selects the first maximum among relevant frames, ignoring a higher irrelevant score', () => {
    const input = fixture(), item = input.items[0]!;
    item.perFrame[0]!.relevanceProbability = 0;
    item.bestFrame = 'frame-2.jpg'; item.score = 0.344; item.relevantFrames = 1;
    item.framesAboveThreshold = 0; item.status = 'below-threshold'; item.position = null; item.viewpoint = null; item.thumbnail = null;
    expect(validate(input).ok).toBe(true);
    item.position = [0, 0, 0];
    expect(validate(input).ok).toBe(false);
  });
  it('requires null score, bestFrame, image and position with no relevant frames', () => {
    const input = fixture(), item = input.items[0]!;
    item.perFrame.forEach((row) => { row.relevanceProbability = 0; });
    Object.assign(item, { status: 'not-visible', score: null, bestFrame: null, relevantFrames: 0, framesAboveThreshold: 0, position: null, viewpoint: null, thumbnail: null });
    expect(validate(input).ok).toBe(true);
    for (const change of [{ score: 0.856 }, { bestFrame: 'frame-1.jpg' }, { position: [0, 0, 0] }, { thumbnail: testJpeg }, { viewpoint: [1, 0, 0] }]) {
      expect(validate({ ...input, items: [{ ...item, ...change }, ...input.items.slice(1)] }).ok).toBe(false);
    }
  });
  it('recomputes minFrames status and treats threshold equality as inclusive', () => {
    const input = fixture(); input.thresholds.minFrames = 2;
    input.items.forEach((item) => { item.status = 'below-threshold'; item.thumbnail = null; });
    expect(validate(input).ok).toBe(true);
    input.thresholds.suggestion = 0.344;
    expect(validate(input).ok).toBe(false);
  });
  it('breaks best-frame ties in keyframe order', () => {
    const input = fixture(), item = input.items[0]!;
    item.perFrame[1]!.probability = 0.856; item.perFrame[1]!.rawProbability = 0.856;
    item.meanProbability = 0.856; item.framesAboveThreshold = 2;
    expect(validate(input).ok).toBe(true);
    item.bestFrame = 'frame-2.jpg';
    expect(validate(input).ok).toBe(false);
  });
  it('checks exact catalog and frame ordering/counts', () => {
    for (const change of [(v: ReturnType<typeof fixture>) => v.items.reverse(), (v: ReturnType<typeof fixture>) => v.items.pop(),
      (v: ReturnType<typeof fixture>) => v.items[0]!.perFrame.reverse(), (v: ReturnType<typeof fixture>) => v.scan.keyframes.pop()]) {
      const input = fixture(); change(input); expect(validate(input).ok).toBe(false);
    }
  });
  it.each([{ suggestion: 1.1 }, { relevance: -1 }, { minFrames: 0 }, { minFrames: 3 }, { location: Infinity }, { noneProbability: -0.1 }, { extra: 0 }])('rejects bad threshold %j', (change) => {
    const input = fixture(); Object.assign(input.thresholds, change); expect(validate(input).ok).toBe(false);
  });
  it('validates calibration and recomputes probabilities with its per-item Platt mapping', () => {
    const input = fixture();
    input.calibration = { method: 'platt', parameters: Object.fromEntries(input.items.map((item) => [item.checklistItemId, { a: 1.2, b: 0.1 }])),
      fittedAt: input.createdAt, labelSource: 'Synthetic labels for tests', trainExamples: 20, heldOutExamples: 5, heldOutBrierRaw: 0.2, heldOutBrierCalibrated: 0.15 };
    for (const item of input.items) {
      item.perFrame.forEach((row) => { row.probability = plattProbability(row.rawProbability, 1.2, 0.1); });
      item.score = item.perFrame[0]!.probability; item.meanProbability = item.perFrame.reduce((s, row) => s + row.probability, 0) / 2;
    }
    expect(validate(input).ok).toBe(true);
    const bad = structuredClone(input); bad.items[0]!.perFrame[0]!.probability += 0.01;
    expect(validate(bad).ok).toBe(false);
    for (const change of [{ method: 'isotonic' }, { trainExamples: -1 }, { heldOutBrierRaw: 2 }, { labelSource: '' }, { parameters: {} }, { extra: true }]) {
      expect(validate({ ...input, calibration: { ...input.calibration, ...change } }).ok).toBe(false);
    }
    for (const a of [0, -1, Infinity]) {
      const bad = structuredClone(input); bad.calibration!.parameters['rug-check']!.a = a;
      expect(validate(bad).ok).toBe(false);
    }
  });
  it('allows a position without viewpoint, but no viewpoint without position', () => {
    const input = fixture(); input.items[0]!.viewpoint = null;
    expect(validate(input).ok).toBe(true);
    input.items[1]!.position = null;
    expect(validate(input).ok).toBe(false);
  });
  it('only suggested status earns chips and markers', () => {
    const input = fixture();
    input.items[0]!.status = 'below-threshold'; input.items[1]!.status = 'not-visible';
    const layer = { data: input, dismissed: [], pinned: [], droppedItems: 0 };
    expect(suggestionForChecklist(layer, 'rug-check')).toBeUndefined();
    expect(suggestionForChecklist(layer, 'cord-check')).toBeUndefined();
    expect(visibleSuggestionMarkers(layer).map(suggestionId)).not.toContain(suggestionId(input.items[0]!));
  });
});

describe('v1 consistency and read-only saved layer compatibility', () => {
  it.each([{ maxProbability: 0.99 }, { bestFrame: 'frame-2.jpg' }, { meanProbability: 0.5 }, { framesAboveThreshold: 2 }, { thumbnail: null }, { suggested: false }])('rejects v1 contradiction %j', (change) => {
    const input = suggestionsFixture(); Object.assign(input.items[0]!, change); expect(validate(input).ok).toBe(false);
  });
  it('rejects a high maximum fabricated from low per-frame evidence', () => {
    const input = suggestionsFixture(), item = input.items[0]!;
    item.maxProbability = 0.99; item.meanProbability = 0.01; item.perFrame.forEach((row) => { row.probability = 0.01; });
    expect(validate(input).ok).toBe(false);
  });
  it('rejects suggested below threshold even with matching summaries', () => {
    const input = suggestionsFixture(), item = input.items[0]!;
    item.perFrame.forEach((row) => { row.probability = 0.01; }); item.maxProbability = 0.01; item.meanProbability = 0.01; item.framesAboveThreshold = 0;
    expect(validate(input).ok).toBe(false);
  });
  it('accepts an older v1 non-suggestion without inventing a reason', () => {
    const input = suggestionsFixture(); input.items[0]!.suggested = false; input.items[0]!.thumbnail = null;
    expect(validate(input).ok).toBe(true);
  });
  it('loads a v1 layer without viewpoint without writing its IndexedDB bytes', async () => {
    const input = suggestionDocumentFixture(); Reflect.deleteProperty(input.suggestions.data.items[0]!, 'viewpoint');
    let writes = 0;
    const store: ScanStore = { read: async () => input, write: async () => { writes++; }, clear: async () => {} };
    const result = await loadScan(store, new Set(['rug-concern']), catalog);
    expect(result.ok).toBe(true); expect(writes).toBe(0);
    expect(result.document?.version === 2 && result.document.suggestions?.data.items[0]?.viewpoint).toBeNull();
    expect(input.suggestions.data.items[0]).not.toHaveProperty('viewpoint');
  });
});

describe('content identity and trusted disclosures', () => {
  it('rejects another scene with an equal splat count before accepting any item', async () => {
    const { prepareScanAsset } = await import('./scan-model');
    const other = { ...asset, blob: new Blob([new Uint8Array(32).fill(1)]) };
    expect((await prepareScanAsset(other)).ok).toBe(true);
    expect(validateScanSuggestions(fixture(), catalog, other)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISMATCH' });
  });
  it('fails closed for legacy identity and for unverified restored Blob bytes', () => {
    const legacy = fixture(); delete legacy.scan.identity;
    expect(validate(legacy)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISSING' });
    expect(validateScanSuggestions(fixture(), catalog, { ...asset, blob: new Blob([new Uint8Array(32)]) })).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_UNVERIFIED' });
  });
  it('provides a typed scene guard for the parent-owned pin action boundary', async () => {
    const { prepareScanAsset } = await import('./scan-model');
    const { validateSuggestionScene } = await import('./scan-suggestions');
    const input = suggestionDocumentFixture();
    input.asset = { ...input.asset, blob: new Blob([new Uint8Array(32).fill(1)]) };
    await prepareScanAsset(input.asset);
    expect(validateSuggestionScene(input.suggestions.data, input.asset)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISMATCH' });
    expect(input.pins).toHaveLength(0);
  });
  it('accepts a persisted blob only after hashing the actual hydrated bytes', async () => {
    const { prepareScanAsset } = await import('./scan-model');
    const restored = { ...asset, blob: new Blob([new Uint8Array(32)]) };
    await prepareScanAsset(restored);
    expect(validateScanSuggestions(fixture(), catalog, restored).ok).toBe(true);
  });
  it('rejects unsupported coordinate conventions and malformed frame provenance', () => {
    const input = fixture();
    expect(validate({ ...input, scan: { ...input.scan, identity: { ...input.scan.identity, coordinateSystem: 'z-up' } } }).ok).toBe(false);
    expect(validate({ ...input, scan: { ...input.scan, identity: { ...input.scan.identity, frames: [{ frame: 'wrong.jpg', sha256: 'f'.repeat(64) }] } } }).ok).toBe(false);
  });
  it('preserves explicit uncertainty and rejects unsupported claimed placement', () => {
    const input = fixture();
    input.items[0]!.localization = { method: 'grid-sparse-depth', status: 'approximate', reason: 'coarse-grid-depth-proxy', support: 3, maxAngleDegrees: 1, relativeDepthSpread: 0.1 };
    expect(validate(input).ok).toBe(true);
    for (const change of [{ support: 1 }, { maxAngleDegrees: 15 }, { relativeDepthSpread: 0.8 }, { status: 'photo-only' }]) {
      const bad = structuredClone(input); Object.assign(bad.items[0]!.localization!, change);
      expect(validate(bad).ok).toBe(false);
    }
  });
});

for (const c of disclosureCases) {
  it(`TS/Python disclosure parity: ${c.name}`, () => {
    const input = fixture(); input.notice = c.notice; input.model.license = c.license;
    expect(validate(input).ok).toBe(c.valid);
  });
}
