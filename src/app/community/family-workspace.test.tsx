import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../../community';
import { LEGACY_FAMILY_SCOPES } from '../../community/family';
import { createCommunityStore, loadCommunitySnapshot } from '../../community/storage';
import type { CommunityResult, CommunityState, Language } from '../../community/types';
import { familyCopy, translateFamily } from '../../i18n/family';
import { LANGUAGES, translate } from '../../i18n';
import { assistant } from '../../lib/assistant';
import { CommunityBody } from './CommunityApp';
import { AskScreen, type Draft } from './Elder';
import { DraftScreen } from './DraftScreen';
import { FamilyInformationEditor, FamilyWorkspace } from './FamilyWorkspace';
import { FamilyConsent } from './FamilyConsent';
import { Messages } from './Messages';
import { JobCard } from './JobCard';
import { Button } from './UI';
import type { CommunityController } from './useCommunity';
interface Driver { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as Driver | null, language: 'en' as Language }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useState(initial: unknown) { const d = runtime.active; if (!d) return actual.useState(initial); const i = d.cursor++; if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial; return [d.values[i], (v: unknown) => { d.values[i] = typeof v === 'function' ? v(d.values[i]) : v; }]; },
    useRef(initial: unknown) { const d = runtime.active; if (!d) return actual.useRef(initial); const i = d.cursor++; if (!(i in d.values)) d.values[i] = { current: initial }; return d.values[i]; },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const d = runtime.active; if (!d) return actual.useEffect(effect, deps); const i = d.cursor++, prior = d.values[i] as readonly unknown[] | undefined; if (!deps || !prior || deps.some((v, index) => !Object.is(v, prior[index]))) { d.values[i] = deps; d.effects.push(() => { d.cleanups[i]?.(); const cleanup = effect(); d.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; }); } },
  };
});
vi.mock('../../i18n', async original => { const actual = await original<typeof import('../../i18n')>(); return { ...actual, useLanguage: () => runtime.language, useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate(runtime.language, key, values), { language: runtime.language }) }; });
vi.mock('./NearbyMap', () => ({ default: () => null }));
const cleanups: Array<() => void> = [];
function driver<T>(render: () => T) { const d: Driver = { cursor: 0, values: [], effects: [], cleanups: [] }; const view = { render() { d.cursor = 0; runtime.active = d; let tree: T; try { tree = render(); } finally { runtime.active = null; } d.effects.splice(0).forEach(run => run()); return tree; }, unmount() { d.cleanups.forEach(cleanup => cleanup?.()); } }; cleanups.push(view.unmount); return view; }
function nodes(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] { if (Array.isArray(node)) return node.flatMap(n => nodes(n, type)); if (!isValidElement<{ children?: ReactNode }>(node)) return []; return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...nodes(node.props.children, type)]; }
function one(node: ReactNode, type: unknown) { const found = nodes(node, type); expect(found).toHaveLength(1); return found[0]!; }
function props<T>(node: ReactElement<Record<string, unknown>>) { return node.props as unknown as T; }
function select(tree: ReactNode, value: string) { (one(tree, 'select').props.onChange as (e: unknown) => void)({ target: { value } }); }
function button(tree: ReactNode, label: string) { const b = [...nodes(tree, Button), ...nodes(tree, 'button')].find(n => n.props.children === label); expect(b, label).toBeDefined(); (b!.props.onClick as () => void)(); }
class MemoryStorage implements Storage { values = new Map<string, string>(); blocked = false; get length() { return this.values.size; } clear() { this.values.clear(); } key(i: number) { return [...this.values.keys()][i] ?? null; } getItem(k: string) { return this.values.get(k) ?? null; } setItem(k: string, v: string) { if (this.blocked) throw new Error('quota'); this.values.set(k, v); } removeItem(k: string) { this.values.delete(k); } }
const NOW = '2026-10-24T12:00:00.000Z', E = 'elder-margaret', F = 'family-alex', V = 'volunteer-jordan';
function ok(r: CommunityResult) { if (!r.ok) throw new Error(r.message); return r.state; }
function as(s: CommunityState, id: string) { return ok(domain.signIn(s, id)); }
function workspace(state = as(domain.createSeedState(NOW), F)) {
  const storage = new MemoryStorage(); domain.saveCommunity(storage, state);
  const store = createCommunityStore(storage, () => NOW); let route = { screen: 'home', id: '' };
  const run = vi.fn(store.run);
  const controller = (): CommunityController => ({ state: store.state, account: domain.currentAccount(store.state), resetEpoch: store.resetEpoch, run: run as CommunityController['run'], reset: store.reset, issue: store.issue, clearIssue: store.clearIssue, readScope: () => ({ state: store.state, resetEpoch: store.resetEpoch }) });
  const view = driver(() => FamilyWorkspace({ controller: controller(), account: store.state.accounts.find(a => a.id === F)!, route, onNavigate(path) { const [screen = 'home', id = ''] = path.split('/'); route = { screen, id }; } }));
  return { view, store, storage, run, controller, route(screen: string, id = '') { route = { screen, id }; }, choose(id = E) { select(view.render(), id); return view.render(); } };
}
function capture(tree: ReactNode) { return props<Parameters<typeof import('./RoomCapture').RoomCapture>[0]>((one(tree, Symbol.for('react.suspense')).props.children as ReactElement<Record<string, unknown>>)); }
const preventDefault = () => {};
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.language = 'en'; });

