import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import fixtureFlags from '../../scan/tests/capture-parity/valid-flags.json';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, computePlan } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { parseCaptureBundle } from '../lib/capture-bundle';
import { createMemoryCaptureStore, type StoredCapture } from '../lib/capture-storage';
import { validateCaptureSuggestions } from '../lib/capture-suggestions';
import { createFlagCheckSession, initialFlagCheckState, type FlagCheckState } from './flag-check-state';
import { FlagCheckStatus, RoomCaptureContent } from './CaptureScreens';
const adapter = vi.hoisted(() => ({ available: vi.fn<() => Promise<boolean>>(), run: vi.fn<(roomId: string, isCurrent: () => boolean) => Promise<'saved' | 'unavailable'>>() }));
vi.mock('./flag-check', () => ({ flagCheckAvailable: adapter.available, runFlagCheck: adapter.run }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function harness(withFlags = false) {
  const parsed = await parseCaptureBundle(JSON.stringify(bundle)); if (!parsed.ok) throw new Error(parsed.error);
  const flags = validateCaptureSuggestions(fixtureFlags, parsed.value.manifest); if (!flags.ok) throw new Error(flags.error);
  const store = createMemoryCaptureStore(); await store.writeCapture(parsed.value.manifest, parsed.value.photos);
  if (withFlags) await store.writeFlags(bundle.roomId, flags.value);
  const record = (await store.read(bundle.roomId))!;
  let state = initialFlagCheckState, active = true, busy = false;
  const readRecord = vi.fn(() => store.read(bundle.roomId)), onRecord = vi.fn<(record: StoredCapture) => void>();
  const session = createFlagCheckSession({ roomId: bundle.roomId, readRecord, captureCurrent: () => () => active, canStart: () => !busy, onRecord, onState: (next) => { state = next; } });
  return { store, record, flags: flags.value, session, readRecord, onRecord, get state() { return state; }, cancel() { active = false; }, setBusy(value: boolean) { busy = value; } };
}
const render = (state: FlagCheckState) => renderToStaticMarkup(<FlagCheckStatus state={state} onCheck={() => {}} />);
beforeEach(() => { adapter.available.mockReset().mockResolvedValue(true); adapter.run.mockReset().mockResolvedValue('unavailable'); });
describe('capture flag-check lifecycle with a mocked adapter', () => {
  it('keeps the integration adapter explicitly unavailable until the parent connects it', async () => {
    const actual = await vi.importActual<typeof import('./flag-check')>('./flag-check');
    expect(await actual.flagCheckAvailable()).toBe(false); expect(await actual.runFlagCheck('living-room', () => true)).toBe('unavailable');
  });
  it('shows the unavailable line in a browser and never starts analysis', async () => {
    adapter.available.mockResolvedValue(false); const h = await harness();
    await h.session.load(h.record);
    expect(h.state).toEqual({ available: false, checking: false, failed: false }); expect(adapter.run).not.toHaveBeenCalled();
    const html = render(h.state); expect(html).toContain(translate('en', 'room.checkUnavailable')); expect(html).not.toContain('<button');
  });
  it('automatically checks a newly completed capture, displays progress, and re-reads after save', async () => {
    const h = await harness(), gate = deferred<void>(), started = deferred<void>();
    const household = createInitialState(scenario), before = structuredClone(household);
    adapter.run.mockImplementation(async (_roomId, isCurrent) => { started.resolve(); await gate.promise; await h.store.writeFlags(bundle.roomId, h.flags, isCurrent); return 'saved'; });
    const task = h.session.load(h.record); await started.promise;
    expect(h.state.checking).toBe(true); const html = render(h.state);
    expect(html).toContain('role="status"'); expect(html).toContain('flag-check-spinner'); expect(html).toContain(translate('en', 'room.checkingPhotos')); expect(html).not.toContain('Check photos again');
    gate.resolve(); await task;
    expect(h.readRecord).toHaveBeenCalledTimes(2); expect(h.onRecord).toHaveBeenCalledOnce(); expect(h.onRecord.mock.calls[0]![0].flags).toEqual(h.flags);
    expect(h.state).toEqual({ available: true, checking: false, failed: false });
    expect(household).toEqual(before); expect(computePlan(scenario, household)).toHaveLength(0);
    expect(adapter.run).toHaveBeenCalledWith(bundle.roomId, expect.any(Function));
  });
  it('distinguishes unchecked photos from a completed check with zero suggested spots', async () => {
    const h = await harness(), state = createInitialState(scenario);
    const html = renderToStaticMarkup(<RoomCaptureContent scenario={scenario} state={state} person={state.people[0]!} record={h.record} photoUrls={new Map()} selectedId={null} onSelect={() => {}} mode="plan" onMode={() => {}} dispatch={async () => ({ ok: true })} navigate={() => {}} />);
    expect(html).toContain(translate('en', 'room.flagsNotChecked')); expect(html).not.toContain(translate('en', 'room.flagsEmpty'));
  });
  it('does not automatically check an already flagged capture, but allows a manual recheck', async () => {
    const h = await harness(true); await h.session.load(h.record); expect(adapter.run).not.toHaveBeenCalled();
    expect(render(h.state)).toContain(translate('en', 'room.checkAgain'));
    adapter.run.mockImplementation(async (_roomId, isCurrent) => { await h.store.writeFlags(bundle.roomId, h.flags, isCurrent); return 'saved'; });
    await h.session.check(h.record); expect(adapter.run).toHaveBeenCalledOnce(); expect(h.onRecord).toHaveBeenCalledOnce();
  });
  it('attempts automatic analysis only once per capture after a failure; manual retry still works', async () => {
    const h = await harness(); adapter.run.mockRejectedValue(new Error('synthetic native failure'));
    await h.session.load(h.record); await h.session.load(h.record);
    expect(adapter.run).toHaveBeenCalledOnce(); expect(h.state.failed).toBe(true); expect(render(h.state)).toContain(translate('en', 'room.checkFailed'));
    expect(render(h.state)).not.toContain('synthetic native failure');
    adapter.run.mockImplementation(async (_roomId, isCurrent) => { await h.store.writeFlags(bundle.roomId, h.flags, isCurrent); return 'saved'; });
    await h.session.check(h.record); expect(adapter.run).toHaveBeenCalledTimes(2); expect(h.state.failed).toBe(false);
  });
  it('coalesces repeated activation while the same analysis is pending', async () => {
    const h = await harness(true), gate = deferred<'unavailable'>(); adapter.run.mockReturnValue(gate.promise);
    await h.session.load(h.record);
    const first = h.session.check(h.record), second = h.session.check(h.record); expect(second).toBe(first);
    gate.resolve('unavailable'); await first; expect(adapter.run).toHaveBeenCalledOnce(); expect(h.state.available).toBe(false);
  });
  it('does not analyze before capture exists, then auto-runs when the room receives the saved record', async () => {
    const h = await harness(); await h.session.load(null); expect(adapter.run).not.toHaveBeenCalled();
    await h.session.load(h.record); expect(adapter.run).toHaveBeenCalledOnce();
  });
  it('cancels stale callbacks and does not publish flags after the route/revision guard expires', async () => {
    const h = await harness(), gate = deferred<void>(), started = deferred<void>();
    adapter.run.mockImplementation(async (_roomId, isCurrent) => { started.resolve(); await gate.promise; if (isCurrent()) await h.store.writeFlags(bundle.roomId, h.flags, isCurrent); return 'saved'; });
    const task = h.session.load(h.record); await started.promise; h.cancel(); gate.resolve(); await task;
    expect(h.onRecord).not.toHaveBeenCalled(); expect((await h.store.read(bundle.roomId))!.flags).toBeNull(); expect(h.state.checking).toBe(false);
  });
  it('does not publish or write after the room session is disposed', async () => {
    const h = await harness(), gate = deferred<void>(), started = deferred<void>();
    adapter.run.mockImplementation(async (_roomId, isCurrent) => { started.resolve(); await gate.promise; if (isCurrent()) await h.store.writeFlags(bundle.roomId, h.flags, isCurrent); return 'saved'; });
    const task = h.session.load(h.record); await started.promise; h.session.dispose(); gate.resolve(); await task;
    expect(h.onRecord).not.toHaveBeenCalled(); expect((await h.store.read(bundle.roomId))!.flags).toBeNull();
  });
  it('refuses analysis of a different capture and refuses publishing a different saved capture', async () => {
    for (const replaceAfterAnalysis of [false, true]) {
      const h = await harness(); const changed = { ...h.record, manifest: { ...h.record.manifest, captureId: 'capture-other' }, flags: h.flags };
      h.readRecord.mockReset().mockResolvedValue(changed);
      if (replaceAfterAnalysis) { h.readRecord.mockResolvedValueOnce(h.record); adapter.run.mockResolvedValue('saved'); }
      await h.session.load(h.record); expect(h.onRecord).not.toHaveBeenCalled(); expect(h.state.failed).toBe(true);
      if (!replaceAfterAnalysis) expect(adapter.run).not.toHaveBeenCalled();
    }
  });
  it('does not start while another room operation owns the capture', async () => {
    const h = await harness(); h.setBusy(true); await h.session.load(h.record); await h.session.check(h.record); expect(adapter.run).not.toHaveBeenCalled();
    h.setBusy(false); await h.session.load(h.record); expect(adapter.run).toHaveBeenCalledOnce();
  });
  it.each(['en', 'es'] as const)('translates progress and unavailable states in %s', (language) => {
    for (const [state, key] of [[{ available: true, checking: true, failed: false }, 'room.checkingPhotos'], [{ available: false, checking: false, failed: false }, 'room.checkUnavailable']] as const) {
      const html = renderToStaticMarkup(<I18nProvider language={language}><FlagCheckStatus state={state} onCheck={() => {}} /></I18nProvider>);
      expect(html).toContain(translate(language, key));
    }
  });
});
