import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobAnalysis } from '../community/types';
import { assistant, createAssistant, type AssistantBrowser, type BrowserRecognition } from './assistant';

const mock = vi.hoisted(() => ({ native: true, availability: vi.fn(), analyzeTask: vi.fn(), chat: vi.fn(), startListening: vi.fn(), stopListening: vi.fn(), cancelListening: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn(), translate: vi.fn(), addListener: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native }, registerPlugin: () => mock }));
vi.mock('../community/task-rules', () => ({ analyzeTaskWithRules: (text: string, language: string) => ({ title: text, titleEnglish: text, summary: text, summaryEnglish: text, category: 'household', skills: ['general'], tools: [], estimatedMinutes: 30, peopleNeeded: 1, urgency: 'flexible', safetyNotes: [], language, engine: 'rules' }) }));

const job: JobAnalysis = { title: 'Move a chair', titleEnglish: 'Move a chair', summary: 'Move a chair in the living room.', summaryEnglish: 'Move a chair in the living room.', category: 'moving', skills: ['lifting'], tools: ['gloves'], estimatedMinutes: 20, peopleNeeded: 2, urgency: 'flexible', safetyNotes: [], language: 'en', engine: 'apple-on-device' };
beforeEach(() => {
  vi.resetAllMocks(); mock.native = true;
  mock.availability.mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
  mock.analyzeTask.mockResolvedValue(job); mock.chat.mockResolvedValue({ text: 'Shall I post this?', job });
  mock.startListening.mockResolvedValue({}); mock.stopListening.mockResolvedValue({ text: 'Move a chair' });
  mock.cancelListening.mockResolvedValue({}); mock.speak.mockResolvedValue({}); mock.stopSpeaking.mockResolvedValue({});
  mock.translate.mockResolvedValue({ text: 'Mover una silla' }); mock.addListener.mockResolvedValue({ remove: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('assistant bridge (mocked native model and audio)', () => {
  it('uses native generation, chat, translation and honest availability', async () => {
    expect(await assistant.availability()).toEqual({ onDeviceModel: true, speechInput: true, speechOutput: true });
    expect(await assistant.analyzeTask('Move a chair', 'en')).toEqual(job);
    expect(mock.analyzeTask).toHaveBeenCalledWith({ text: 'Move a chair', language: 'en' });
    expect(await assistant.chat([{ role: 'user', text: 'Move a chair' }], 'en', { firstName: 'Margaret' })).toEqual({ text: 'Shall I post this?', job, engine: 'apple-on-device' });
    expect(await assistant.translate('Move a chair', 'en', 'es')).toBe('Mover una silla');
    await assistant.speak('Hello', 'en'); expect(mock.speak).toHaveBeenCalledWith({ text: 'Hello', language: 'en' });
  });
  it('falls back on native rejection or malformed model output, preserving language and engine', async () => {
    mock.analyzeTask.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    expect(await assistant.analyzeTask('Help with the chair', 'es')).toMatchObject({ language: 'es', engine: 'rules' });
    mock.analyzeTask.mockResolvedValueOnce({ ...job, tools: ['chainsaw'], estimatedMinutes: 900 });
    expect(await assistant.analyzeTask('Help with the chair', 'en')).toMatchObject({ engine: 'rules' });
    mock.translate.mockRejectedValueOnce(new Error('unsupported language'));
    expect(await assistant.translate('Hello', 'en', 'tl')).toBeNull();
  });
  it.each(['es', 'ko', 'fr', 'zh', 'vi', 'tl', 'ru', 'ar'] as const)('offers localized web chat in %s without claiming model generation', async (language) => {
    mock.native = false;
    const question = await assistant.chat([{ role: 'user', text: 'Help' }], language, { firstName: 'Rosa' });
    expect(question.job).toBeNull(); expect(question.engine).toBe('rules'); expect(question.text).not.toContain('What do you need');
    const result = await assistant.chat([{ role: 'user', text: 'Please move this chair' }], language, { firstName: 'Rosa' });
    expect(result.job).toMatchObject({ engine: 'rules', language }); expect(result.text).not.toContain('I wrote');
    expect(mock.chat).not.toHaveBeenCalled();
  });
  it('uses the latest user message and recovers native chat errors', async () => {
    mock.chat.mockRejectedValue(new Error('UNAVAILABLE'));
    const result = await assistant.chat([{ role: 'user', text: 'Help me move this chair' }, { role: 'assistant', text: 'Where?' }, { role: 'user', text: 'Hello' }], 'en', { firstName: 'M' });
    expect(result).toEqual({ text: 'What do you need help with, and in which room?', job: null, engine: 'rules' });
  });
  it('falls back if native chat ignores the short-reply or single-question contract', async () => {
    mock.chat.mockResolvedValueOnce({ text: 'Hello. I can help. Tell me more.', job: null });
    expect(await assistant.chat([{ role: 'user', text: 'Hello' }], 'en', { firstName: 'M' })).toMatchObject({ engine: 'rules' });
    mock.chat.mockResolvedValueOnce({ text: 'What task? Which room?', job: null });
    expect(await assistant.chat([{ role: 'user', text: 'Hello' }], 'en', { firstName: 'M' })).toMatchObject({ engine: 'rules' });
  });
  it('counts words in Chinese without requiring spaces', async () => {
    mock.native = false;
    const result = await assistant.chat([{ role: 'user', text: '请帮我搬客厅的椅子' }], 'zh', { firstName: 'Wei' });
    expect(result.job).toMatchObject({ language: 'zh', engine: 'rules' });
  });
  it('wires partial events before starting and removes them on stop, ignoring late events', async () => {
    const partial = vi.fn(), remove = vi.fn(); let listener: ((event: { text: string }) => void) | undefined;
    mock.addListener.mockImplementation(async (event, callback) => { expect(event).toBe('partial'); listener = callback; return { remove }; });
    const session = await assistant.startListening('es', partial);
    expect(mock.startListening).toHaveBeenCalledWith({ language: 'es' });
    listener?.({ text: 'Una silla' }); expect(partial).toHaveBeenCalledWith('Una silla');
    expect(await session.stop()).toBe('Move a chair'); expect(remove).toHaveBeenCalledOnce();
    listener?.({ text: 'late' }); expect(partial).toHaveBeenCalledTimes(1);
    expect(await session.stop()).toBe('Move a chair'); expect(mock.stopListening).toHaveBeenCalledOnce();
  });
  it('cancels native listening and catches cleanup rejection', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('gone')); mock.addListener.mockResolvedValue({ remove });
    const session = await assistant.startListening('en', vi.fn());
    mock.cancelListening.mockRejectedValue(new Error('gone')); session.cancel();
    expect(await session.stop()).toBe(''); expect(remove).toHaveBeenCalledOnce();
  });
  it('bounds a stalled native call to 20 seconds and falls back', async () => {
    vi.useFakeTimers(); mock.analyzeTask.mockImplementation(() => new Promise(() => {}));
    const pending = assistant.analyzeTask('Please move this chair', 'en');
    await vi.advanceTimersByTimeAsync(19_999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ engine: 'rules' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports web capabilities truthfully and rejects missing listening support clearly', async () => {
    const web = createAssistant({ isNative: () => false, browser: () => ({}) });
    expect(await web.availability()).toEqual({ onDeviceModel: false, speechInput: false, speechOutput: false });
    await expect(web.startListening('en', vi.fn())).rejects.toThrow(/Speech input.*unavailable/i);
    expect(await web.translate('Hello', 'en', 'es')).toBeNull();
  });
  it('falls back to browser speech synthesis with locale and slower delivery', async () => {
    class Utterance { text: string; lang = ''; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } }
    const speech = { getVoices: () => [], speak: vi.fn((utterance: Utterance) => utterance.onend?.()), cancel: vi.fn() };
    const browser = { speechSynthesis: speech, SpeechSynthesisUtterance: Utterance } as unknown as AssistantBrowser;
    mock.speak.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const api = createAssistant({ browser: () => browser }); await api.speak('Bonjour', 'fr');
    expect(speech.speak.mock.calls[0]?.[0]).toMatchObject({ text: 'Bonjour', lang: 'fr-FR', rate: 0.85 });
    api.stopSpeaking(); expect(speech.cancel).toHaveBeenCalled();
  });
  it('cancels speech without allowing a late native rejection to start browser speech', async () => {
    let reject: ((error: Error) => void) | undefined;
    mock.speak.mockImplementation(() => new Promise((_, rejectCall) => { reject = rejectCall; }));
    const speak = vi.fn(); const api = createAssistant({ browser: () => ({ speechSynthesis: { cancel: vi.fn(), speak } } as unknown as AssistantBrowser) });
    const pending = api.speak('Hello', 'en'); await Promise.resolve(); api.stopSpeaking(); reject?.(new Error('cancelled'));
    await pending; expect(speak).not.toHaveBeenCalled();
  });
  it('uses browser recognition, accumulates final segments, stops and cleans callbacks', async () => {
    let recognition!: BrowserRecognition;
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onresult: BrowserRecognition['onresult'] = null;
      constructor() { recognition = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    const api = createAssistant({ isNative: () => false, browser: () => ({ webkitSpeechRecognition: Recognition }) });
    const partial = vi.fn(), session = await api.startListening('ko', partial);
    expect(recognition.lang).toBe('ko-KR'); expect(recognition.interimResults).toBe(true);
    recognition.onresult?.({ results: [{ 0: { transcript: 'Move this chair' }, isFinal: true, length: 1 }], resultIndex: 0 });
    expect(partial).toHaveBeenCalledWith('Move this chair'); expect(await session.stop()).toBe('Move this chair');
    expect(recognition.onresult).toBeNull();
  });
  it('does not restart listening through a fallback when a pending native start is superseded', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    mock.startListening.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const browser = vi.fn(() => ({})); const api = createAssistant({ browser });
    const first = api.startListening('en', vi.fn()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(rejectFirst).toBeDefined());
    const second = await api.startListening('es', vi.fn());
    const browserCalls = browser.mock.calls.length, cancellations = mock.cancelListening.mock.calls.length;
    rejectFirst?.(new Error('CANCELLED')); const result = await first;
    expect(result).toBeInstanceOf(Error); expect((result as Error).message).toMatch(/cancelled/i);
    // A cancelled start must neither consult Web Speech nor cancel the newer microphone session.
    expect(browser).toHaveBeenCalledTimes(browserCalls); expect(mock.cancelListening).toHaveBeenCalledTimes(cancellations); second.cancel();
  });
  it('does not cancel a newer microphone when an older stop rejects late', async () => {
    let rejectStop: ((error: Error) => void) | undefined;
    mock.stopListening.mockImplementationOnce(() => new Promise((_, reject) => { rejectStop = reject; }));
    const api = createAssistant(); const first = await api.startListening('en', vi.fn());
    const stopping = first.stop(); await vi.waitFor(() => expect(rejectStop).toBeDefined());
    const second = await api.startListening('es', vi.fn());
    const cancellations = mock.cancelListening.mock.calls.length;
    rejectStop?.(new Error('CANCELLED')); expect(await stopping).toBe('');
    await Promise.resolve(); expect(mock.cancelListening).toHaveBeenCalledTimes(cancellations); second.cancel();
  });
  it('settles and cleans a browser permission request when superseded, even if abort emits no event', async () => {
    vi.useFakeTimers(); let starts = 0;
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: BrowserRecognition['onerror'] = null; onresult: BrowserRecognition['onresult'] = null;
      start() { if (++starts > 1) this.onstart?.(); }
      stop() {} abort() {}
    }
    const api = createAssistant({ isNative: () => false, browser: () => ({ SpeechRecognition: Recognition }) });
    const first = api.startListening('en', vi.fn()).catch((error: unknown) => error);
    const second = await api.startListening('es', vi.fn());
    expect(vi.getTimerCount()).toBe(0);
    expect(await first).toBeInstanceOf(Error); second.cancel();
  });
});
