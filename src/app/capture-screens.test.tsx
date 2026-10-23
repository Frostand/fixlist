import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import fixtureFlags from '../../scan/tests/capture-parity/valid-flags.json';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, computePlan } from '../domain/workflow';
import { run } from '../domain/roles-test-helpers';
import { createUiDispatch } from './ui-controller';
import { DEMO_STORAGE_KEY } from '../lib/demo-storage';
import { I18nProvider, translate } from '../i18n';
import { validateCaptureManifest } from '../lib/capture-model';
import { createMemoryCaptureStore } from '../lib/capture-storage';
import { parseCaptureBundle } from '../lib/capture-bundle';
import { NATIVE_CAPTURE_STRING_KEYS } from '../lib/capture-types';
import { validateCaptureSuggestions } from '../lib/capture-suggestions';
import { canUseCaptures, capturePrompts, CaptureFlow, GuidedPhotoTour, RoomCaptureContent, RoomPage } from './CaptureScreens';
import { RoomList } from './ResidentScreens';
import { RoomSketch } from './RoomSketch';
import { createCaptureRouteEpoch } from './App';
import { visibleHouseholdFor } from '../domain/role-views';
import { activeTab, parentRoute, parseRoute } from './routes';

describe('capture screens preserve roles and human decisions', () => {
  it.each(['en', 'es'] as const)('labels separate camera/library inputs and includes every native string in %s', (language) => {
    const prompts = capturePrompts(scenario, 'bathroom', (key, values) => translate(language, key, values));
    expect(prompts.map((p) => p.checklistItemId)).toEqual([null, 'shower-surface-check', 'bathroom-support-check']);
    const html = renderToStaticMarkup(<I18nProvider language={language}><GuidedPhotoTour prompts={prompts} onSave={async () => {}} onCancel={() => {}} /></I18nProvider>);
    expect(html.match(/capture="environment"/g)).toHaveLength(1); expect(html.match(/accept="image\/\*"/g)).toHaveLength(2);
    expect(html.match(/type="file"[^>]*hidden=""/g)).toHaveLength(2); expect(html).toContain(translate(language, 'scanViewer.takePhoto')); expect(html).toContain(translate(language, 'scanViewer.choosePhoto')); expect(html).toContain('disabled=""');
    for (const key of NATIVE_CAPTURE_STRING_KEYS) expect(translate(language, `capture.native.${key}`).length).toBeGreaterThan(2);
  });
  it('never mounts capture screens for a volunteer or an ungranted helper', () => {
    let state = createInitialState(scenario); state = { ...state, delegations: [] };
    for (const person of state.people.filter((p) => p.role !== 'resident')) {
      const props = { scenario, state, person, roomId: 'living-room', dispatch: async () => ({ ok: true as const }), navigate: () => {} };
      expect(canUseCaptures(state, person)).toBe(false);
      for (const element of [<RoomPage {...props} />, <CaptureFlow {...props} />]) {
        const html = renderToStaticMarkup(element); expect(html).toContain(translate('en', 'person.noGrant')); expect(html).not.toContain('type="file"'); expect(html).not.toContain('Start walk-through');
      }
    }
    expect(canUseCaptures(state, state.people.find((p) => p.role === 'resident')!)).toBe(true);
    state = { ...state, delegations: [{ personId: 'sam', scopes: ['checklist'], updatedBy: { actorId: 'margaret', at: '2026-10-18T18:00:00.000Z' } }] };
    expect(canUseCaptures(state, state.people.find((p) => p.id === 'sam')!)).toBe(true);
  });
  it('shows per-room capture links only under checklist permission', () => {
    const state = createInitialState(scenario), person = state.people[0]!;
    const html = renderToStaticMarkup(<RoomList scenario={scenario} state={state} person={person} household={visibleHouseholdFor(scenario, state, person.id)!} dispatch={async () => ({ ok: true })} navigate={() => {}} />);
    expect(html.match(/href="#\/r\/room\//g)).toHaveLength(scenario.rooms.length);
    expect(html).not.toContain('Walk-through and photos');
  });
  it('renders only review flags with original question, limitation, experimental score and explicit decision instructions', () => {
    const parsed = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!parsed.ok) throw new Error(parsed.error);
    const flags = validateCaptureSuggestions(fixtureFlags, parsed.value); if (!flags.ok) throw new Error(flags.error);
    const render = (closed: boolean | null) => renderToStaticMarkup(<RoomCaptureContent scenario={scenario} state={createInitialState(scenario)} person={createInitialState(scenario).people[0]!} dispatch={async () => ({ ok: true })} record={{ manifest: { ...parsed.value, outline: closed === null ? null : { ...parsed.value.outline!, closed } }, flags: flags.value, photos: new Map() }} photoUrls={new Map([['p01', 'blob:synthetic']])} selectedId="rug-check" onSelect={() => {}} mode="plan" onMode={() => {}} navigate={() => {}} />);
    const html = render(true);
    expect(html).toContain(fixtureFlags.items[0]!.question); expect(html).toContain(fixtureFlags.items[0]!.limitation);
    expect(html).toContain('Experimental model score 0.77 (uncalibrated; not a probability)'); expect(html).toContain(translate('en', 'room.aiLabel')); expect(html).toContain(translate('en', 'room.reviewNotice')); expect(html).toContain('<details class="flag-details">');
    expect(html).toContain('#/r/question/rug-check'); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Room sketch view'); expect(render(false)).not.toContain('Room sketch view'); expect(render(null)).toContain('No room outline. Photos only.');
    expect(html).not.toContain('Confirm concern'); expect(html).not.toContain('type="radio"'); expect(html).not.toContain('% likely'); expect(html).not.toContain('handrail-check');
  });
  it('keeps catalog-wide flags stored but offers only this room\'s checklist and sketch decisions', () => {
    const manifest = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!manifest.ok) throw new Error(manifest.error);
    const allSuggested = structuredClone(fixtureFlags);
    for (const item of allSuggested.items) { item.perPhoto.forEach((row) => { row.rawProbability = row.probability = .77; }); item.score = .77; item.status = 'suggested'; }
    const flags = validateCaptureSuggestions(allSuggested, manifest.value); if (!flags.ok) throw new Error(flags.error);
    const savedManifest = manifest.value, savedFlags = flags.value;
    const state = createInitialState(scenario), navigate = vi.fn(), dispatch = vi.fn(async () => ({ ok: true as const }));
    let tree: ReactNode;
    function Probe() { tree = RoomCaptureContent({ scenario, state, person: state.people[0]!, dispatch, navigate, record: { manifest: savedManifest, photos: new Map(), flags: savedFlags }, photoUrls: new Map(), selectedId: null, onSelect: () => {}, mode: 'plan', onMode: () => {} }); return tree; }
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain(allSuggested.items[0]!.question);
    for (const item of allSuggested.items.slice(1)) expect(html).not.toContain(item.question);
    expect(elements(tree, 'article')).toHaveLength(1);
    const sketch = components(tree, RoomSketch)[0]!;
    expect((sketch.props.flags as { checklistItemId: string }[]).map((flag) => flag.checklistItemId)).toEqual(['rug-check']);
    expect(flags.value.items).toHaveLength(8);
    expect(dispatch).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('view/import never answers or confirms; Add and Ask are local navigation; Not a problem is an explicit No', async () => {
    let state = createInitialState(scenario);
    const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const dispatch = createUiDispatch({ scenario, storage, getState: () => state, publish: (next) => { state = next; }, clock: () => '2026-10-18T18:00:00.000Z', onError: () => {} });
    const manifest = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!manifest.ok) throw new Error(manifest.error);
    const flags = validateCaptureSuggestions(fixtureFlags, manifest.value); if (!flags.ok) throw new Error(flags.error);
    const savedManifest = manifest.value, savedFlags = flags.value;
    const before = structuredClone(state), navigate = vi.fn();
    const captureStore = createMemoryCaptureStore(), parsedBundle = await parseCaptureBundle(JSON.stringify(bundle));
    if (!parsedBundle.ok) throw new Error(parsedBundle.error);
    await captureStore.writeCapture(parsedBundle.value.manifest, parsedBundle.value.photos);
    await captureStore.writeFlags(parsedBundle.value.manifest.roomId, savedFlags);
    expect((await captureStore.read(parsedBundle.value.manifest.roomId))?.flags).toEqual(savedFlags);
    expect(state).toEqual(before);
    let tree: ReactNode;
    function Probe() { tree = RoomCaptureContent({ scenario, state, person: state.people[0]!, dispatch, navigate, record: { manifest: savedManifest, photos: new Map(), flags: savedFlags }, photoUrls: new Map(), selectedId: null, onSelect: () => {}, mode: 'plan', onMode: () => {} }); return tree; }
    renderToStaticMarkup(<Probe />);
    expect(state).toEqual(before); expect(computePlan(scenario, state)).toHaveLength(0); expect(values.has(DEMO_STORAGE_KEY)).toBe(false);
    const buttons = elements(tree, 'button');
    await (buttons.find((b) => b.props.children === translate('en', 'room.add'))!.props.onClick as () => Promise<void>)();
    expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: 'rug-check' }); expect(state).toEqual(before);
    await (buttons.find((b) => b.props.children === translate('en', 'room.askHelper', { name: 'Sam' }))!.props.onClick as () => Promise<void>)();
    expect(navigate).toHaveBeenLastCalledWith({ screen: 'people' }); expect(state).toEqual(before);
    await (buttons.find((b) => b.props.children === translate('en', 'room.notProblem'))!.props.onClick as () => Promise<void>)();
    expect(state.checklistAnswers['rug-check']).toBe('no'); expect(state.confirmations['rug-concern']?.humanConfirmed).toBe(false); expect(computePlan(scenario, state)).toHaveLength(0);
    const savedNo = renderToStaticMarkup(<Probe />);
    expect(savedNo).toContain('data-checklist-answer="no"'); expect(savedNo).toContain(`${translate('en', 'room.related')}: ${translate('en', 'check.no')}`);
    expect((await dispatch({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' })).ok).toBe(true); expect(computePlan(scenario, state)).toHaveLength(0);
    expect((await dispatch({ type: 'confirm_concern', concernId: 'rug-concern' })).ok).toBe(true); expect(computePlan(scenario, state)).toHaveLength(1);
    const savedYes = renderToStaticMarkup(<Probe />);
    expect(savedYes).toContain('data-checklist-answer="yes"'); expect(savedYes).toContain(`${translate('en', 'room.related')}: ${translate('en', 'check.yes')} · ${translate('en', 'check.confirmed')}`);
    // The existing No command clears prior confirmation through the domain, too.
    await (buttons.find((b) => b.props.children === translate('en', 'room.notProblem'))!.props.onClick as () => Promise<void>)();
    expect(computePlan(scenario, state)).toHaveLength(0);
  });
  it('blocks retained decision callbacks when the live actor/scope/revision guard expires', async () => {
    const state = createInitialState(scenario), dispatch = vi.fn(async () => ({ ok: true as const })), navigate = vi.fn();
    const manifest = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!manifest.ok) throw new Error(manifest.error);
    const flags = validateCaptureSuggestions(fixtureFlags, manifest.value); if (!flags.ok) throw new Error(flags.error);
    const record = { manifest: manifest.value, photos: new Map(), flags: flags.value };
    let current = true, tree: ReactNode;
    function Probe() { tree = RoomCaptureContent({ scenario, state, person: state.people[0]!, dispatch, navigate, canContinue: () => current, record, photoUrls: new Map(), selectedId: null, onSelect: () => {}, mode: 'plan', onMode: () => {} }); return tree; }
    renderToStaticMarkup(<Probe />); current = false;
    for (const key of ['room.add', 'room.notProblem'] as const) await (elements(tree, 'button').find((b) => b.props.children === translate('en', key))!.props.onClick as () => Promise<void>)();
    expect(dispatch).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('a checklist helper can propose and answer but cannot confirm without the existing confirm grant', async () => {
    let state = run(createInitialState(scenario), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    state = run(state, { type: 'select_person', personId: 'sam' });
    const values = new Map<string, string>([[DEMO_STORAGE_KEY, JSON.stringify(state)]]), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const dispatch = createUiDispatch({ scenario, storage, getState: () => state, publish: (next) => { state = next; }, clock: () => '2026-10-18T18:00:00.000Z', onError: () => {} });
    expect(canUseCaptures(state, state.people.find((p) => p.id === 'sam')!)).toBe(true);
    expect((await dispatch({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' })).ok).toBe(true);
    expect(await dispatch({ type: 'confirm_concern', concernId: 'rug-concern' })).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(computePlan(scenario, state)).toHaveLength(0);
  });
  it('keeps an in-flight room read current across equivalent popstate/hashchange routes', async () => {
    const roomRoute = parseRoute('#/r/room/living-room'), routes = createCaptureRouteEpoch(roomRoute);
    const store = createMemoryCaptureStore(), parsedBundle = await parseCaptureBundle(JSON.stringify(bundle));
    if (!parsedBundle.ok) throw new Error(parsedBundle.error);
    await store.writeCapture(parsedBundle.value.manifest, parsedBundle.value.photos);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; }), current = routes.capture();
    const roomRead = pending.then(() => store.read('living-room')).then((record) => { if (!current()) throw new Error('expired'); return record; });
    // Browsers may emit both events for one history traversal. Parsing them
    // creates different objects, while RoomPage keeps the same room/store deps.
    for (const event of ['popstate', 'hashchange']) {
      const equivalent = parseRoute('#/r/room/living-room');
      expect(equivalent, event).not.toBe(roomRoute); routes.move(equivalent);
    }
    release();
    expect((await roomRead)?.manifest.captureId).toBe(bundle.captureId);
    expect(current()).toBe(true);
  });
  it('permanently expires retained room work after leaving and re-entering the same room', async () => {
    const routes = createCaptureRouteEpoch(parseRoute('#/r/room/living-room')), current = routes.capture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const roomRead = pending.then(() => { if (!current()) throw new Error('expired'); });
    routes.move(parseRoute('#/r/question/rug-check')); routes.move(parseRoute('#/r/room/living-room'));
    release(); await expect(roomRead).rejects.toThrow('expired');
    expect(current()).toBe(false); expect(routes.capture()()).toBe(true);
  });
  it('bounds catalog room routes and assigns their room tab in every layout', () => {
    for (const screen of ['room', 'capture'] as const) {
      expect(parseRoute(`#/r/${screen}/living-room`)).toEqual({ role: 'r', screen, id: 'living-room' });
      expect(parseRoute(`#/r/${screen}/unknown`)).toEqual({ screen: 'start' }); expect(parseRoute(`#/v/${screen}/living-room`)).toEqual({ screen: 'start' });
      for (const layout of ['current', 'three', 'four'] as const) expect(activeTab({ role: 'r', screen, id: 'bathroom' }, null, layout)).toBe('check');
    }
    expect(parentRoute({ role: 'r', screen: 'capture', id: 'bathroom' }, 'resident')).toEqual({ role: 'r', screen: 'room', id: 'bathroom' });
  });
});

function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => elements(n, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function components(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => components(n, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...components(node.props.children, type)];
}
