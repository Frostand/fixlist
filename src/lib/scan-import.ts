import { importScanFiles, type ScanDocumentV2, type ScanResult } from './scan-model';
import { MAX_SUGGESTIONS_BYTES, parseScanSuggestions, type SuggestionCatalog } from './scan-suggestions';

/** Both the file picker and dev-only local loader enter here; neither can bypass validation. */
export async function importScanSelection(files: readonly File[], catalog: SuggestionCatalog): Promise<ScanResult<ScanDocumentV2>> {
  if (files.length < 1 || files.length > 3) return { ok: false, error: 'Choose one scan, optional scene.json and optional suggestions.json together.' };
  const suggestionFiles = files.filter((file) => file.name.toLowerCase() === 'suggestions.json');
  if (suggestionFiles.length > 1) return { ok: false, error: 'Choose at most one suggestions.json.' };
  const result = await importScanFiles(files.filter((file) => file.name.toLowerCase() !== 'suggestions.json'));
  if (!result.ok) return result;
  const document: ScanDocumentV2 = { version: 2, asset: result.value, flipUpright: false, pins: [], suggestions: null };
  const suggestions = suggestionFiles[0];
  if (suggestions) {
    if (suggestions.size > MAX_SUGGESTIONS_BYTES) return { ok: false, error: 'suggestions.json exceeds the 4 MiB limit.' };
    let json: string;
    try { json = await suggestions.text(); } catch { return { ok: false, error: 'suggestions.json could not be read. Select the local file again.' }; }
    const parsed = parseScanSuggestions(json, catalog, result.value);
    if (!parsed.ok) return parsed;
    document.suggestions = { data: parsed.value.data, dismissed: [], pinned: [], droppedItems: parsed.value.dropped };
  }
  return { ok: true, value: document };
}
