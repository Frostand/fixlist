import type { DemoState } from '../domain/workflow';
import type { ScanPin } from './scan-model';

export interface PrintScanPin { readonly id: string; readonly concernId: string; readonly origin: 'family' | 'ai-suggestion'; readonly image: string | null }
export interface PrintSnapshot { readonly state: DemoState; readonly generatedAt: string; readonly scanPins: readonly PrintScanPin[] }
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}
/** Pure snapshot: the UI owns the clock and validated scan pins. No blob, canvas, storage or DOM reads. */
export function createPrintSnapshot(state: DemoState, generatedAt: string, pins: readonly ScanPin[] = []): PrintSnapshot {
  const scanPins = pins.map((pin) => ({ id: pin.id, concernId: pin.concernId, origin: pin.origin ?? 'family', image: pin.image ?? null }));
  return freezeDeep({ state: structuredClone(state), generatedAt, scanPins });
}

/** Observe photo resolution, then decode every report image. One watchdog, no polling. */
export function waitForPrintReady(root: Node & ParentNode, { signal, timeoutMs = 8000 }: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    let settled = false, decoding = false, revision = 0;
    const observer = new MutationObserver(() => { revision++; check(); });
    const timeout = setTimeout(() => finish(new Error('photo-timeout')), timeoutMs);
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    function finish(error?: unknown) {
      if (settled) return; settled = true; observer.disconnect(); clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    }
    function check() {
      if (settled) return;
      if (root.querySelector('[data-photo-failed=true]')) { finish(new Error('photo-missing')); return; }
      if (decoding || root.querySelector('[data-photo-pending=true]')) return;
      decoding = true; const before = revision;
      void Promise.resolve().then(() => Promise.all(Array.from(root.querySelectorAll<HTMLImageElement>('img'), (img) => img.decode()))).then(() => {
        decoding = false;
        if (before !== revision) check(); else finish();
      }, (error: unknown) => finish(error));
    }
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-photo-pending', 'data-photo-failed', 'src'] });
    signal?.addEventListener('abort', cancel, { once: true }); check();
  });
}
