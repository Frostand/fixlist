import { describe, expect, it } from 'vitest';
import { createInitialState, computePlan } from '../domain/workflow';
import { demoScenario } from '../data/demo-scenario';
import { validateScanDocument, upgradeScanDocument, MAX_SCAN_PINS } from './scan-model';
import { loadScan, saveScan, type ScanStore } from './scan-storage';
import { importScanSelection } from './scan-import';
import { dismissScanSuggestion, pinScanSuggestion } from './scan-suggestion-actions';
import { MAX_SUGGESTION_FRAMES, MAX_SUGGESTION_ITEMS, MAX_SUGGESTIONS_BYTES, MAX_THUMBNAIL_LENGTH,
  parseScanSuggestions, suggestionScore, suggestionForChecklist, suggestionId, validateScanSuggestions, validateSuggestionLayer, visibleSuggestionMarkers } from './scan-suggestions';
import { suggestionCatalogFixture as catalog, suggestionDocumentFixture as document, suggestionsFixture as data, suggestionLayerFixture as layer } from './scan-suggestions.fixture';

const concerns = new Set(demoScenario.concerns.map((concern) => concern.id));
const validate = (input: unknown) => validateScanSuggestions(input, catalog, document().asset);
const first = () => data().items[0]!;

describe('bounded model suggestions JSON', () => {
  it('reconstructs nested data without mutating input', () => {
    const input = data(), result = validate(input);
    expect(result).toEqual({ ok: true, value: { data: input, dropped: 0 } });
    if (!result.ok) return;
    result.value.data.items[0]!.position![0] = 12;
    result.value.data.items[0]!.perFrame[0]!.probability = 0;
    result.value.data.scan.keyframes.push('extra.jpg');
    expect(input.items[0]!.position![0]).toBe(1);
    expect(input.items[0]!.perFrame[0]!.probability).toBe(0.856);
    expect(input.scan.keyframes).toHaveLength(2);
  });
  it.each([null, [], {}, { ...data(), version: 2 }, { ...data(), extra: true }, { ...data(), createdAt: 'yesterday' }, { ...data(), createdAt: '2026-02-30T00:00:00Z' }])('rejects an unsupported root', (input) => { expect(validate(input).ok).toBe(false); });
  it('accepts a Python timezone/microsecond timestamp', () => { expect(validate({ ...data(), createdAt: '2026-10-17T14:00:00.123456+00:00' }).ok).toBe(true); });
  it.each([{ ...data().model, backend: 'cloud' }, { ...data().model, engine: 'other' }, { ...data().model, license: '' }, { ...data().model, extra: true }])('requires exact model provenance', (model) => { expect(validate({ ...data(), model }).ok).toBe(false); });
  it.each([-0.01, 1.01, NaN, Infinity, '0.5', null])('rejects invalid maximum, mean and per-frame probabilities %s', (probability) => {
    for (const changes of [{ maxProbability: probability }, { meanProbability: probability }, { perFrame: [{ frame: 'frame-1.jpg', probability }] }]) {
      expect(validate({ ...data(), items: [{ ...first(), ...changes }] }).ok).toBe(false);
    }
  });
  it.each([
    { position: [NaN, 0, 0] }, { position: [0, 0] }, { position: [1e9, 0, 0] }, { position: 'origin' },
    { framesAboveThreshold: -1 }, { framesAboveThreshold: 3 }, { framesAboveThreshold: 0.5 },
    { meanProbability: 0.9 }, { suggested: 'yes' }, { question: '' }, { extra: true },
    { bestFrame: 'absent.jpg' }, { perFrame: [{ frame: 'frame-1.jpg', probability: 0.5 }, { frame: 'frame-1.jpg', probability: 0.5 }] },
  ])('rejects malformed item fields', (changes) => { expect(validate({ ...data(), items: [{ ...first(), ...changes }] }).ok).toBe(false); });
  it.each(['https://example.test/frame.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,dGV4dA==', 'data:image/jpeg;base64,???=', 'data:image/jpeg;base64,' + 'A'.repeat(MAX_THUMBNAIL_LENGTH)])('rejects external, malformed, mislabeled or over-limit thumbnails', (thumbnail) => { expect(validate({ ...data(), items: [{ ...first(), thumbnail }] }).ok).toBe(false); });
  it('allows absent 3D location and legacy signed PNG data', () => {
    expect(validate({ ...data(), items: [{ ...first(), position: null, viewpoint: null }] }).ok).toBe(true);
    expect(validate({ ...data(), items: [{ ...first(), thumbnail: 'data:image/png;base64,iVBORw0KGgo=' }] }).ok).toBe(true);
  });
  it('drops unknown IDs and mismatched known pairs with a counted notice', () => {
    const input = { ...data(), items: [first(), { ...first(), checklistItemId: 'retired' }, { ...first(), concernId: 'retired' }, { ...first(), concernId: 'cord-concern' }] };
    expect(validate(input)).toEqual({ ok: true, value: { data: data(), dropped: 3 } });
  });
  it('still rejects corruption in unknown-catalog items', () => { expect(validate({ ...data(), items: [{ ...first(), concernId: 'retired', maxProbability: Infinity }] }).ok).toBe(false); });
  it('drops unknown IDs with malformed Unicode without throwing', () => {
    expect(validate({ ...data(), items: [{ ...first(), concernId: '\ud800' }] })).toMatchObject({ ok: true, value: { dropped: 1, data: { items: [] } } });
  });
  it('requires unique pairs and caps before filtering', () => {
    expect(validate({ ...data(), items: [first(), first()] }).ok).toBe(false);
    expect(validate({ ...data(), items: Array.from({ length: MAX_SUGGESTION_ITEMS + 1 }, (_, index) => ({ ...first(), concernId: `old-${index}` })) }).ok).toBe(false);
    expect(validate({ ...data(), items: [{ ...first(), perFrame: Array.from({ length: MAX_SUGGESTION_FRAMES + 1 }, (_, index) => ({ frame: `f-${index}`, probability: 0.1 })) }] }).ok).toBe(false);
  });
  it.each([{ ...data().scan, splatCount: 2 }, { ...data().scan, framesAnalyzed: 0 }, { ...data().scan, framesAnalyzed: MAX_SUGGESTION_FRAMES + 1 }, { ...data().scan, keyframes: ['same', 'same'] }])('validates scan counts and frames', (scan) => { expect(validate({ ...data(), scan }).ok).toBe(false); });
  it.each([{ bad: Infinity }, { bad: -1 }, { bad: '0.7' }, []])('rejects nonfinite, unbounded or nonnumeric threshold/timing fields', (numbers) => {
    expect(validate({ ...data(), thresholds: numbers }).ok).toBe(false);
    expect(validate({ ...data(), timing: numbers }).ok).toBe(false);
  });
  it('rejects oversized/read-invalid JSON before import', () => {
    expect(parseScanSuggestions('{broken', catalog, document().asset).ok).toBe(false);
    expect(parseScanSuggestions(' '.repeat(MAX_SUGGESTIONS_BYTES + 1), catalog, document().asset).ok).toBe(false);
  });
});