describe('selected elder family workspace handlers and durable commands', () => {
  it('requires an explicit choice, routes scan evidence through review, and posts as Alex for Margaret', () => {
    const w = workspace(); w.route('rooms');
    expect(nodes(w.view.render(), Symbol.for('react.suspense'))).toHaveLength(0);
    const selected = w.choose(); expect(renderToStaticMarkup(selected)).toContain('Alex helping Margaret');
    w.route('rooms'); const room = capture(w.view.render()); expect(room.ownerId).toBe(E); expect(room.resetEpoch).toBe(w.store.resetEpoch); expect(room.isCurrent?.()).toBe(true);
    const analysis = domain.quickPickAnalysis('light-bulb', 'en'), evidence = { roomId: 'living-room', photoId: 'sample-room', flagId: 'sample-rug-check', label: 'Room concern for Margaret', point: null, thumbnail: null };
    room.onDraft(analysis, evidence);
    const draftProps = props<Parameters<typeof DraftScreen>[0]>(one(w.view.render(), DraftScreen));
    expect(draftProps.draft.evidence).toEqual([evidence]); expect(draftProps.draft.source).toBe('scan');
    const review = driver(() => DraftScreen(draftProps)); button(review.render(), 'Post this request');
    // post() has no translation await on this English draft.
    const job = w.store.state.jobs.at(-1)!;
    expect(job).toMatchObject({ elderId: E, createdById: F, source: 'scan', status: 'open', evidence: [evidence] });
    expect(loadCommunitySnapshot(w.storage, NOW).state.jobs.at(-1)).toEqual(job);
  });
  it('kills retained capture, draft, ask and editor callbacks across switches, including switching back', () => {
    const second = ok(domain.approveFamilyGrant(as(domain.createSeedState(NOW), 'elder-rosa'), { elderId: 'elder-rosa', familyId: F, scopes: [...LEGACY_FAMILY_SCOPES, 'profile'], expectedRevision: null }, NOW));
    const w = workspace(as(second, F)); w.choose(); w.route('rooms'); const oldRoom = capture(w.view.render());
    const draft: Draft = { analysis: domain.quickPickAnalysis('light-bulb', 'en'), text: 'Margaret needs a bulb', source: 'typed', evidence: [] };
    oldRoom.onDraft(draft.analysis, { roomId: 'living-room', photoId: 'photo-old', flagId: 'flag-old', label: 'old', point: null, thumbnail: null });
    const oldDraft = props<Parameters<typeof DraftScreen>[0]>(one(w.view.render(), DraftScreen));
    w.route('type'); const oldAsk = props<Parameters<typeof AskScreen>[0]>(one(w.view.render(), AskScreen));
    w.route('family-information'); const oldEditor = props<Parameters<typeof FamilyInformationEditor>[0]>(one(w.view.render(), FamilyInformationEditor));
    w.choose('elder-rosa'); expect(oldRoom.isCurrent?.()).toBe(false);
    w.choose(E); expect(oldRoom.isCurrent?.()).toBe(false); expect(oldDraft.isCurrent?.()).toBe(false);
    const before = JSON.stringify(w.store.state), runs = w.run.mock.calls.length;
    oldRoom.onDraft(draft.analysis, { roomId: 'living-room', photoId: 'photo-old', flagId: 'flag-old', label: 'old', point: null, thumbnail: null }); oldRoom.onType();
    oldDraft.onChange(draft); expect(oldDraft.onPost([], draft.analysis)).toBe(false); oldAsk.onDraft(draft); expect(oldAsk.onPost?.(draft, [], draft.analysis)).toBe(false);
    expect(oldEditor.onSave({ name: 'wrong', area: 'wrong', needs: [], addressHint: '', visitInstructions: '', preferences: { contact: 'ask-first', visitTimes: [], notes: '' } })).toBe(false);
    expect(w.run.mock.calls.length).toBe(runs); expect(JSON.stringify(w.store.state)).toBe(before); expect(nodes(w.view.render(), DraftScreen)).toHaveLength(0);
  });
  it('guards private direct routes by selected beneficiary, reciprocal permission and the exact session', () => {
    const w = workspace(); w.choose(); w.route('job', 'job-open-rosa-shelf'); expect(nodes(w.view.render(), JobCard)).toHaveLength(0);
    w.route('messages', 'job-past-rosa'); expect(nodes(w.view.render(), Messages)).toHaveLength(0);
    w.store.run(s => ({ ok: true, state: { ...s, elders: s.elders.map(e => e.accountId === E ? { ...e, familyIds: [] } : e) } })); // persistence rejects one-sided links
    expect(w.store.issue).toBe('storage');
    w.store.run(s => domain.signIn(s, V)); w.route('rooms'); expect(nodes(w.view.render(), Symbol.for('react.suspense'))).toHaveLength(0);
    const controller = { ...w.controller(), account: w.store.state.accounts.find(a => a.id === F)! };
    vi.stubGlobal('window', { location: { hash: '#/c/job/job-past-margaret' }, scrollTo() {}, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
    const outer = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage() {} }));
    expect(nodes(outer.render(), FamilyWorkspace)).toHaveLength(1); // wrapper is still responsible for the session gate
    expect(nodes(w.view.render(), Messages)).toHaveLength(0);
  });
  it('invalidates capture/draft immediately on durable unlink before React rerenders, and requires a fresh choice after relink', () => {
    const w = workspace(); w.choose(); w.route('rooms'); const old = capture(w.view.render());
    expect(w.store.run(s => domain.revokeFamilyGrant(s, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW)).ok).toBe(true);
    expect(old.isCurrent?.()).toBe(false);
    old.onDraft(domain.quickPickAnalysis('light-bulb', 'en'), { roomId: 'living-room', photoId: 'photo-old', flagId: 'flag-old', label: 'old', point: null, thumbnail: null });
    expect(nodes(w.view.render(), DraftScreen)).toHaveLength(0);
    w.store.run(s => domain.signIn(s, E)); w.store.run(s => domain.approveFamilyGrant(s, { elderId: E, familyId: F, scopes: LEGACY_FAMILY_SCOPES, expectedRevision: 1 }, NOW)); w.store.run(s => domain.signIn(s, F));
    expect(nodes(w.view.render(), Symbol.for('react.suspense'))).toHaveLength(0); expect(old.isCurrent?.()).toBe(false);
    w.choose(); w.route('rooms'); const fresh = capture(w.view.render()); expect(fresh.ownerId).toBe(old.ownerId); expect(fresh.resetEpoch).toBe(old.resetEpoch); expect(fresh.isCurrent?.()).toBe(true);
  });
  it('shows volunteer reports and messages but offers no family completion confirmation', () => {
    let state = as(domain.createSeedState(NOW), E);
    const posted = domain.postJob(state, { actorId: E, elderId: E, source: 'typed', originalText: 'a light', analysis: domain.quickPickAnalysis('light-bulb', 'en') }, NOW); if (!posted.ok) throw new Error(posted.message);
    state = ok(domain.acceptJob(as(posted.state, V), { jobId: posted.jobId, volunteerId: V, scheduledFor: NOW }, NOW));
    state = ok(domain.startTrip(state, { jobId: posted.jobId, volunteerId: V }, NOW)); state = ok(domain.arrive(state, { jobId: posted.jobId, volunteerId: V }, NOW)); state = ok(domain.reportDone(state, { jobId: posted.jobId, volunteerId: V, note: 'Replaced the bulb.' }, NOW));
    const w = workspace(as(state, F)); w.choose(); w.route('confirm', posted.jobId);
    // Render the private detail function through React to verify the actual offered controls.
    const markup = renderToStaticMarkup(w.view.render());
    expect(markup).toContain('Awaiting Margaret'); expect(markup).toContain('Replaced the bulb.'); expect(markup).toContain('Jordan'); expect(markup).toContain('Status history'); expect(markup).not.toContain('Yes, the job is done');
  });
});

