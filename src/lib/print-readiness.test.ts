import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForPrintReady } from './print';
import { printCurrentPage } from './native-print';

function report() {
  const state = { pending: false, failed: false, images: [] as Pick<HTMLImageElement, 'decode'>[] }, disconnect = vi.fn(), observe = vi.fn();
  let change = () => {};
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { change = callback; } disconnect = disconnect; observe = observe; });
  const root = { querySelector: (selector: string) => selector.includes('failed') ? state.failed ? {} : null : state.pending ? {} : null, querySelectorAll: () => state.images } as unknown as Node & ParentNode;
  return { root, state, disconnect, observe, change: () => change() };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('event driven print readiness', () => {
  it('resolves a report without photos and removes the observer and watchdog', async () => {
    vi.useFakeTimers(); const r = report(); await expect(waitForPrintReady(r.root)).resolves.toBeUndefined(); expect(r.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for explicit photo resolution and image decoding with only one timeout, never a polling timer', async () => {
    vi.useFakeTimers(); const timeout = vi.spyOn(globalThis, 'setTimeout'), r = report(); r.state.pending = true;
    const decode = vi.fn(async () => {}); r.state.images = [{ decode }];
    const ready = waitForPrintReady(r.root); expect(decode).not.toHaveBeenCalled(); expect(r.observe).toHaveBeenCalledOnce();
    r.state.pending = false; r.change(); await ready; expect(decode).toHaveBeenCalledOnce(); expect(timeout).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects an explicit photo failure and cleans up', async () => {
    const r = report(); r.state.pending = true; const ready = waitForPrintReady(r.root); r.state.failed = true; r.change();
    await expect(ready).rejects.toThrow('photo-missing'); expect(r.disconnect).toHaveBeenCalledOnce();
  });
  it('rejects failed image decoding instead of opening an incomplete print sheet', async () => {
    const r = report(); r.state.images = [{ decode: async () => { throw Error('decode-failed'); } }];
    await expect(waitForPrintReady(r.root)).rejects.toThrow('decode-failed'); expect(r.disconnect).toHaveBeenCalledOnce();
  });
  it('handles synchronous decoder exceptions with the same cleanup', async () => {
    vi.useFakeTimers(); const r = report(); r.state.images = [{ decode: () => { throw Error('decode-failed'); } }];
    await expect(waitForPrintReady(r.root)).rejects.toThrow('decode-failed'); expect(r.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects cancellation while loading and removes the observer and watchdog', async () => {
    vi.useFakeTimers(); const r = report(), controller = new AbortController(); r.state.pending = true;
    const ready = waitForPrintReady(r.root, { signal: controller.signal }); controller.abort();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' }); expect(r.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects an already cancelled preparation before observing', async () => {
    const r = report(), controller = new AbortController(); controller.abort();
    await expect(waitForPrintReady(r.root, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(r.observe).not.toHaveBeenCalled();
  });
  it('stops waiting at the watchdog deadline without polling', async () => {
    vi.useFakeTimers(); const r = report(); r.state.pending = true;
    const ready = expect(waitForPrintReady(r.root, { timeoutMs: 8000 })).rejects.toThrow('photo-timeout');
    await vi.advanceTimersByTimeAsync(8000); await ready; expect(r.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rechecks when report images change during decoding', async () => {
    const r = report(); let finish = () => {}; r.state.images = [{ decode: () => new Promise<void>((resolve) => { finish = resolve; }) }];
    const ready = waitForPrintReady(r.root); await Promise.resolve();
    const replacement = vi.fn(async () => {}); r.state.images = [{ decode: replacement }]; r.change(); finish();
    await ready; expect(replacement).toHaveBeenCalledOnce(); expect(r.disconnect).toHaveBeenCalledOnce();
  });
  it('cancels a decoder still in flight and ignores its late result', async () => {
    const r = report(), controller = new AbortController(); let finish = () => {};
    r.state.images = [{ decode: () => new Promise<void>((resolve) => { finish = resolve; }) }];
    const ready = waitForPrintReady(r.root, { signal: controller.signal }); await Promise.resolve(); controller.abort();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' }); finish(); await Promise.resolve(); expect(r.disconnect).toHaveBeenCalledOnce();
  });
  it('does not invoke printing after cancellation, and keeps browser printing usable otherwise', async () => {
    const print = vi.fn(); vi.stubGlobal('window', { print }); const controller = new AbortController(); controller.abort();
    await expect(printCurrentPage('FixList', controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(print).not.toHaveBeenCalled();
    await printCurrentPage('FixList'); expect(print).toHaveBeenCalledOnce();
  });
});
