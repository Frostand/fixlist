import type { StoredCapture } from '../lib/capture-storage';
import { flagCheckAvailable, runFlagCheck } from './flag-check';

export interface FlagCheckState { available: boolean | null; checking: boolean; failed: boolean }
export const initialFlagCheckState: FlagCheckState = { available: null, checking: false, failed: false };
interface FlagCheckOptions {
  roomId: string;
  readRecord(): Promise<StoredCapture | null>;
  captureCurrent(): () => boolean;
  canStart(): boolean;
  onRecord(record: StoredCapture): void;
  onState(state: FlagCheckState): void;
}
/** Owns only capture-check presentation. It cannot answer or confirm checklist items. */
export function createFlagCheckSession(options: FlagCheckOptions) {
  let closed = false, state = initialFlagCheckState;
  let discovery: Promise<boolean> | null = null, pending: Promise<void> | null = null;
  const attempted = new Set<string>();
  function emit(update: Partial<FlagCheckState>) {
    if (closed) return;
    state = { ...state, ...update }; options.onState(state);
  }
  function discover(): Promise<boolean> {
    discovery ??= flagCheckAvailable().then((available) => {
      emit({ available, failed: false }); return available;
    }).catch(() => { discovery = null; emit({ failed: true }); return false; });
    return discovery;
  }
  function check(record: StoredCapture): Promise<void> {
    if (closed || !options.canStart()) return Promise.resolve();
    if (pending) return pending;
    const current = options.captureCurrent(), captureId = record.manifest.captureId;
    const isCurrent = () => !closed && current();
    if (!isCurrent()) return Promise.resolve();
    emit({ checking: true, failed: false });
    const work = async () => {
      try {
        if (!await discover() || !isCurrent()) return;
        // A private capture may change without changing the household revision.
        const before = await options.readRecord();
        if (!isCurrent()) return;
        if (before?.manifest.captureId !== captureId) throw new Error('capture-replaced');
        const outcome = await runFlagCheck(options.roomId, isCurrent);
        if (!isCurrent()) return;
        if (outcome === 'unavailable') { emit({ available: false }); return; }
        const saved = await options.readRecord();
        if (!isCurrent()) return;
        if (saved?.manifest.captureId !== captureId || !saved.flags) throw new Error('capture-not-saved');
        options.onRecord(saved);
      } catch {
        if (isCurrent()) emit({ failed: true });
      } finally {
        // Clearing a local spinner publishes no capture or household data.
        emit({ checking: false }); pending = null;
      }
    };
    pending = work(); return pending;
  }
  return {
    async load(record: StoredCapture | null): Promise<void> {
      if (closed || !await discover() || closed || !record || record.flags || attempted.has(record.manifest.captureId) || !options.canStart()) return;
      attempted.add(record.manifest.captureId);
      await check(record);
    },
    check,
    dispose() { closed = true; },
  };
}
