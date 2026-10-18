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