describe('scan document v2 persistence and read-only v1 migration', () => {
  it('migrates v1 bytes, pins and orientation, initializing no suggestions', async () => {
    const { suggestions: _suggestions, ...base } = document();
    const old = { ...base, version: 1 as const, pins: [{ id: 'legacy-pin', concernId: 'rug-concern', position: [1, 0, -1] as [number, number, number], createdAt: data().createdAt }] };
    let writes = 0;
    const store: ScanStore = { read: async () => old, write: async () => { writes++; }, clear: async () => {} };
    const result = await loadScan(store, concerns, catalog);
    expect(result.document).toEqual({ ...old, version: 2, suggestions: null });
    expect(writes).toBe(0);
    expect(old.version).toBe(1);
    expect(upgradeScanDocument(old)).toEqual(result.document);
  });
  it('round trips v2 suggestions, dismissals and pin choices without localStorage state', async () => {
    let stored: unknown;
    const store: ScanStore = { read: async () => stored, write: async (value) => { stored = value; }, clear: async () => { stored = undefined; } };
    const pinned = pinScanSuggestion(document(), suggestionId(first()), 'saved-pin', data().createdAt);
    if (!pinned.ok) throw new Error(pinned.error);
    const input = dismissScanSuggestion(pinned.value, suggestionId(first()), true);
    expect(await saveScan(store, input, concerns, catalog)).toMatchObject({ ok: true });
    expect(await loadScan(store, concerns, catalog)).toMatchObject({ ok: true, document: input });
    expect(Object.keys(stored as object)).not.toContain('checklistAnswers');
  });
  it('requires a catalog for persisted suggestions and validates exact layer state', () => {
    expect(validateScanDocument(document(), concerns).ok).toBe(false);
    expect(validateScanDocument(document(), concerns, catalog).ok).toBe(true);
    for (const value of [{ ...layer(), dismissed: [1] }, { ...layer(), pinned: ['x', 'x'] }, { ...layer(), droppedItems: -1 }, { ...layer(), extra: true }]) expect(validateSuggestionLayer(value, catalog, document().asset).ok).toBe(false);
  });
  it('persists a visible notice for unknown links without rewriting on load', async () => {
    const input = document();
    input.suggestions!.data.items.push({ ...first(), concernId: 'retired' });
    const store: ScanStore = { read: async () => input, write: async () => { throw new Error('Must not write on load'); }, clear: async () => {} };
    expect(await loadScan(store, concerns, catalog)).toMatchObject({ ok: true, document: { suggestions: { droppedItems: 1 } }, message: expect.stringContaining('1 model suggestion(s) were dropped') });
    expect(input.suggestions!.data.items).toHaveLength(2);
  });
});

