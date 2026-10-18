import type { DemoState } from '../domain/workflow';

export interface PrintSnapshot { readonly state: DemoState; readonly generatedAt: string }
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}
/** UI integration owns the clock; snapshots are isolated from subsequent commands. */
export function createPrintSnapshot(state: DemoState): PrintSnapshot {
  return Object.freeze({ state: freezeDeep(structuredClone(state)), generatedAt: new Date().toISOString() });
}
