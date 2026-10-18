import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { suggestionDocumentFixture, suggestionCatalogFixture as catalog, suggestionsV2Fixture } from './scan-suggestions.fixture';
import { dismissScanSuggestion, pinScanSuggestion, reconcileScanSuggestionPins, removeScanPin } from './scan-suggestion-actions';
import { suggestionId, visibleSuggestionMarkers } from './scan-suggestions';
import { loadScan, saveScan, type ScanStore } from './scan-storage';
import { prepareScanAsset, upgradeScanDocument, type ScanDocumentV2 } from './scan-model';

const at = '2026-10-18T14:00:00.000Z', concerns = new Set(demoScenario.concerns.map((c) => c.id));
function pin(document: ScanDocumentV2, id: string) { const result = pinScanSuggestion(document, id, 'ai-pin', at); if (!result.ok) throw new Error(result.error); return result.value; }
describe('coherent AI pin removal and suggestion choices', () => {
  it('refuses an explicitly assembled equal-count wrong-scene document at the pin action', async () => {
    const input = suggestionDocumentFixture(), id = suggestionId(input.suggestions.data.items[0]!);
    const asset = { ...input.asset, blob: new Blob([new Uint8Array(32).fill(1)]) };
    expect((await prepareScanAsset(asset)).ok).toBe(true);
    const assembled = { ...input, asset };
    expect(pinScanSuggestion(assembled, id, 'wrong-scene', at)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISMATCH' });
    expect(assembled.pins).toEqual([]); expect(assembled.suggestions.pinned).toEqual([]);
  });
  it('refuses missing identity and cold unverified bytes at the pin action', () => {
    const input = suggestionDocumentFixture(), id = suggestionId(input.suggestions.data.items[0]!);
    expect(pinScanSuggestion(structuredClone(input), id, 'cold', at)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_UNVERIFIED' });
    delete input.suggestions.data.scan.identity;
    expect(pinScanSuggestion(input, id, 'legacy', at)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISSING' });
  });
  it('never locates or pins an assembled photo-only item even if it carries stale coordinates', () => {
    const original = suggestionDocumentFixture(), data = suggestionsV2Fixture();
    data.items[0]!.localization = { method: 'grid-sparse-depth', status: 'photo-only', reason: 'insufficient-support', support: 0, maxAngleDegrees: null, relativeDepthSpread: null };
    const input = { ...original, suggestions: { ...original.suggestions, data } }, id = suggestionId(data.items[0]!);
    expect(pinScanSuggestion(input, id, 'unsupported', at).ok).toBe(false);
    expect(visibleSuggestionMarkers(input.suggestions).some((item) => suggestionId(item) === id)).toBe(false);
  });
  it('can remove, reload, re-add, dismiss and undo dismissal without orphaned pinned IDs', async () => {
    const input = suggestionDocumentFixture(), id = suggestionId(input.suggestions.data.items[0]!);
    let raw: unknown;
    const store: ScanStore = { read: async () => raw, write: async (value) => { raw = structuredClone(value); }, clear: async () => {} };
    async function reload(document: ScanDocumentV2) {
      expect((await saveScan(store, document, concerns, catalog)).ok).toBe(true);
      const restored = (await loadScan(store, concerns, catalog)).document;
      if (!restored) throw new Error('Expected saved scan');
      return upgradeScanDocument(restored);
    }
    const removed = await reload(removeScanPin(await reload(pin(input, id)), 'ai-pin'));
    expect(removed.pins).toEqual([]); expect(removed.suggestions!.pinned).toEqual([]);
    expect(visibleSuggestionMarkers(removed.suggestions)).toHaveLength(1);
    const dismissed = await reload(dismissScanSuggestion(removed, id, true));
    expect(visibleSuggestionMarkers(dismissed.suggestions)).toEqual([]);
    expect(pinScanSuggestion(dismissed, id, 'blocked', at).ok).toBe(false);
    const restored = await reload(dismissScanSuggestion(dismissed, id, false));
    const again = await reload(pin(restored, id));
    expect(again.pins).toHaveLength(1); expect(again.suggestions!.pinned).toEqual([id]);
    expect(again.pins[0]!.image).toBeNull(); // Never export the wider source thumbnail.
    expect(removeScanPin(dismissScanSuggestion(again, id, true), 'ai-pin').suggestions).toMatchObject({ dismissed: [id], pinned: [] });
    expect(input.pins).toEqual([]);
  });
  it('repairs a legacy orphaned ID in memory and leaves unrelated family pins intact', () => {
    const input = suggestionDocumentFixture(), id = suggestionId(input.suggestions.data.items[0]!);
    input.suggestions.pinned = [id]; input.pins = [{ id: 'family', concernId: 'rug-concern', origin: 'family', position: [1, 0, -1], createdAt: at }];
    const repaired = reconcileScanSuggestionPins(input);
    expect(repaired.suggestions!.pinned).toEqual([]); expect(repaired.pins).toEqual(input.pins);
    expect(input.suggestions.pinned).toEqual([id]);
  });
});