describe('local family async cancellation and permission UI', () => {
  it('discards a message awaiting translation immediately after unlink, without a family rerender', async () => {
    let state = ok(domain.updateLanguage(as(domain.createSeedState(NOW), E), E, 'es'));
    const posted = domain.postJob(state, { actorId: E, elderId: E, source: 'typed', originalText: 'a light', analysis: domain.quickPickAnalysis('light-bulb', 'es') }, NOW); if (!posted.ok) throw new Error(posted.message);
    state = ok(domain.acceptJob(as(posted.state, V), { jobId: posted.jobId, volunteerId: V, scheduledFor: NOW }, NOW));
    const w = workspace(as(state, F)); w.choose(); w.route('messages', posted.jobId);
    const messageProps = props<Parameters<typeof Messages>[0]>(one(w.view.render(), Messages));
    let finish!: (text: string) => void;
    vi.spyOn(assistant, 'translate').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const messages = driver(() => Messages(messageProps));
    (one(messages.render(), 'textarea').props.onChange as (e: unknown) => void)({ target: { value: 'Please message before visiting Margaret.' } });
    const sending = (one(messages.render(), 'form').props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(assistant.translate).toHaveBeenCalledOnce();
    const runs = w.run.mock.calls.length;
    w.store.run(s => domain.revokeFamilyGrant(s, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    finish('Por favor, envíe un mensaje.'); await sending; await new Promise(resolve => setImmediate(resolve));
    expect(w.run.mock.calls.length).toBe(runs); expect(w.store.state.messages).toEqual([]); expect(messageProps.isCurrent?.()).toBe(false);
  });
  it('discards a translated draft post and retained draft editor changes after unlink', async () => {
    const w = workspace(); w.choose(); w.route('rooms'); const room = capture(w.view.render());
    const analysis = domain.quickPickAnalysis('light-bulb', 'es');
    room.onDraft(analysis, { roomId: 'living-room', photoId: 'photo-one', flagId: 'flag-one', label: 'Una lámpara', point: null, thumbnail: null });
    let draftProps = props<Parameters<typeof DraftScreen>[0]>(one(w.view.render(), DraftScreen));
    draftProps.onChange({ ...draftProps.draft, analysis: { ...analysis, title: 'Cambiar esta bombilla' } });
    draftProps = props<Parameters<typeof DraftScreen>[0]>(one(w.view.render(), DraftScreen));
    // Set the initial editor snapshot before changing its title to exercise the real async translation path.
    const review = driver(() => DraftScreen(draftProps)); review.render();
    draftProps = { ...draftProps, draft: { ...draftProps.draft, analysis: { ...draftProps.draft.analysis, title: 'Cambiar otra bombilla' } } };
    const pending: Array<(text: string) => void> = [];
    vi.spyOn(assistant, 'translate').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const before = w.store.state.jobs.length; button(review.render(), 'Post this request'); expect(pending).toHaveLength(2);
    w.store.run(s => domain.revokeFamilyGrant(s, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    pending.forEach(resolve => resolve('Translation')); await new Promise(resolve => setImmediate(resolve));
    expect(w.store.state.jobs).toHaveLength(before); expect(draftProps.isCurrent?.()).toBe(false);
  });
  it('drops a late chat reply and speech before the family component has rerendered after unlink', async () => {
    const w = workspace(); w.choose(); w.route('talk');
    const askProps = props<Parameters<typeof AskScreen>[0]>(one(w.view.render(), AskScreen));
    vi.spyOn(assistant, 'availability').mockResolvedValue({ language: 'en', onDeviceModel: false, speechInput: false, speechOutput: true });
    const speak = vi.spyOn(assistant, 'speak').mockResolvedValue();
    let finish!: (reply: import('../../community/types').AssistantReply) => void;
    const chat = vi.spyOn(assistant, 'chat').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ask = driver(() => AskScreen(askProps)); ask.render(); await new Promise(resolve => setImmediate(resolve));
    (one(ask.render(), 'textarea').props.onChange as (e: unknown) => void)({ target: { value: 'Help change the hall light for Margaret.' } });
    (one(ask.render(), 'form').props.onSubmit as (e: unknown) => void)({ preventDefault }); expect(chat).toHaveBeenCalledOnce();
    w.store.run(s => domain.revokeFamilyGrant(s, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    finish({ text: 'Late family reply', job: domain.quickPickAnalysis('light-bulb', 'en'), engine: 'rules' }); await new Promise(resolve => setImmediate(resolve));
    expect(speak).not.toHaveBeenCalled(); expect(nodes(ask.render(), DraftScreen)).toHaveLength(0); expect(renderToStaticMarkup(ask.render())).not.toContain('Late family reply');
  });
  it('blocks a retained chat replay callback immediately after unlink', async () => {
    const w = workspace(); w.choose(); w.route('talk');
    const askProps = props<Parameters<typeof AskScreen>[0]>(one(w.view.render(), AskScreen));
    vi.spyOn(assistant, 'availability').mockResolvedValue({ language: 'en', onDeviceModel: false, speechInput: false, speechOutput: true });
    const speak = vi.spyOn(assistant, 'speak').mockResolvedValue();
    vi.spyOn(assistant, 'chat').mockResolvedValue({ text: 'Which room needs help?', job: null, engine: 'rules' });
    const ask = driver(() => AskScreen(askProps)); ask.render(); await new Promise(resolve => setImmediate(resolve));
    (one(ask.render(), 'textarea').props.onChange as (e: unknown) => void)({ target: { value: 'Help change the light' } });
    (one(ask.render(), 'form').props.onSubmit as (e: unknown) => void)({ preventDefault }); await new Promise(resolve => setImmediate(resolve));
    const replay = nodes(ask.render(), Button).find(n => n.props.children === translate('en', 'c.talk.replay'))!; expect(replay).toBeDefined();
    speak.mockClear(); w.store.run(s => domain.revokeFamilyGrant(s, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    (replay.props.onClick as () => void)(); expect(speak).not.toHaveBeenCalled();
  });
  it('keeps a failed preference save visible and saves only on durable success', () => {
    const w = workspace(); w.choose(); w.route('family-information');
    const editorProps = props<Parameters<typeof FamilyInformationEditor>[0]>(one(w.view.render(), FamilyInformationEditor));
    const editor = driver(() => FamilyInformationEditor(editorProps));
    const input = nodes(editor.render(), 'input')[0]!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: 'Margaret Changed' } });
    w.storage.blocked = true;
    (one(editor.render(), 'form').props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(renderToStaticMarkup(editor.render())).toContain('Information could not be saved'); expect(w.store.state.accounts.find(a => a.id === E)?.name).toBe('Margaret Lee');
    w.storage.blocked = false;
    (one(editor.render(), 'form').props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(renderToStaticMarkup(editor.render())).toContain('Information saved on this device'); expect(loadCommunitySnapshot(w.storage, NOW).state.accounts.find(a => a.id === E)?.name).toBe('Margaret Changed');
  });
});

describe('fixed family consent localization and direction', () => {
  it('covers every family message and preserves interpolation tokens in all nine languages', () => {
    expect(Object.keys(familyCopy).sort()).toEqual(LANGUAGES.map(l => l.code).sort());
    for (const copy of Object.values(familyCopy)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(familyCopy.en).sort());
      for (const [key, value] of Object.entries(copy)) { expect(value.trim().length).toBeGreaterThan(0); expect(value.match(/\{\w+\}/g)?.sort() ?? []).toEqual(familyCopy.en[key as keyof typeof familyCopy.en].match(/\{\w+\}/g)?.sort() ?? []); }
    }
  });
  it.each(LANGUAGES)('uses fixed $code consent, workspace and editor text with $dir direction', ({ code, dir }) => {
    runtime.language = code;
    const translate = vi.spyOn(assistant, 'translate');
    const w = workspace(); expect(one(w.view.render(), 'select').props.children).toBeDefined();
    const root = w.choose(); expect((root as ReactElement<{ lang: string; dir: string }>).props).toMatchObject({ lang: code, dir });
    expect(renderToStaticMarkup(root)).toContain(translateFamily(code, 'helping', { actor: 'Alex', elder: 'Margaret' }));
    w.route('family-information'); const editorProps = props<Parameters<typeof FamilyInformationEditor>[0]>(one(w.view.render(), FamilyInformationEditor));
    const editor = driver(() => FamilyInformationEditor(editorProps)); expect(one(editor.render(), 'form').props).toMatchObject({ lang: code, dir });
    expect(renderToStaticMarkup(editor.render())).toContain(familyCopy[code].address);
    let state = as(w.store.state, E);
    const consent = driver(() => FamilyConsent({ account: state.accounts.find(a => a.id === E)!, state, onCommand(command) { const result = command(state); if (result.ok) state = result.state; return result.ok; } }));
    select(consent.render(), F); let tree = consent.render();
    expect(one(tree, 'section').props).toMatchObject({ lang: code, dir });
    expect(renderToStaticMarkup(tree)).toContain(familyCopy[code].approval); expect(renderToStaticMarkup(tree)).toContain(familyCopy[code].editConsent);
    (one(tree, 'form').props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(domain.familyGrant(state, F, E)?.scopes).not.toContain('profile');
    (one(consent.render(), 'input').props.onChange as (e: unknown) => void)({ target: { checked: true } });
    tree = consent.render(); (one(tree, 'form').props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(domain.familyGrant(state, F, E)?.scopes).toContain('profile');
    expect(translate).not.toHaveBeenCalled();
  });
});
