import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomTour, JobRoomTours, hazardEvidence } from './RoomTour';
import { VolunteerJob } from './Volunteer';
import { Button } from './UI';
import { createSeedState } from '../../community';
import { tourFixture, reviewFixture } from '../../lib/__fixtures__/capture-tour';
import { createMemoryCaptureStore } from '../../lib/capture-storage';
import { evidence as validEvidence } from '../../community/validation';
import { tourHazards } from '../../lib/room-tour-geometry';
interface Driver { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as Driver | null, store: null as import('../../lib/capture-storage').CaptureStore | null }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useState(initial: unknown) {
      const d = runtime.active; if (!d) return actual.useState(initial);
      const i = d.cursor++; if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial;
      return [d.values[i], (v: unknown) => { d.values[i] = typeof v === 'function' ? v(d.values[i]) : v; }];
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const d = runtime.active; if (!d) return actual.useMemo(factory, deps);
      const i = d.cursor++, before = d.values[i] as { deps: readonly unknown[]; value: T } | undefined;
      if (!before || deps.some((v, j) => !Object.is(v, before.deps[j]))) d.values[i] = { deps, value: factory() };
      return (d.values[i] as { value: T }).value;
    },
    useRef(initial: unknown) { const d = runtime.active; if (!d) return actual.useRef(initial); const i = d.cursor++; return d.values[i] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const d = runtime.active; if (!d) return actual.useEffect(effect, deps);
      const i = d.cursor++, before = d.values[i] as readonly unknown[] | undefined;
      if (!before || !deps || deps.some((v, j) => !Object.is(v, before[j]))) {
        d.values[i] = deps; d.effects.push(() => { d.cleanups[i]?.(); d.cleanups[i] = effect() ?? (() => {}); });
      }
    },
  };
});
vi.mock('../../i18n', async original => {
  const actual = await original<typeof import('../../i18n')>();
  return { ...actual, useT: () => Object.assign((key: Parameters<typeof actual.translate>[1], values?: Parameters<typeof actual.translate>[2]) => actual.translate('en', key, values), { language: 'en' }), useLanguage: () => 'en' };
});
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<{ children?: ReactNode }>(tree)) return [];
  return [tree as ReactElement<Record<string, unknown>>, ...nodes(tree.props.children)];
}
function driver(render: () => ReactNode) {
  const d: Driver = { cursor: 0, values: [], effects: [], cleanups: [] };
  return { render() { d.cursor = 0; runtime.active = d; try { return render(); } finally { runtime.active = null; for (const effect of d.effects.splice(0)) effect(); } }, dispose() { for (const cleanup of d.cleanups) cleanup?.(); } };
}
const views: Array<ReturnType<typeof driver>> = [];
function view(render: () => ReactNode) { const value = driver(render); views.push(value); return value; }
function press(tree: ReactNode, text: string) {
  const button = nodes(tree).find(n => (n.type === Button || n.type === 'button') && n.props.children === text);
  expect(button, text).toBeDefined(); (button!.props.onClick as () => void)();
}
const flush = () => new Promise(resolve => setImmediate(resolve));

vi.mock('../../lib/capture-storage', async original => ({ ...await original<typeof import('../../lib/capture-storage')>(), getCommunityCaptureStore: () => runtime.store }));
afterEach(() => { views.splice(0).forEach(v => v.dispose()); });
describe('shared resident and volunteer 360 tour', () => {
  it('changes stops, focuses a panorama hazard at its stop, switches dollhouse and drafts generic reviewable evidence', async () => {
    const record = await tourFixture(); record.aiReview = reviewFixture(record.manifest); const onDraft = vi.fn(), v = view(() => RoomTour({ record, onDraft }));
    const renderer = () => nodes(v.render()).find(n => n.props.panoramas)!;
    expect(renderer().props.stop).toMatchObject({ stopId: 's1' }); press(v.render(), 'Spot 2'); expect(renderer().props.stop).toMatchObject({ stopId: 's2' });
    const list = nodes(v.render()).find(n => n.props.className === 'c-tour-hazard-focus')!; (list.props.onClick as () => void)();
    expect(renderer().props.stop).toMatchObject({ stopId: 's1' }); expect(renderer().props.selectedId).toBe('ai-panorama-s1-0');
    press(v.render(), 'Ask for help'); expect(onDraft.mock.calls[0]![0]).toMatchObject({ category: 'safety', engine: 'rules' }); expect(validEvidence(onDraft.mock.calls[0]![1])).toBe(true);
    press(v.render(), 'Dollhouse'); expect(nodes(v.render()).some(n => n.props.panoramas)).toBe(false); press(v.render(), '360° view'); expect(renderer()).toBeDefined();
  });
  it('loads only the authorized resident/epoch store for job evidence, deduplicates rooms, and fails closed without scope', async () => {
    const record = await tourFixture(); record.aiReview = reviewFixture(record.manifest);
    runtime.store = createMemoryCaptureStore(); await runtime.store.writeCapture(record.manifest, record.photos, false, undefined, null, { videos: null, videoBlobs: new Map(), panoramaBlobs: record.panoramaBlobs! });
    const h = tourHazards(record.manifest, record.aiReview, [], record.manifest.tour!.stops[0]!)[0]!, evidence = hazardEvidence(record, h);
    const missing = view(() => JobRoomTours({ evidence: [evidence] })); missing.render(); await flush(); expect(nodes(missing.render()).some(n => n.type === RoomTour)).toBe(false);
    let allowed = true; const v = view(() => JobRoomTours({ evidence: [evidence, evidence], ownerId: 'elder-a', resetEpoch: 'one', isCurrent: () => allowed })); v.render(); await flush();
    await vi.waitFor(() => expect(nodes(v.render()).filter(n => n.type === RoomTour)).toHaveLength(1)); allowed = false; expect(nodes(v.render()).some(n => n.type === RoomTour)).toBe(false);
    const state = createSeedState('2026-10-25T20:00:00Z'), job = { ...state.jobs[0]!, evidence: [evidence] };
    const scope = { ownerId: job.elderId, resetEpoch: 'one', isCurrent: () => true };
    const volunteer = view(() => VolunteerJob({ job, elder: state.accounts.find(a => a.id === job.elderId)!, address: null, profile: state.volunteers[0]!, match: null, onAccept: () => false, onStep: () => false, onMessages: () => {}, captureScope: scope }));
    const child = nodes(volunteer.render()).find(n => n.type === JobRoomTours)!; expect(child.props).toMatchObject({ ownerId: job.elderId, resetEpoch: 'one', evidence: [evidence] });
  });
});
