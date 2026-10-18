import { MAX_SCAN_PINS, type ScanDocumentV2, type ScanResult } from './scan-model';
import { suggestionId } from './scan-suggestions';

/** These commands accept only scan data. They cannot answer or confirm the workflow. */
export function dismissScanSuggestion(document: ScanDocumentV2, id: string, dismissed: boolean): ScanDocumentV2 {
  const layer = document.suggestions;
  if (!layer || !layer.data.items.some((item) => suggestionId(item) === id)) return document;
  return { ...document, suggestions: { ...layer, dismissed: dismissed ? [...new Set([...layer.dismissed, id])] : layer.dismissed.filter((entry) => entry !== id) } };
}
export function pinScanSuggestion(document: ScanDocumentV2, id: string, pinId: string, at: string): ScanResult<ScanDocumentV2> {
  const layer = document.suggestions, item = layer?.data.items.find((entry) => suggestionId(entry) === id);
  if (!layer || !item || !item.position || layer.dismissed.includes(id) || layer.pinned.includes(id)) return { ok: false, error: 'This suggestion is unavailable, dismissed, already pinned or has no 3D location.' };
  if (document.pins.length >= MAX_SCAN_PINS) return { ok: false, error: `This room already has ${MAX_SCAN_PINS} pins. Remove a pin before adding another.` };
  return { ok: true, value: { ...document, pins: [...document.pins, { id: pinId, concernId: item.concernId, position: [...item.position], createdAt: at }],
    suggestions: { ...layer, pinned: [...layer.pinned, id] } } };
}
