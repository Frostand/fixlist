import { MAX_SCAN_PINS, type ScanDocumentV2, type ScanResult } from './scan-model';
import { isSuggested, suggestionId, validateSuggestionScene } from './scan-suggestions';

/** These commands accept only scan data. They cannot answer or confirm the workflow. */
export function dismissScanSuggestion(document: ScanDocumentV2, id: string, dismissed: boolean): ScanDocumentV2 {
  const layer = document.suggestions;
  if (!layer || !layer.data.items.some((item) => suggestionId(item) === id)) return document;
  return { ...document, suggestions: { ...layer, dismissed: dismissed ? [...new Set([...layer.dismissed, id])] : layer.dismissed.filter((entry) => entry !== id) } };
}
export function pinScanSuggestion(document: ScanDocumentV2, id: string, pinId: string, at: string, image: string | null = null): ScanResult<ScanDocumentV2> {
  const layer = document.suggestions;
  if (layer) { const scene = validateSuggestionScene(layer.data, document.asset); if (!scene.ok) return scene; }
  const item = layer?.data.items.find((entry) => suggestionId(entry) === id);
  if (!layer || !item || !isSuggested(item) || !item.position || ('localization' in item && item.localization?.status === 'photo-only') || layer.dismissed.includes(id) || layer.pinned.includes(id)) return { ok: false, error: 'This suggestion is unavailable, dismissed, already pinned or has no 3D location.' };
  if (document.pins.length >= MAX_SCAN_PINS) return { ok: false, error: `This room already has ${MAX_SCAN_PINS} pins. Remove a pin before adding another.` };
  return { ok: true, value: { ...document, pins: [...document.pins, { id: pinId, concernId: item.concernId, position: [...item.position], createdAt: at, origin: 'ai-suggestion', image }],
    suggestions: { ...layer, pinned: [...layer.pinned, id] } } };
}

/** Older pins have no suggestion-ID field. Match the same concern and scan-local point used when pinning. */
export function reconcileScanSuggestionPins(document: ScanDocumentV2): ScanDocumentV2 {
  const layer = document.suggestions;
  if (!layer) return document;
  const pinned = layer.pinned.filter((id) => {
    const item = layer.data.items.find((entry) => suggestionId(entry) === id);
    return item?.position && document.pins.some((pin) => pin.origin === 'ai-suggestion' && pin.concernId === item.concernId
      && pin.position.every((coordinate, index) => coordinate === item.position![index]));
  });
  return pinned.length === layer.pinned.length ? document : { ...document, suggestions: { ...layer, pinned } };
}
export function removeScanPin(document: ScanDocumentV2, id: string): ScanDocumentV2 {
  return reconcileScanSuggestionPins({ ...document, pins: document.pins.filter((pin) => pin.id !== id) });
}
