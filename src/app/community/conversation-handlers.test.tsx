import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../../community';
import type { Language } from '../../community/types';
import type { NativeAssistantPlugin } from '../../lib/assistant';
import { AskScreen, type Draft } from './Elder';
import { DraftScreen } from './DraftScreen';
import { LiveRequestDraft } from './LiveRequestDraft';
import { LiveCommunityController } from './live-controller';
import { ELDER, liveFixture } from './live-fixture.test-support';
import { Button } from './UI';

interface Hooks { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const boundary = vi.hoisted(() => ({ hooks: null as Hooks | null, language: 'en' as Language, native: false,
    chat: vi.fn<NativeAssistantPlugin['chat']>(), listening: vi.fn<NativeAssistantPlugin['startListening']>(),
    listeners: new Map<string, Set<(value: Record<string, unknown>) => void>>(), cancel: vi.fn(), stop: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn(),
}));
// Only platform/model boundaries are mocked. Real assistant, adapter, reducer,
// screen event handlers, DraftScreen and posting controllers run below.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => boundary.native, getPlatform: () => boundary.native ? 'ios' : 'web' }, registerPlugin: () => ({
    chat: boundary.chat,
    availability: async ({ language }: { language: Language }) => ({ language, onDeviceModel: true, speechInput: true, speechOutput: false }),
    addListener: async (event: string, cb: (value: Record<string, unknown>) => void) => {
        const set = boundary.listeners.get(event) ?? new Set(); set.add(cb); boundary.listeners.set(event, set);
        return { remove: async () => { set.delete(cb); } };
    },
    startListening: boundary.listening, cancelListening: boundary.cancel, stopListening: boundary.stop, speak: boundary.speak, stopSpeaking: boundary.stopSpeaking,
}) }));
vi.mock('react', async original => {
    const actual = await original<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const h = boundary.hooks; if (!h) return actual.useState(initial);
            const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial;
            return [h.values[i], (v: unknown) => { h.values[i] = typeof v === 'function' ? v(h.values[i]) : v; }];
        },
        useRef(initial: unknown) {
            const h = boundary.hooks; if (!h) return actual.useRef(initial);
            const i = h.cursor++; if (!(i in h.values)) h.values[i] = { current: initial }; return h.values[i];
        },
        useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const h = boundary.hooks; if (!h) return actual.useEffect(effect, deps);
            const i = h.cursor++, prior = h.values[i] as readonly unknown[] | undefined;
            if (!deps || !prior || deps.some((v, j) => !Object.is(v, prior[j]))) {
                h.values[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); const cleanup = effect(); h.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
    };
});
vi.mock('../../i18n', async original => {
    const actual = await original<typeof import('../../i18n')>();
    return { ...actual, useLanguage: () => boundary.language, useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate(boundary.language, key, values), { language: boundary.language }) };
});
function driver(render: () => ReactNode) {
    const h: Hooks = { cursor: 0, values: [], effects: [], cleanups: [] };
    return { h, render() { h.cursor = 0; boundary.hooks = h; let tree; try { tree = render(); } finally { boundary.hooks = null; } h.effects.splice(0).forEach(run => run()); return tree; }, unmount() { h.cleanups.forEach(run => run?.()); } };
}
function nodes(n: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(n)) return n.flatMap(v => nodes(v, type)); if (!isValidElement<{ children?: ReactNode }>(n)) return [];
    return [...(n.type === type ? [n as ReactElement<Record<string, unknown>>] : []), ...nodes(n.props.children, type)];
}
const html = (tree: ReactNode) => renderToStaticMarkup(<>{tree}</>);
function call(n: ReactElement<Record<string, unknown>>, event: string, ...args: unknown[]) { return (n.props[event] as (...args: unknown[]) => unknown)(...args); }
function change(tree: ReactNode, index: number, value: string) { call(nodes(tree, 'textarea')[index]!, 'onChange', { target: { value } }); }
function press(tree: ReactNode, label: string) {
    const n = [...nodes(tree, Button), ...nodes(tree, 'button')].find(n => html(n.props.children as ReactNode).includes(label));
    expect(n, label).toBeDefined(); expect(n!.props.disabled).not.toBe(true); return call(n!, 'onClick');
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
async function type(view: ReturnType<typeof driver>, words: string) {
    change(view.render(), 0, words); call(nodes(view.render(), 'form')[0]!, 'onSubmit', { preventDefault() {} }); await flush();
}
function preview(view: ReturnType<typeof driver>) { return nodes(view.render(), DraftScreen)[0]!; }
function draft(view: ReturnType<typeof driver>) { return preview(view).props.draft as Draft; }
function emit(event: string, data: Record<string, unknown>) { boundary.listeners.get(event)?.forEach(cb => cb(data)); }
const NOW = '2026-10-24T12:00:00.000Z';
beforeEach(() => { vi.resetAllMocks(); boundary.native = false; boundary.language = 'en'; boundary.listeners.clear(); boundary.chat.mockRejectedValue(new Error('UNAVAILABLE')); boundary.listening.mockResolvedValue({}); boundary.stopSpeaking.mockResolvedValue({}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('real request conversation handlers', () => {
    it.each([
        ['en', 'Help with phone', 'The writing is too small for me to read', false],
        ['en', 'Help with phone', 'The writing is too small for me to read', true],
        ['es', 'Ayuda con mi teléfono', 'Quiero aumentar el tamaño de las letras', false],
    ] as const)('uses genuine native field interpretation outside rules and retains it through a later correction in %s', async (language, first, answer, voice) => {
        boundary.native = true; boundary.language = language;
        boundary.chat.mockImplementation(async input => {
            const request = (input as unknown as { request?: { revision: string; questionId: string | null; turns: Array<{ id: string; role: string; text: string }> } }).request;
            if (!request || request.turns.at(-1)?.text !== answer) throw new Error('UNAVAILABLE');
            const user = request.turns.at(-1)!;
            return { version: 1, revision: request.revision, questionId: request.questionId, intent: 'amend', task: null,
                operations: [{ field: 'outcome', op: 'set', evidence: { turnId: user.id, start: 0, end: answer.length, quote: answer } }] };
        });
        let state = domain.createSeedState(NOW);
        const account = state.accounts.find(a => a.role === 'elder' && a.language === language)!;
        const signedIn = domain.signIn(state, account.id); if (!signedIn.ok) throw new Error(signedIn.message); state = signedIn.state;
        const before = state.jobs.length, onPost = vi.fn((d: Draft, slots: readonly domain.AvailabilitySlot[], analysis: domain.JobAnalysis) => {
            const result = domain.postJob(state, { actorId: account.id, elderId: account.id, source: d.source, originalText: d.text, analysis, preferredSlots: slots }, NOW);
            if (result.ok) state = result.state; return result.ok;
        });
        const view = driver(() => AskScreen({ talk: voice, account, onDraft: vi.fn(), onPost }));
        view.render(); await flush();
        if (voice) {
            for (const text of [first, answer]) {
                press(view.render(), 'Tap to talk'); await flush();
                emit('listeningEnded', { sessionId: boundary.listening.mock.calls.at(-1)![0].sessionId, text, reason: 'final' }); await flush();
            }
            press(view.render(), 'Type instead');
        } else { await type(view, first); await type(view, answer); }
        expect(draft(view).analysis.summary).toContain(answer); expect(onPost).not.toHaveBeenCalled();
        await type(view, 'actually in kitchen');
        expect(draft(view).analysis.summary).toContain(answer); expect(draft(view).analysis.summaryEnglish).toContain('Room: kitchen');
        await type(view, 'Yes, post it'); expect(onPost).not.toHaveBeenCalled();
        const corrected = draft(view), element = preview(view), child = driver(() => DraftScreen(element.props as unknown as Parameters<typeof DraftScreen>[0]));
        const button = nodes(child.render(), Button)[0]!; call(button, 'onClick'); call(button, 'onClick'); await flush();
        expect(onPost).toHaveBeenCalledOnce(); expect(state.jobs).toHaveLength(before + 1);
        expect(state.jobs.at(-1)).toMatchObject({ analysis: corrected.analysis, originalText: `${first}\n${answer}\nactually in kitchen\nYes, post it` });
        child.unmount();
        view.unmount();
    });
    it.each([false, true])('collects moving, corrects review and posts exact corrected analysis/provenance once (starts in voice: %s)', async voice => {
        boundary.native = voice;
        let state = domain.createSeedState(NOW); const before = state.jobs.length, account = state.accounts[0]!, onDraft = vi.fn();
        const signedIn = domain.signIn(state, account.id); if (!signedIn.ok) throw new Error(signedIn.message); state = signedIn.state;
        const onPost = vi.fn((d: Draft, slots: readonly domain.AvailabilitySlot[], analysis: domain.JobAnalysis) => {
            const result = domain.postJob(state, { actorId: account.id, elderId: account.id, source: d.source, originalText: d.text, analysis, preferredSlots: slots }, NOW);
            if (result.ok) state = result.state; return result.ok;
        });
        const view = driver(() => AskScreen({ talk: voice, account, onDraft, onPost })); view.render(); await flush();
        async function say(words: string) {
            press(view.render(), 'Tap to talk'); await flush();
            const sessionId = boundary.listening.mock.calls.at(-1)![0].sessionId;
            emit('listeningEnded', { sessionId, text: words, reason: 'final' }); await flush();
            emit('listeningEnded', { sessionId, text: words, reason: 'final' }); await flush();
        }
        if (voice) { await say('I need help moving something'); press(view.render(), 'Type instead'); }
        else await type(view, 'I need help moving something');
        expect(html(view.render())).toContain('What would you like to move?');
        await type(view, 'chair'); expect(html(view.render())).toContain('Where should it go?');
        if (voice) await say('bedroom to kitchen'); else await type(view, 'bedroom to kitchen');
        const old = preview(view); expect(draft(view).analysis.summaryEnglish).toContain('Destination: kitchen');
        change(view.render(), 0, 'actually living room');
        expect(nodes(view.render(), DraftScreen)).toHaveLength(0);
        expect(call(old, 'onPost', [], (old.props.draft as Draft).analysis)).toBe(false);
        call(nodes(view.render(), 'form')[0]!, 'onSubmit', { preventDefault() {} }); await flush();
        const corrected = draft(view);
        expect(corrected.analysis.summaryEnglish).toContain('Item: chair; From: bedroom; Destination: living room');
        expect(corrected.analysis.summaryEnglish).not.toContain('kitchen');
        expect(corrected.text).toBe('I need help moving something\nchair\nbedroom to kitchen\nactually living room');
        expect(onPost).not.toHaveBeenCalled(); expect(onDraft).not.toHaveBeenCalled();
        const element = preview(view), child = driver(() => DraftScreen(element.props as unknown as Parameters<typeof DraftScreen>[0]));
        const tree = child.render(); press(tree, 'Post this request'); press(tree, 'Post this request'); await flush();
        expect(onPost).toHaveBeenCalledOnce(); expect(state.jobs).toHaveLength(before + 1);
        expect(state.jobs.at(-1)).toMatchObject({ originalText: corrected.text, analysis: corrected.analysis, status: 'open', scheduledFor: null });
        child.unmount(); view.unmount();
        if (voice) expect([...boundary.listeners.values()].every(s => s.size === 0)).toBe(true);
    });
    it.each(['rejection', 'malformed', 'timeout'] as const)('retains actual native handler state when the next answer encounters %s', async failure => {
        boundary.native = true;
        const account = domain.createSeedState(NOW).accounts[0]!, view = driver(() => AskScreen({ talk: false, account, onDraft: vi.fn() }));
        view.render(); await flush(); await type(view, 'I need help moving something');
        if (failure === 'rejection') boundary.chat.mockRejectedValueOnce(new Error('UNAVAILABLE'));
        if (failure === 'malformed') boundary.chat.mockResolvedValueOnce({ text: 'It is posted', job: { title: 'sofa' } });
        if (failure === 'timeout') { vi.useFakeTimers(); boundary.chat.mockImplementationOnce(() => new Promise(() => {})); }
        await type(view, 'chair');
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20_001);
        expect(html(view.render())).toContain('Where should it go?');
        await type(view, 'bedroom to kitchen');
        expect(draft(view).analysis.summaryEnglish).toContain('Item: chair; From: bedroom; Destination: kitchen');
        view.unmount();
    });
    it.each(['account', 'language', 'unmount'] as const)('discards a real native response after %s changes', async changed => {
        boundary.native = true; let account = domain.createSeedState(NOW).accounts[0]!;
        let finish!: (value: unknown) => void; boundary.chat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = driver(() => AskScreen({ talk: false, account, onDraft: vi.fn() })); view.render(); await flush();
        await type(view, 'Water plants in kitchen'); const old = boundary.chat.mock.calls[0]![0].request;
        if (changed === 'account') account = domain.createSeedState(NOW).accounts[1]!;
        if (changed === 'language') boundary.language = 'ar';
        if (changed === 'unmount') view.unmount(); else { view.render(); await flush(); }
        const user = old.turns.at(-1)!;
        const evidence = (quote: string) => ({ turnId: user.id, start: user.text.indexOf(quote), end: user.text.indexOf(quote) + quote.length, quote });
        finish({ version: 1, revision: old.revision, questionId: old.questionId, intent: 'replace', task: { kind: 'plants', evidence: evidence(user.text) },
            operations: [{ field: 'object', op: 'set', evidence: evidence('plants') }, { field: 'location', op: 'set', evidence: evidence('kitchen') }] }); await flush();
        expect(nodes(view.render(), DraftScreen)).toHaveLength(0); expect(html(view.render())).not.toContain('Water plants in kitchen');
        view.unmount();
    });
    it('uses RTL-ready containers, bounds actual UI context and triages a later emergency answer', async () => {
        const account = domain.createSeedState(NOW).accounts[0]!, view = driver(() => AskScreen({ talk: false, account, onDraft: vi.fn() }));
        view.render(); await flush(); await type(view, 'Water plants');
        for (let i = 0; i < 5; i++) await type(view, 'thanks');
        await type(view, 'today'); expect(nodes(view.render(), DraftScreen)).toHaveLength(0);
        boundary.language = 'ar'; view.render(); await flush();
        await type(view, 'Help with phone');
        expect(html(view.render())).toContain('lang="ar" dir="auto"'); expect(html(view.render())).toContain('ما الذي تريد فعله');
        await type(view, 'I smell gas'); expect(nodes(view.render(), DraftScreen)).toHaveLength(0);
        expect(html(view.render())).toContain('الطوارئ'); view.unmount();
    });
    it('keeps live address/consent/server retry separate while corrected facts reach post exactly once', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const view = driver(() => LiveRequestDraft({ controller: c, language: 'en', locked: !!c.state.pending })); view.render();
        change(view.render(), 0, 'Water three plants in kitchen, no rush'); change(view.render(), 1, 'Private address');
        press(view.render(), 'Review task and address'); await flush();
        const checkbox = nodes(view.render(), 'input')[0]!; call(checkbox, 'onChange', { target: { checked: true } });
        const stalePost = nodes(view.render(), Button).find(n => html(n.props.children as ReactNode).includes('Post reviewed request'))!;
        change(view.render(), 0, 'actually living room'); call(stalePost, 'onClick'); await flush(); expect(f.calls).toHaveLength(0);
        press(view.render(), 'Review task and address'); await flush();
        expect(nodes(view.render(), 'input')[0]!.props.checked).toBe(false);
        change(view.render(), 0, 'Yes, post it'); press(view.render(), 'Review task and address'); await flush(); expect(f.calls).toHaveLength(0);
        call(nodes(view.render(), 'input')[0]!, 'onChange', { target: { checked: true } });
        const reviewed = view.render(); press(reviewed, 'Post reviewed request'); press(reviewed, 'Post reviewed request'); await flush();
        expect(f.calls).toHaveLength(1); expect(f.calls[0]?.payload).toMatchObject({ address: 'Private address', originalText: 'Water three plants in kitchen, no rush\nactually living room\nYes, post it', analysis: { urgency: 'flexible', summaryEnglish: 'Help water household plants. Item: plants; Quantity: three; Room: living room; Timing: no rush.' } });
        press(reviewed, 'Post reviewed request'); await flush(); expect(f.calls).toHaveLength(1);
        change(view.render(), 0, 'Water plants'); change(view.render(), 1, 'New address');
        press(view.render(), 'Review task and address'); await flush();
        call(nodes(view.render(), 'input')[0]!, 'onChange', { target: { checked: true } });
        press(view.render(), 'Post reviewed request'); await flush(); expect(f.calls).toHaveLength(2);
        view.unmount(); c.dispose();
    });
    it('posts a native-interpreted Spanish live request once with corrected facts and raw user provenance', async () => {
        boundary.native = true; boundary.language = 'es';
        const first = 'Ayuda con mi teléfono', answer = 'Quiero aumentar el tamaño de las letras';
        boundary.chat.mockImplementation(async ({ request }) => {
            if (request.turns.at(-1)?.text !== answer) throw new Error('UNAVAILABLE');
            const user = request.turns.at(-1)!;
            return { version: 1, revision: request.revision, questionId: request.questionId, intent: 'amend', task: null,
                operations: [{ field: 'outcome', op: 'set', evidence: { turnId: user.id, start: 0, end: answer.length, quote: answer } }] };
        });
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const view = driver(() => LiveRequestDraft({ controller: c, language: 'es', locked: !!c.state.pending })); view.render();
        change(view.render(), 0, first); change(view.render(), 1, 'Private address'); press(view.render(), 'Review task and address'); await flush();
        change(view.render(), 0, answer); press(view.render(), 'Review task and address'); await flush();
        expect(html(view.render())).toContain(answer);
        call(nodes(view.render(), 'input')[0]!, 'onChange', { target: { checked: true } });
        const oldPost = nodes(view.render(), Button).find(n => html(n.props.children as ReactNode).includes('Post reviewed request'))!;
        change(view.render(), 0, 'actually in kitchen'); call(oldPost, 'onClick'); expect(f.calls).toHaveLength(0);
        press(view.render(), 'Review task and address'); await flush(); expect(nodes(view.render(), 'input')[0]!.props.checked).toBe(false);
        change(view.render(), 0, 'Yes, post it'); press(view.render(), 'Review task and address'); await flush(); expect(f.calls).toHaveLength(0);
        call(nodes(view.render(), 'input')[0]!, 'onChange', { target: { checked: true } });
        const reviewed = view.render(); press(reviewed, 'Post reviewed request'); press(reviewed, 'Post reviewed request'); await flush();
        expect(f.calls).toHaveLength(1); expect(f.calls[0]?.payload).toMatchObject({ address: 'Private address', originalText: `${first}\n${answer}\nactually in kitchen\nYes, post it`, analysis: { engine: 'apple-on-device', summaryEnglish: expect.stringContaining(`Requested help: ${answer}; Room: kitchen`) } });
        view.unmount(); c.dispose();
    });
    it('can clarify and triage live input before an address is supplied, while review and posting still require it', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const view = driver(() => LiveRequestDraft({ controller: c, language: 'en', locked: false })); view.render();
        change(view.render(), 0, 'Help with phone'); press(view.render(), 'Review task and address'); await flush();
        expect(html(view.render())).toContain('What would you like to do with it?');
        change(view.render(), 0, 'I smell gas'); press(view.render(), 'Review task and address'); await flush();
        expect(html(view.render())).toContain('local emergency services'); expect(nodes(view.render(), 'input')).toHaveLength(0);
        expect(f.calls).toHaveLength(0); view.unmount(); c.dispose();
    });
});
