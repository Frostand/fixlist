import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobAnalysis } from '../community/types';
import { assistant, createAssistant, type AssistantBrowser, type BrowserRecognition } from './assistant';

const mock = vi.hoisted(() => ({ native: true, availability: vi.fn(), analyzeTask: vi.fn(), chat: vi.fn(), startListening: vi.fn(), stopListening: vi.fn(), cancelListening: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn(), translate: vi.fn(), addListener: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native }, registerPlugin: () => mock }));

const job: JobAnalysis = { title: 'Move a chair', titleEnglish: 'Move a chair', summary: 'Move a chair in the living room.', summaryEnglish: 'Move a chair in the living room.', category: 'moving', skills: ['lifting'], tools: ['gloves'], estimatedMinutes: 20, peopleNeeded: 2, urgency: 'flexible', safetyNotes: [], language: 'en', engine: 'apple-on-device' };
beforeEach(() => {
  vi.resetAllMocks(); mock.native = true;
  mock.availability.mockResolvedValue({ language: 'en', onDeviceModel: true, speechInput: true, speechOutput: true });
  mock.analyzeTask.mockResolvedValue(job); mock.chat.mockResolvedValue({ text: 'Shall I post this?', job });
  mock.startListening.mockResolvedValue({}); mock.stopListening.mockResolvedValue({ text: 'Move a chair' });
  mock.cancelListening.mockResolvedValue({}); mock.speak.mockResolvedValue({}); mock.stopSpeaking.mockResolvedValue({});
  mock.translate.mockResolvedValue({ text: 'Mover una silla' }); mock.addListener.mockResolvedValue({ remove: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function audioBridge() {
  const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  mock.addListener.mockImplementation(async (name: string, callback: (event: Record<string, unknown>) => void) => {
    const callbacks = listeners.get(name) ?? new Set(); listeners.set(name, callbacks); callbacks.add(callback);
    return { remove: vi.fn(async () => { callbacks.delete(callback); }) };
  });
  return {
    emit(name: string, event: Record<string, unknown>) { for (const callback of listeners.get(name) ?? []) callback(event); },
    count() { return [...listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0); },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('session-scoped native speech lifecycle', () => {
  it('preserves an empty native terminal error before startup rejection without opening browser speech', async () => {
    const bridge = audioBridge(), browserStart = vi.fn();
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: BrowserRecognition['onerror'] = null; onresult: BrowserRecognition['onresult'] = null;
      start() { browserStart(); this.onstart?.(); } stop() {} abort() {}
    }
    mock.startListening.mockImplementation(({ sessionId }) => {
      bridge.emit('listeningEnded', { sessionId, reason: 'error', text: '' });
      return Promise.reject(new Error('Speech permission denied'));
    });
    const api = createAssistant({ browser: () => ({ SpeechRecognition: Recognition }) });
    const session = await api.startListening('en', vi.fn());
    expect(browserStart).not.toHaveBeenCalled();
    expect(await session.done).toEqual({ sessionId: session.sessionId, reason: 'error', text: '' });
    expect(await session.stop()).toBe(''); expect(bridge.count()).toBe(0);
    expect(mock.cancelListening).not.toHaveBeenCalled();
  });
  it('rejects a native bridge failure without ever opening browser speech', async () => {
    const bridge = audioBridge(), browserStart = vi.fn();
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: BrowserRecognition['onerror'] = null; onresult: BrowserRecognition['onresult'] = null;
      start() { browserStart(); this.onstart?.(); } stop() {} abort() {}
    }
    mock.startListening.mockRejectedValue(new Error('Bridge unavailable'));
    const api = createAssistant({ browser: () => ({ SpeechRecognition: Recognition }) });
    await expect(api.startListening('en', vi.fn())).rejects.toThrow(/type/i);
    expect(browserStart).not.toHaveBeenCalled(); expect(bridge.count()).toBe(0);
    expect(mock.cancelListening).toHaveBeenCalledOnce();
  });
  it('recovers partial native words after a bridge rejection without a terminal or browser microphone', async () => {
    const bridge = audioBridge(), browserStart = vi.fn();
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: BrowserRecognition['onerror'] = null; onresult: BrowserRecognition['onresult'] = null;
      start() { browserStart(); this.onstart?.(); } stop() {} abort() {}
    }
    mock.startListening.mockImplementation(({ sessionId }) => {
      bridge.emit('partial', { sessionId, text: 'Recover my words' });
      return Promise.reject(new Error('Lost bridge ACK'));
    });
    const partial = vi.fn(), api = createAssistant({ browser: () => ({ SpeechRecognition: Recognition }) });
    const session = await api.startListening('en', partial);
    expect(await session.done).toEqual({ sessionId: session.sessionId, reason: 'error', text: 'Recover my words' });
    expect(partial).toHaveBeenCalledExactlyOnceWith('Recover my words'); expect(await session.stop()).toBe('Recover my words');
    expect(browserStart).not.toHaveBeenCalled(); expect(bridge.count()).toBe(0);
    expect(mock.cancelListening).toHaveBeenCalledExactlyOnceWith({ sessionId: session.sessionId });
  });
  it.each(['final', 'error', 'background', 'interrupted'] as const)('settles %s before startup ACK, retaining partial text', async reason => {
    const bridge = audioBridge(); let ack!: () => void;
    mock.startListening.mockImplementation(({ sessionId }) => {
      expect(bridge.count()).toBe(2);
      bridge.emit('partial', { sessionId, text: 'Move the chair' });
      bridge.emit('listeningEnded', { sessionId, reason, text: 'Move the chair' });
      return new Promise<void>(resolve => { ack = resolve; });
    });
    const api = createAssistant(), partial = vi.fn(), starting = api.startListening('en', partial);
    await flush(); ack(); const session = await starting;
    expect(await session.done).toMatchObject({ reason, text: 'Move the chair' });
    expect(await session.stop()).toBe('Move the chair'); session.cancel();
    expect(partial).toHaveBeenCalledOnce(); expect(bridge.count()).toBe(0);
    expect(mock.stopListening).not.toHaveBeenCalled();
  });
  it('ignores stale IDs and scopes repeated stop/cancel to their own session', async () => {
    const bridge = audioBridge(), api = createAssistant(), partial = vi.fn();
    const first = await api.startListening('en', vi.fn());
    const firstId = mock.startListening.mock.calls[0]![0].sessionId;
    const second = await api.startListening('es', partial), secondId = mock.startListening.mock.calls[1]![0].sessionId;
    expect(firstId).toEqual(expect.any(String)); expect(secondId).not.toBe(firstId);
    bridge.emit('listeningEnded', { sessionId: firstId, reason: 'final', text: 'old' });
    bridge.emit('partial', { sessionId: firstId, text: 'old' });
    bridge.emit('partial', { sessionId: secondId, text: 'new' });
    first.cancel(); expect(await first.stop()).toBe(''); expect(partial).toHaveBeenCalledExactlyOnceWith('new');
    mock.stopListening.mockImplementation(async ({ sessionId }) => {
      bridge.emit('listeningEnded', { sessionId, reason: 'stopped', text: 'new' }); return { sessionId, text: 'new' };
    });
    const stop = second.stop(); expect(second.stop()).toBe(stop);
    expect(await stop).toBe('new'); expect(await second.done).toMatchObject({ reason: 'stopped', text: 'new' });
    second.cancel(); second.cancel(); expect(mock.stopListening).toHaveBeenCalledExactlyOnceWith({ sessionId: secondId });
    expect(mock.cancelListening).toHaveBeenCalledExactlyOnceWith({ sessionId: firstId }); expect(bridge.count()).toBe(0);
  });
  it('keeps healthy native output alive beyond 20 seconds and waits for completion', async () => {
    vi.useFakeTimers(); const bridge = audioBridge(), replay = vi.fn(); let settled = false;
    const api = createAssistant({ browser: () => ({ speechSynthesis: { cancel: vi.fn(), speak: replay }, SpeechSynthesisUtterance: class {} } as unknown as AssistantBrowser) });
    const speaking = api.speak('A long reply', 'en').then(() => { settled = true; }); await flush();
    const sessionId = mock.speak.mock.calls[0]![0].sessionId;
    bridge.emit('speechProgress', { sessionId, stage: 'started' });
    for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(10_000); bridge.emit('speechProgress', { sessionId, stage: 'word' }); }
    expect(settled).toBe(false); expect(mock.stopSpeaking).not.toHaveBeenCalled(); expect(replay).not.toHaveBeenCalled();
    bridge.emit('speechEnded', { sessionId, reason: 'completed' }); await speaking; await flush();
    expect(bridge.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels stalled playback by ID without browser replay and releases listeners/timers', async () => {
    vi.useFakeTimers(); const bridge = audioBridge(), browserSpeak = vi.fn();
    const api = createAssistant({ browser: () => ({ speechSynthesis: { cancel: vi.fn(), speak: browserSpeak }, SpeechSynthesisUtterance: class {} } as unknown as AssistantBrowser) });
    const speaking = api.speak('A reply', 'en'); await flush(); const sessionId = mock.speak.mock.calls[0]![0].sessionId;
    bridge.emit('speechProgress', { sessionId, stage: 'started' });
    await vi.advanceTimersByTimeAsync(20_001); await speaking;
    expect(mock.stopSpeaking).toHaveBeenCalledExactlyOnceWith({ sessionId }); expect(browserSpeak).not.toHaveBeenCalled();
    expect(bridge.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('settles stopped speech immediately and ignores late callbacks after new output', async () => {
    const bridge = audioBridge(), api = createAssistant(); mock.speak.mockImplementation(() => new Promise(() => {}));
    const first = api.speak('First', 'en'); await flush(); const oldId = mock.speak.mock.calls[0]![0].sessionId;
    api.stopSpeaking(); await first;
    mock.speak.mockResolvedValue({}); let secondDone = false;
    const second = api.speak('Second', 'en').then(() => { secondDone = true; }); await flush();
    const sessionId = mock.speak.mock.calls[1]![0].sessionId;
    bridge.emit('speechEnded', { sessionId: oldId, reason: 'completed' }); await flush(); expect(secondDone).toBe(false);
    bridge.emit('speechEnded', { sessionId, reason: 'completed' }); await second;
    expect(mock.stopSpeaking).toHaveBeenCalledExactlyOnceWith({ sessionId: oldId }); expect(bridge.count()).toBe(0);
  });
  it('settles output terminal before ACK without waiting for a lost ACK or replaying', async () => {
    vi.useFakeTimers(); const bridge = audioBridge(), api = createAssistant();
    mock.speak.mockImplementation(({ sessionId }) => {
      expect(bridge.count()).toBe(2);
      bridge.emit('speechEnded', { sessionId, reason: 'completed' });
      return new Promise(() => {});
    });
    await api.speak('Short reply', 'en'); await flush();
    expect(mock.stopSpeaking).not.toHaveBeenCalled(); expect(bridge.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])('bounds only a missing startup ACK (playback began: %s) without speculative fallback', async began => {
    vi.useFakeTimers(); const bridge = audioBridge(), replay = vi.fn();
    const api = createAssistant({ browser: () => ({ speechSynthesis: { cancel: vi.fn(), speak: replay }, SpeechSynthesisUtterance: class {} } as unknown as AssistantBrowser) });
    mock.speak.mockImplementation(() => new Promise(() => {}));
    const speaking = api.speak('Reply', 'en'); await flush(); const sessionId = mock.speak.mock.calls[0]![0].sessionId;
    if (began) bridge.emit('speechProgress', { sessionId, stage: 'started' });
    await vi.advanceTimersByTimeAsync(20_001); await speaking; await flush();
    expect(mock.stopSpeaking).toHaveBeenCalledExactlyOnceWith({ sessionId }); expect(replay).not.toHaveBeenCalled();
    expect(bridge.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('never replays after playback began even if the startup promise rejects UNAVAILABLE', async () => {
    const bridge = audioBridge(), replay = vi.fn();
    const api = createAssistant({ browser: () => ({ speechSynthesis: { cancel: vi.fn(), speak: replay }, SpeechSynthesisUtterance: class {} } as unknown as AssistantBrowser) });
    mock.speak.mockImplementation(({ sessionId }) => {
      bridge.emit('speechProgress', { sessionId, stage: 'started' });
      return Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' }));
    });
    await api.speak('Reply', 'en'); await flush();
    expect(replay).not.toHaveBeenCalled(); expect(mock.stopSpeaking).toHaveBeenCalledOnce(); expect(bridge.count()).toBe(0);
  });
  it('cancels during listener registration without starting old native audio and removes the late handle', async () => {
    vi.useFakeTimers(); audioBridge(); let register!: (handle: { remove(): Promise<void> }) => void;
    mock.addListener.mockImplementationOnce(() => new Promise(resolve => { register = resolve; }));
    const api = createAssistant(), first = api.startListening('en', vi.fn()).catch(error => error); await flush();
    const second = await api.startListening('es', vi.fn());
    const remove = vi.fn(async () => {}); register({ remove }); await flush();
    expect(await first).toBeInstanceOf(Error); expect(remove).toHaveBeenCalledOnce();
    expect(mock.startListening).toHaveBeenCalledExactlyOnceWith({ sessionId: second.sessionId, language: 'es' });
    second.cancel(); await flush(); expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts a permission/startup ACK wait immediately by ID and cleans its listeners', async () => {
    vi.useFakeTimers(); const bridge = audioBridge(), api = createAssistant(), controller = new AbortController();
    mock.startListening.mockImplementation(() => new Promise(() => {}));
    const starting = api.startListening('en', vi.fn(), controller.signal).catch(error => error); await flush();
    const sessionId = mock.startListening.mock.calls[0]![0].sessionId; controller.abort(); await flush();
    expect(await starting).toBeInstanceOf(Error);
    expect(mock.cancelListening).toHaveBeenCalledExactlyOnceWith({ sessionId });
    expect(bridge.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('assistant bridge (mocked native model and audio)', () => {
  it('uses native generation, chat, translation and honest availability', async () => {
    expect(await assistant.availability('en')).toEqual({ language: 'en', onDeviceModel: true, speechInput: true, speechOutput: true });
    expect(await assistant.analyzeTask('Move a chair', 'en')).toEqual(job);
    expect(mock.analyzeTask).toHaveBeenCalledWith({ text: 'Move a chair', language: 'en' });
    expect(await assistant.chat([{ role: 'user', text: 'Move a chair' }], 'en', { firstName: 'Margaret' })).toEqual({ text: 'Shall I post this?', job, engine: 'apple-on-device', originalText: 'Move a chair' });
    expect(await assistant.translate('Move a chair', 'en', 'es')).toBe('Mover una silla');
    const bridge = audioBridge();
    mock.speak.mockImplementation(async ({ sessionId }) => { bridge.emit('speechEnded', { sessionId, reason: 'completed' }); return { sessionId }; });
    await assistant.speak('Hello', 'en'); expect(mock.speak).toHaveBeenCalledWith({ text: 'Hello', language: 'en', sessionId: expect.any(String) });
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
    expect(result).toEqual({ text: "Hi, I'm the FixList assistant. What would you like help with at home?", job: null, engine: 'rules' });
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
    const partial = vi.fn(), bridge = audioBridge();
    const session = await assistant.startListening('es', partial);
    expect(mock.startListening).toHaveBeenCalledWith({ language: 'es', sessionId: session.sessionId });
    mock.stopListening.mockResolvedValueOnce({ sessionId: session.sessionId, text: 'Move a chair' });
    bridge.emit('partial', { sessionId: session.sessionId, text: 'Una silla' }); expect(partial).toHaveBeenCalledWith('Una silla');
    expect(await session.stop()).toBe('Move a chair'); await flush(); expect(bridge.count()).toBe(0);
    bridge.emit('partial', { sessionId: session.sessionId, text: 'late' }); expect(partial).toHaveBeenCalledTimes(1);
    expect(await session.stop()).toBe('Move a chair'); expect(mock.stopListening).toHaveBeenCalledOnce();
  });
  it('cancels native listening and catches cleanup rejection', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('gone')); mock.addListener.mockResolvedValue({ remove });
    const session = await assistant.startListening('en', vi.fn());
    mock.cancelListening.mockRejectedValue(new Error('gone')); session.cancel();
    expect(await session.stop()).toBe(''); expect(remove).toHaveBeenCalledTimes(2);
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
    expect(await web.availability('en')).toEqual({ language: 'en', onDeviceModel: false, speechInput: false, speechOutput: false });
    await expect(web.startListening('en', vi.fn())).rejects.toThrow(/Speech input.*unavailable/i);
    expect(await web.translate('Hello', 'en', 'es')).toBeNull();
  });
  it('falls back to an installed local browser voice with locale and natural delivery', async () => {
    class Utterance { text: string; lang = ''; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } }
    const local = { lang: 'fr-FR', localService: true, voiceURI: 'local-fr' };
    const speech = { getVoices: () => [{ lang: 'fr-FR', localService: false, voiceURI: 'remote-fr' }, local], speak: vi.fn((utterance: Utterance) => utterance.onend?.()), cancel: vi.fn() };
    const browser = { speechSynthesis: speech, SpeechSynthesisUtterance: Utterance } as unknown as AssistantBrowser;
    mock.speak.mockRejectedValueOnce(Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' }));
    const api = createAssistant({ browser: () => browser }); await api.speak('Bonjour', 'fr');
    expect(speech.speak.mock.calls[0]?.[0]).toMatchObject({ text: 'Bonjour', lang: 'fr-FR', rate: 1, voice: local });
    api.stopSpeaking(); expect(speech.cancel).toHaveBeenCalled();
  });
  it.each([
    { voices: [] },
    { voices: [{ lang: 'fr-FR', localService: false, voiceURI: 'remote' }] },
    { voices: [{ lang: 'en-US', localService: true, voiceURI: 'other-language' }] },
  ])('does not speak through a remote or mismatched browser default voice %#', async ({ voices }) => {
    class Utterance { lang = ''; rate = 1; }
    const speech = { getVoices: () => voices, speak: vi.fn(), cancel: vi.fn() };
    const api = createAssistant({ isNative: () => false, browser: () => ({ speechSynthesis: speech, SpeechSynthesisUtterance: Utterance } as unknown as AssistantBrowser) });
    expect(await api.availability('fr')).toMatchObject({ speechOutput: false });
    await api.speak('Bonjour', 'fr'); expect(speech.speak).not.toHaveBeenCalled();
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
  it.each(['final', 'error'] as const)('exposes browser %s through done and preserves the transcript', async reason => {
    let recognition!: BrowserRecognition;
    const abort = vi.fn();
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: BrowserRecognition['onerror'] = null; onresult: BrowserRecognition['onresult'] = null;
      constructor() { recognition = this; }
      start() { this.onstart?.(); } stop() { this.onend?.(); } abort() { abort(); }
    }
    const api = createAssistant({ isNative: () => false, browser: () => ({ SpeechRecognition: Recognition }) });
    const session = await api.startListening('en', vi.fn());
    recognition.onresult?.({ results: [{ 0: { transcript: 'Recover these words' }, isFinal: false, length: 1 }], resultIndex: 0 });
    if (reason === 'final') recognition.onend?.(); else recognition.onerror?.({ error: 'network' });
    expect(await session.done).toEqual({ sessionId: session.sessionId, reason, text: 'Recover these words' });
    expect(await session.stop()).toBe('Recover these words'); expect(recognition.onresult).toBeNull();
    if (reason === 'error') expect(abort).toHaveBeenCalledOnce();
  });
  it('settles browser output on stop and clears its progress watchdog and callbacks', async () => {
    vi.useFakeTimers(); let utterance!: SpeechSynthesisUtterance;
    class Utterance {
      lang = ''; rate = 1; onend = null; onerror = null; onstart = null; onboundary = null;
      constructor() { utterance = this as unknown as SpeechSynthesisUtterance; }
    }
    const synthesis = { cancel: vi.fn(), getVoices: () => [{ lang: 'en-US', localService: true, voiceURI: 'local-en' }], speak: vi.fn() };
    const api = createAssistant({ isNative: () => false, browser: () => ({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance } as unknown as AssistantBrowser) });
    const speaking = api.speak('Browser reply', 'en'); await flush();
    expect(vi.getTimerCount()).toBe(1); api.stopSpeaking(); await speaking;
    expect(vi.getTimerCount()).toBe(0); expect(utterance.onend).toBeNull(); expect(utterance.onboundary).toBeNull();
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

describe('selected-language capability contract', () => {
  it('sends the selected language and preserves independent native capabilities', async () => {
    mock.availability.mockResolvedValue({ language: 'ru', onDeviceModel: false, speechInput: true, speechOutput: false, reason: 'unsupported-language', speechOutputReason: 'voice-unavailable' });
    expect(await createAssistant().availability('ru')).toEqual({ language: 'ru', onDeviceModel: false, speechInput: true, speechOutput: false, reason: 'unsupported-language', speechOutputReason: 'voice-unavailable' });
    expect(mock.availability).toHaveBeenCalledExactlyOnceWith({ language: 'ru' });
  });
  it.each([
    { language: 'es', onDeviceModel: true, speechInput: true, speechOutput: true },
    { language: 'ru', onDeviceModel: 'true', speechInput: true, speechOutput: true },
    { language: 'ru', onDeviceModel: false, speechInput: true, speechOutput: true, reason: { installed: true } },
    { language: 'ru', onDeviceModel: false, speechInput: true, speechOutput: true, speechInputReason: 'made-up-install-status' },
    { language: 'ru', onDeviceModel: true, speechInput: true, speechOutput: true, reason: 'unsupported-language' },
  ])('fails closed on malformed or mismatched bridge availability %#', async value => {
    mock.availability.mockResolvedValue(value);
    const api = createAssistant({ browser: () => ({ SpeechRecognition: class {} } as unknown as AssistantBrowser) });
    expect(await api.availability('ru')).toMatchObject({ language: 'ru', onDeviceModel: false, speechInput: false, speechOutput: false, reason: 'native-unavailable' });
  });
  it('never reports browser microphone support when the native bridge is missing', async () => {
    mock.availability.mockRejectedValue(new Error('Missing plugin'));
    const api = createAssistant({ browser: () => ({ SpeechRecognition: class {} } as unknown as AssistantBrowser) });
    expect(await api.availability('ar')).toMatchObject({ language: 'ar', speechInput: false, speechOutput: false, reason: 'native-unavailable' });
  });
});
