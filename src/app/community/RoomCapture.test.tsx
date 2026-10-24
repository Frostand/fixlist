import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Language } from '../../community/types';
import * as domain from '../../community';
import { createMemoryCaptureStore, type CaptureStore, type StoredCapture } from '../../lib/capture-storage';
import { parseCaptureBundle } from '../../lib/capture-bundle';
import bundle from '../../../scan/tests/capture-parity/valid-bundle.json';
import { RoomCapture } from './RoomCapture';
import { CommunityBody } from './CommunityApp';
import type { CommunityController } from './useCommunity';
import { CaptureFlow, GuidedPhotoTour } from '../CaptureScreens';
import { Button, Sheet } from './UI';
import { CaptureVideos } from '../CaptureVideos';
import { syntheticVideoAssets } from '../../lib/__fixtures__/capture-video';
import { translate } from '../../i18n';
import { createInitialState } from '../../domain/workflow';
import { demoScenario } from '../../data/demo-scenario';
// A small hook driver exercises component event handlers without a DOM, browser,
// new test dependency or server. It does not claim layout/native validation.
interface Driver {
    cursor: number;
    values: unknown[];
    effects: Array<() => void>;
    cleanups: Array<() => void>;
}
const runtime = vi.hoisted(() => ({ active: null as Driver | null, language: 'en' as Language, stores: new Map<string, CaptureStore>(), classic: vi.fn(), native: vi.fn(), availability: vi.fn(), analyze: vi.fn() }));
vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const driver = runtime.active;
            if (!driver) return actual.useState(initial);
            const i = driver.cursor++;
            if (!(i in driver.values)) driver.values[i] = typeof initial === 'function' ? initial() : initial;
            return [driver.values[i], (value: unknown) => { driver.values[i] = typeof value === 'function' ? value(driver.values[i]) : value; }];
        },
        useRef(initial: unknown) {
            const driver = runtime.active;
            if (!driver) return actual.useRef(initial);
            const i = driver.cursor++;
            if (!(i in driver.values)) driver.values[i] = { current: initial };
            return driver.values[i];
        },
        useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const driver = runtime.active;
            if (!driver) return actual.useEffect(effect, deps);
            const i = driver.cursor++, prior = driver.values[i] as readonly unknown[] | undefined;
            if (!deps || !prior || deps.some((value, index) => !Object.is(value, prior[index]))) {
                driver.values[i] = deps;
                driver.effects.push(() => { driver.cleanups[i]?.(); const cleanup = effect(); driver.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
        useMemo<T>(factory: () => T, deps: readonly unknown[]) {
            const driver = runtime.active;
            if (!driver) return actual.useMemo(factory, deps);
            const i = driver.cursor++, prior = driver.values[i] as { deps: readonly unknown[]; value: T } | undefined;
            if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) driver.values[i] = { deps, value: factory() };
            return (driver.values[i] as { value: T }).value;
        },
    };
});
vi.mock('../../i18n', async importOriginal => {
    const actual = await importOriginal<typeof import('../../i18n')>();
    return { ...actual, useLanguage: () => runtime.language, useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate(runtime.language, key, values), { language: runtime.language }) };
});
vi.mock('../../lib/capture-storage', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/capture-storage')>(),
    getCaptureStore: runtime.classic,
    getCommunityCaptureStore: (owner: string, reset: string) => {
        const store = runtime.stores.get(`${reset}:${owner}`);
        if (!store) throw new Error('Unknown capture scope');
        return store;
    },
}));
vi.mock('../../lib/native-capture', () => ({ captureAvailability: runtime.availability, runNativeCapture: runtime.native }));
vi.mock('../../lib/ondevice-flags', () => ({ analyzeAndSaveFlags: runtime.analyze, ondeviceFlagCopy: () => ({ question: 'Review this?' }) }));
vi.mock('./NearbyMap', () => ({ default: () => null }));
function driver(render: () => ReactNode) {
    const state: Driver = { cursor: 0, values: [], effects: [], cleanups: [] };
    const result = { render() { state.cursor = 0; runtime.active = state; let tree: ReactNode; try { tree = render(); } finally { runtime.active = null; } for (const run of state.effects.splice(0)) run(); return tree; }, unmount() { for (const cleanup of state.cleanups) cleanup?.(); } };
    return result;
}
function nodes(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value, type));
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...nodes(node.props.children, type)];
}
function press(tree: ReactNode, label: string) {
    const control = [...nodes(tree, Button), ...nodes(tree, 'button')].find(node => renderToStaticMarkup(<>{node.props.children as ReactNode}</>).includes(label));
    expect(control, label).toBeDefined();
    return (control!.props.onClick as () => unknown)();
}
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
    vi.clearAllMocks(); runtime.stores.clear();
    runtime.stores.set('reset-1:elder-margaret', createMemoryCaptureStore());
    runtime.stores.set('reset-1:elder-soonja', createMemoryCaptureStore());
    runtime.stores.set('reset-2:elder-margaret', createMemoryCaptureStore());
    runtime.classic.mockImplementation(() => { throw new Error('Classic capture store must never be used'); });
    runtime.availability.mockResolvedValue({ arkit: false });
    runtime.analyze.mockRejectedValue(new Error('AI unavailable'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture() { const p = await parseCaptureBundle(JSON.stringify(bundle)); if (!p.ok) throw new Error(p.error); return p.value; }
async function ready(view: ReturnType<typeof driver>) { await vi.waitFor(() => { expect(nodes(view.render(), Button).some(n => n.props.children === 'Take room photos')).toBe(true); }); }
function tour(tree: ReactNode) { return nodes(tree, GuidedPhotoTour)[0]!.props as unknown as Parameters<typeof GuidedPhotoTour>[0]; }
const props = { ownerId: 'elder-margaret', resetEpoch: 'reset-1', onDraft: vi.fn(), onType: vi.fn() };
describe('shared retained video effects and classic capture cancellation', () => {
    it('owns object URLs across replacement, owner/room changes, removal and unmount; shows playback failure', async () => {
        const { manifest, photos } = await fixture(), assets = await syntheticVideoAssets(manifest);
        let record: StoredCapture = { manifest, photos, flags: null, ...assets }, ownerKey = 'elder-a';
        const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${create.mock.calls.length}`), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const view = driver(() => CaptureVideos({ record, ownerKey }));
        view.render(); let tree = view.render(), video = nodes(tree, 'video')[0]!;
        expect(video.props).toMatchObject({ src: 'blob:test-1', controls: true, playsInline: true, preload: 'metadata' }); expect(video.props.autoPlay).not.toBe(true);
        (video.props.onError as () => void)(); expect(renderToStaticMarkup(<>{view.render()}</>)).toContain(translate('en', 'capture.video.playbackFailed'));
        const oldError = video.props.onError as () => void;
        record = { ...record, ...await syntheticVideoAssets({ ...manifest, captureId: 'cap-replaced-001' }), manifest: { ...manifest, captureId: 'cap-replaced-001' } };
        expect(nodes(view.render(), 'video')).toHaveLength(0); tree = view.render();
        expect(revoke).toHaveBeenCalledWith('blob:test-1'); expect(nodes(tree, 'video')[0]!.props.src).toBe('blob:test-2');
        oldError(); expect(nodes(view.render(), 'p').some(p => p.props.role === 'alert')).toBe(false);
        ownerKey = 'elder-b'; expect(nodes(view.render(), 'video')).toHaveLength(0); view.render(); expect(revoke).toHaveBeenCalledWith('blob:test-2');
        record = { ...record, manifest: { ...record.manifest, roomId: 'hallway' } }; view.render(); view.render(); expect(revoke).toHaveBeenCalledWith('blob:test-3');
        record = { ...record, videos: null, videoBlobs: new Map() }; expect(view.render()).toBeNull(); expect(revoke).toHaveBeenCalledWith('blob:test-4');
        record = { manifest, photos, flags: null, ...assets }; view.render(); view.render();
        view.unmount(); expect(revoke.mock.calls).toEqual([['blob:test-1'], ['blob:test-2'], ['blob:test-3'], ['blob:test-4'], ['blob:test-5']]);
    });
    it('renders visible privacy/export exclusion and a URL creation failure', async () => {
        const { manifest, photos } = await fixture(), assets = await syntheticVideoAssets(manifest);
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('unsupported'); });
        const view = driver(() => CaptureVideos({ record: { manifest, photos, flags: null, ...assets }, ownerKey: 'elder-a' }));
        view.render(); const html = renderToStaticMarkup(<>{view.render()}</>);
        expect(html).toContain(translate('en', 'capture.video.privacy')); expect(html).toContain(translate('en', 'capture.video.playbackFailed')); view.unmount();
    });
    it.each(['unmount', 'room', 'actor'] as const)('aborts classic capture on %s and rejects the late callback', async change => {
        const state = createInitialState(demoScenario), store = createMemoryCaptureStore(); runtime.classic.mockReturnValue(store); runtime.availability.mockResolvedValue({ arkit: true });
        let complete!: (value: { status: string }) => void; runtime.native.mockImplementation(() => new Promise(r => { complete = r; }));
        const navigate = vi.fn(); let current = { scenario: demoScenario, state, person: state.people[0]!, dispatch: vi.fn(async () => ({ ok: true as const })), navigate, roomId: 'living-room' };
        const view = driver(() => { const element = CaptureFlow(current); return (element.type as (p: typeof current) => ReactNode)(element.props); });
        view.render(); await settle(); const request = runtime.native.mock.calls[0]![0];
        expect(request.signal).toBeInstanceOf(AbortSignal);
        if (change === 'unmount') view.unmount();
        else { const nextPerson = { ...current.person, id: 'another-resident' }; current = { ...current, ...(change === 'room' ? { roomId: 'hallway' } : { person: nextPerson, state: { ...state, people: [...state.people, nextPerson], household: { ...state.household, residentId: nextPerson.id } } }) }; view.render(); }
        expect(request.signal.aborted).toBe(true); expect(request.isCurrent()).toBe(false);
        complete({ status: 'completed' }); await settle(); expect(navigate).not.toHaveBeenCalled(); view.unmount();
    });
    it('shows both native and cleanup failures in the classic flow', async () => {
        const state = createInitialState(demoScenario); runtime.classic.mockReturnValue(createMemoryCaptureStore()); runtime.availability.mockResolvedValue({ arkit: true });
        runtime.native.mockResolvedValue({ status: 'failed', cleanupFailed: true, reason: 'Bounded room video streaming is unavailable.' });
        const current = { scenario: demoScenario, state, person: state.people[0]!, dispatch: vi.fn(async () => ({ ok: true as const })), navigate: vi.fn(), roomId: 'living-room' };
        const view = driver(() => { const element = CaptureFlow(current); return (element.type as (p: typeof current) => ReactNode)(element.props); });
        view.render(); await settle(); const html = renderToStaticMarkup(<>{view.render()}</>);
        expect(html).toContain(translate('en', 'capture.cleanupFailed')); expect(html).toContain('Bounded room video streaming is unavailable.'); view.unmount();
    });
});
describe('community RoomCapture store and operation identity', () => {
    it.each(['completed', 'cancelled'] as const)('shows temporary cleanup failure after native %s', async status => {
        runtime.availability.mockResolvedValue({ arkit: true });
        runtime.native.mockResolvedValue({ status, cleanupFailed: true });
        const view = driver(() => RoomCapture(props)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); await settle(); await settle();
        const markup = renderToStaticMarkup(<>{view.render()}</>);
        expect(markup).toContain(translate('en', status === 'completed' ? 'capture.savedCleanupFailed' : 'capture.cleanupFailed'));
        view.unmount();
    });
    it('renders the retained clip after optional AI failure and removes it from the tree on owner change', async () => {
        const store = runtime.stores.get('reset-1:elder-margaret')!, { manifest, photos } = await fixture();
        runtime.availability.mockResolvedValue({ arkit: true });
        const assets = await syntheticVideoAssets(manifest);
        runtime.native.mockImplementation(async () => { await store.writeCapture(manifest, photos, false, undefined, null, assets); return { status: 'completed' }; });
        let currentProps = props;
        const view = driver(() => RoomCapture(currentProps)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); await ready(view);
        expect(nodes(view.render(), CaptureVideos)).toHaveLength(1);
        expect(nodes(view.render(), CaptureVideos)[0]!.props.record).toMatchObject({ manifest, videos: assets.videos });
        currentProps = { ...props, ownerId: 'elder-soonja' };
        expect(nodes(view.render(), CaptureVideos)).toHaveLength(0); view.unmount();
    });
    it.each([false, true])('refreshes the durable photo identity before AI rejects (prior capture %s)', async existing => {
        const store = runtime.stores.get('reset-1:elder-margaret')!, { manifest, photos } = await fixture();
        if (existing) await store.writeCapture(manifest, photos);
        const view = driver(() => RoomCapture(props));
        press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos');
        if (existing) press(view.render(), 'Replace room photos');
        await settle();
        const save = tour(view.render()).onSave;
        await save(manifest.photos.map(p => ({ ...p, camera: null })), photos);
        expect(runtime.analyze).toHaveBeenCalledWith(manifest.roomId, expect.objectContaining({ store }));
        const b = await store.read(manifest.roomId); expect(b).not.toBeNull();
        expect(b!.manifest.captureId).not.toBe(manifest.captureId);
        press(view.render(), 'Take room photos');
        expect(nodes(view.render(), Sheet)).toHaveLength(1);
        press(view.render(), 'Replace room photos'); await settle();
        await tour(view.render()).onSave(manifest.photos.map(p => ({ ...p, camera: null })), photos);
        const c = await store.read(manifest.roomId);
        expect(c!.manifest.captureId).not.toBe(b!.manifest.captureId);
        expect(runtime.analyze).toHaveBeenCalledTimes(2);
        expect(runtime.classic).not.toHaveBeenCalled(); view.unmount();
    });
    it('refreshes a native save before analysis rejects, retaining replacement consent', async () => {
        const store = runtime.stores.get('reset-1:elder-margaret')!, { manifest, photos } = await fixture();
        await store.writeCapture(manifest, photos);
        runtime.availability.mockResolvedValue({ arkit: true });
        runtime.native.mockImplementation(async (options) => {
            await options.store.writeCapture({ ...manifest, captureId: 'cap-native-saved-02' }, photos, options.replaceConfirmed, options.isCurrent, options.expectedCaptureId);
            return { status: 'completed' };
        });
        const view = driver(() => RoomCapture(props)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); press(view.render(), 'Replace room photos'); await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledOnce()); await ready(view);
        expect(runtime.native).toHaveBeenCalledWith(expect.objectContaining({ store, signal: expect.any(AbortSignal) }));
        runtime.native.mockResolvedValue({ status: 'cancelled' });
        press(view.render(), 'Take room photos'); press(view.render(), 'Replace room photos'); await settle();
        expect(runtime.native.mock.calls[1]![0].expectedCaptureId).toBe('cap-native-saved-02');
        expect(runtime.classic).not.toHaveBeenCalled(); view.unmount();
    });
    it.each(['unmount', 'restart', 'owner', 'reset'] as const)('aborts pending native start on %s and ignores late callbacks', async change => {
        runtime.availability.mockResolvedValue({ arkit: true });
        let complete!: (value: { status: string }) => void;
        runtime.native.mockImplementation(() => new Promise(r => { complete = r; }));
        let currentProps = props;
        const view = driver(() => RoomCapture(currentProps)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); await settle();
        const options = runtime.native.mock.calls[0]![0];
        if (change === 'unmount') view.unmount();
        else if (change === 'restart') press(view.render(), 'Choose another room');
        else { currentProps = { ...props, ...(change === 'owner' ? { ownerId: 'elder-soonja' } : { resetEpoch: 'reset-2' }) }; view.render(); }
        expect(options.signal.aborted).toBe(true); expect(options.isCurrent()).toBe(false);
        complete({ status: 'completed' }); await settle();
        expect(runtime.analyze).not.toHaveBeenCalled(); view.unmount();
    });
    it('rejects a stale photo save after scope changes', async () => {
        const { manifest, photos } = await fixture(); let currentProps = props;
        const view = driver(() => RoomCapture(currentProps)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); await settle(); const save = tour(view.render()).onSave;
        currentProps = { ...props, ownerId: 'elder-soonja' }; view.render();
        await save(manifest.photos.map(p => ({ ...p, camera: null })), photos);
        expect(await runtime.stores.get('reset-1:elder-margaret')!.read(manifest.roomId)).toBeNull();
        expect(await runtime.stores.get('reset-1:elder-soonja')!.read(manifest.roomId)).toBeNull(); view.unmount();
    });
    it.each(['owner', 'room'] as const)('a late photo callback cannot abort or overwrite a newer native operation after %s changes', async change => {
        const { manifest, photos } = await fixture(); let currentProps = props;
        const view = driver(() => RoomCapture(currentProps)); press(view.render(), 'Living room'); await ready(view);
        press(view.render(), 'Take room photos'); await settle(); const oldTour = tour(view.render());
        if (change === 'owner') { currentProps = { ...props, ownerId: 'elder-soonja' }; view.render(); }
        else press(view.render(), 'Choose another room');
        press(view.render(), 'Hallway'); await ready(view);
        runtime.availability.mockResolvedValue({ arkit: true });
        let finish!: (value: { status: string }) => void;
        runtime.native.mockImplementation(() => new Promise(r => { finish = r; }));
        press(view.render(), 'Take room photos'); await settle();
        const newer = runtime.native.mock.calls[0]![0];
        await oldTour.onSave(manifest.photos.map(p => ({ ...p, camera: null })), photos);
        oldTour.onCancel();
        expect(newer.signal.aborted).toBe(false); expect(newer.isCurrent()).toBe(true);
        expect(runtime.analyze).not.toHaveBeenCalled();
        expect(await runtime.stores.get('reset-1:elder-margaret')!.read(manifest.roomId)).toBeNull();
        finish({ status: 'cancelled' }); await settle(); view.unmount();
    });
});
describe('community capture invocation authorization', () => {
    const NOW = '2026-10-23T12:00:00.000Z';
    function invocation(actor: string, revoke = false, mismatch = false) {
        const signed = domain.signIn(domain.createSeedState(NOW), actor); if (!signed.ok) throw new Error(signed.message);
        const state = revoke ? { ...signed.state, elders: signed.state.elders.map(e => ({ ...e, familyIds: [] })) } : signed.state;
        const controller = { state, account: mismatch ? state.accounts[0]! : domain.currentAccount(state), resetEpoch: 'reset-1', issue: null, run: vi.fn(), reset() {}, clearIssue() {} } as unknown as CommunityController;
        vi.stubGlobal('window', { location: { hash: '#/c/rooms' }, addEventListener() {}, removeEventListener() {}, scrollTo() {} });
        vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
        const view = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage() {} }));
        const tree = view.render();
        const suspense = nodes(tree, Symbol.for('react.suspense'))[0];
        const child = suspense?.props.children as ReactElement<Record<string, unknown>> | undefined;
        view.unmount(); return child;
    }
    it('elder and linked family use the elder namespace but retain distinct actor keys and reset epoch', () => {
        const elder = invocation('elder-margaret')!, family = invocation('family-alex')!;
        expect(elder.props.ownerId).toBe('elder-margaret'); expect(family.props.ownerId).toBe('elder-margaret');
        expect(elder.props.resetEpoch).toBe('reset-1'); expect(family.props.resetEpoch).toBe('reset-1');
        expect(elder.key).toContain('elder-margaret'); expect(family.key).toContain('family-alex');
        expect(elder.key).toContain('reset-1'); expect(elder.key).not.toBe(family.key);
    });
    it('blocks volunteers, revoked one-sided family links, and stale account/session mismatch', () => {
        expect(invocation('volunteer-jordan')).toBeUndefined();
        expect(invocation('family-alex', true)).toBeUndefined();
        expect(invocation('family-alex', false, true)).toBeUndefined();
    });
});
