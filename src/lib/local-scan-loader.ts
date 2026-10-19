import { importScanSelection } from './scan-import';
import { MAX_METADATA_BYTES, MAX_SCAN_BYTES, type ScanDocumentV2, type ScanResult } from './scan-model';
import { MAX_SUGGESTIONS_BYTES, type SuggestionCatalog } from './scan-suggestions';

export interface LocalDemoScan { name: string; sizes: { 'scene.splat': number; 'scene.json': number | null; 'suggestions.json': number | null } }
export const localScanName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
export function validateLocalScanIndex(value: unknown): LocalDemoScan[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  const names = new Set<string>();
  const result: LocalDemoScan[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || !('name' in entry) || !localScanName(entry.name) || names.has(entry.name)
      || !('sizes' in entry) || typeof entry.sizes !== 'object' || entry.sizes === null) return [];
    const sizes = entry.sizes;
    if (!('scene.splat' in sizes) || !('scene.json' in sizes) || !('suggestions.json' in sizes)) return [];
    const validSize = (n: unknown, cap: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= cap;
    if (!validSize(sizes['scene.splat'], MAX_SCAN_BYTES) || (sizes['scene.json'] !== null && !validSize(sizes['scene.json'], MAX_METADATA_BYTES))
      || (sizes['suggestions.json'] !== null && !validSize(sizes['suggestions.json'], MAX_SUGGESTIONS_BYTES))) return [];
    names.add(entry.name);
    result.push({ name: entry.name, sizes: { 'scene.splat': sizes['scene.splat'], 'scene.json': sizes['scene.json'], 'suggestions.json': sizes['suggestions.json'] } });
  }
  return result;
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export const LOCAL_SCAN_TIMEOUT_MS = 30_000;
export const SCAN_LOAD_TIMEOUT_MS = 60_000;

/** One UI operation includes transfer and renderer startup. Closing invalidates publication immediately. */
export function createScanLoadTask(onStop: (reason: 'cancelled' | 'timeout') => void, timeoutMs = SCAN_LOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  let active = true;
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  function finish() { active = false; clearTimeout(timer); }
  function stop(reason: 'cancelled' | 'timeout') {
    if (!active) return;
    finish(); controller.abort(); onStop(reason);
  }
  return { signal: controller.signal, isCurrent: () => active, finish, cancel: () => stop('cancelled'), dispose: () => { finish(); controller.abort(); } };
}
export async function getLocalDemoScans(fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<LocalDemoScan[]> {
  try {
    const response = await fetcher('/local-scans/index.json', { cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!response.ok) return [];
    const text = await response.text();
    if (text.length > 64 * 1024) return [];
    return validateLocalScanIndex(JSON.parse(text));
  } catch { return []; }
}
export async function loadLocalDemoScan(entry: LocalDemoScan, catalog: SuggestionCatalog, fetcher: Fetcher = fetch, signal?: AbortSignal, timeoutMs = LOCAL_SCAN_TIMEOUT_MS): Promise<ScanResult<ScanDocumentV2> & { failure?: 'cancelled' | 'timeout' }> {
  if (validateLocalScanIndex([entry]).length !== 1) return { ok: false, error: 'The local scan listing is invalid. Reload the page to refresh it.' };
  const controller = new AbortController();
  let failure: 'cancelled' | 'timeout' | undefined;
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  function abort(reason: 'cancelled' | 'timeout') { failure ??= reason; controller.abort(); rejectAbort(new Error(reason)); }
  const onAbort = () => abort('cancelled');
  const timer = setTimeout(() => abort('timeout'), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const operation = (async () => {
      if (signal?.aborted) { onAbort(); return await aborted; }
      const files = await Promise.all((['scene.splat', 'scene.json', 'suggestions.json'] as const).filter((name) => entry.sizes[name] !== null).map(async (name) => {
        const response = await fetcher(`/local-scans/${entry.name}/${name}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Local scan file unavailable.');
        const blob = await response.blob();
        if (controller.signal.aborted) throw new Error('cancelled');
        if (blob.size !== entry.sizes[name]) throw new Error('Local scan changed.');
        return new File([blob], name);
      }));
      const result = await importScanSelection(files, catalog);
      if (controller.signal.aborted) throw new Error('cancelled');
      return result;
    })();
    return await Promise.race([operation, aborted]);
  } catch {
    return { ok: false, ...(failure ? { failure } : {}), error: failure === 'timeout' ? 'scan-load-timeout' : failure === 'cancelled' ? 'scan-load-cancelled' : 'The local demo scan could not be loaded or changed while loading. Refresh the page and retry.' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort); controller.abort();
  }
}