describe('shared scan import and suggestion-only actions', () => {
  it('imports all three files and checks count against the binary without metadata', async () => {
    const files = [new File([new Uint8Array(32)], 'scene.splat'), new File([JSON.stringify(data())], 'suggestions.json')];
    expect(await importScanSelection(files, catalog)).toMatchObject({ ok: true, value: { version: 2, suggestions: layer() } });
    expect(await importScanSelection([new File([new Uint8Array(64)], 'scene.splat'), files[1]!], catalog)).toMatchObject({ ok: false, error: expect.stringContaining('splatCount') });
  });
  it('keeps no-suggestion imports valid and rejects duplicate or unexpected files', async () => {
    const scan = new File([new Uint8Array(32)], 'scene.splat'), suggestions = new File([JSON.stringify(data())], 'suggestions.json');
    expect(await importScanSelection([scan], catalog)).toMatchObject({ ok: true, value: { version: 2, suggestions: null } });
    expect((await importScanSelection([scan, suggestions, suggestions], catalog)).ok).toBe(false);
    expect((await importScanSelection([new File(['x'], 'other.obj')], catalog)).ok).toBe(false);
    expect((await importScanSelection([scan, new File(['{}'], 'other.json')], catalog)).ok).toBe(false);
  });
  it('reports unreadable and oversized suggestion files', async () => {
    const scan = new File([new Uint8Array(32)], 'scene.splat'), suggestions = new File(['{}'], 'suggestions.json');
    Object.defineProperty(suggestions, 'text', { value: async () => { throw new Error('Denied'); } });
    expect(await importScanSelection([scan, suggestions], catalog)).toMatchObject({ ok: false, error: expect.stringContaining('could not be read') });
    Object.defineProperty(suggestions, 'size', { value: MAX_SUGGESTIONS_BYTES + 1 });
    expect(await importScanSelection([scan, suggestions], catalog)).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') });
  });
  it('accepts an optional camera viewpoint only alongside a position', () => {
    const base = data(), item = base.items[0]!;
    expect(validate(base)).toMatchObject({ ok: true, value: { data: { items: [{ viewpoint: [2, 1, 1] }] } } });
    const { viewpoint: _omit, ...legacy } = item;
    expect(validate({ ...base, items: [legacy] })).toMatchObject({ ok: true, value: { data: { items: [{ viewpoint: null }] } } });
    expect(validate({ ...base, items: [{ ...item, position: null }] })).toMatchObject({ ok: false });
    expect(validate({ ...base, items: [{ ...item, viewpoint: [Number.NaN, 0, 0] }] })).toMatchObject({ ok: false });
  });
  it('gives a checklist chip only to items the model flagged as suggested', () => {
    const flagged = layer();
    expect(suggestionScore(suggestionForChecklist(flagged, 'rug-check')!)).toBe(0.856);
    const low = { ...flagged, data: { ...flagged.data, items: flagged.data.items.map((item) => ({ ...item, suggested: false, maxProbability: 0.01 })) } };
    expect(suggestionForChecklist(low, 'rug-check')).toBeUndefined();
  });
  it('dismisses/restores independently and hides markers once added as a normal user pin', () => {
    const input = document(), id = suggestionId(first());
    expect(visibleSuggestionMarkers(input.suggestions)).toHaveLength(1);
    const dismissed = dismissScanSuggestion(input, id, true);
    expect(visibleSuggestionMarkers(dismissed.suggestions)).toHaveLength(0);
    expect(suggestionForChecklist(dismissed.suggestions, 'rug-check')).toBeUndefined();
    const restored = dismissScanSuggestion(dismissed, id, false);
    const pinned = pinScanSuggestion(restored, id, 'new-pin', '2026-10-17T15:00:00.000Z');
    expect(pinned).toMatchObject({ ok: true, value: { pins: [{ id: 'new-pin', concernId: 'rug-concern', position: [1, 0, -1] }], suggestions: { pinned: [id] } } });
    if (pinned.ok) { expect(visibleSuggestionMarkers(pinned.value.suggestions)).toHaveLength(0); expect(pinScanSuggestion(pinned.value, id, 'twice', 'x').ok).toBe(false); }
    expect(input.pins).toHaveLength(0);
    expect(input.suggestions!.dismissed).toHaveLength(0);
  });
  it('keeps lower-probability items out of the 3D markers even when they have a location', () => {
    const input = layer(); input.data.items[0]!.suggested = false;
    expect(visibleSuggestionMarkers(input)).toHaveLength(0);
  });
  it('cannot add a pin with no position, dismissal, unknown id or a full pin list', () => {
    const input = document(), id = suggestionId(first());
    const noPosition = document(); noPosition.suggestions!.data.items[0]!.position = null;
    const full = document(); full.pins = Array.from({ length: MAX_SCAN_PINS }, (_, index) => ({ id: `pin-${index}`, concernId: 'rug-concern', position: [0, 0, 0], createdAt: data().createdAt }));
    for (const value of [noPosition, dismissScanSuggestion(input, id, true), full]) expect(pinScanSuggestion(value, id, 'pin', data().createdAt).ok).toBe(false);
    expect(pinScanSuggestion(input, 'unknown', 'pin', data().createdAt).ok).toBe(false);
  });
  it('leaves all workflow answers, confirmation, plan, screening and family records untouched', () => {
    const workflow = createInitialState(demoScenario), before = structuredClone(workflow);
    const result = pinScanSuggestion(document(), suggestionId(first()), 'pin', data().createdAt);
    expect(result.ok).toBe(true);
    expect(workflow).toEqual(before);
    expect(computePlan(demoScenario, workflow)).toEqual([]);
  });
});
