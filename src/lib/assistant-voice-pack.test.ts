import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistant, type AssistantBrowser, type NativeAssistantPlugin } from './assistant';
import { assistantConversationCopy } from './assistant-copy';
type EventName = Parameters<NativeAssistantPlugin['addListener']>[0];
type Listener = Parameters<NativeAssistantPlugin['addListener']>[1];
function fixture() {
  const listeners = new Map<EventName, Set<Listener>>();
  const plugin: NativeAssistantPlugin = {
    availability: vi.fn(async () => ({})), analyzeTask: vi.fn(async () => ({})), chat: vi.fn(async () => ({})), startListening: vi.fn(async () => ({})), stopListening: vi.fn(async () => ({})), cancelListening: vi.fn(async () => ({})), translate: vi.fn(async () => ({})),
    speak: vi.fn(async () => ({})), stopSpeaking: vi.fn(async () => ({})),
    addListener: vi.fn(async (name: EventName, callback: Listener) => {
      const callbacks = listeners.get(name) ?? new Set(); listeners.set(name, callbacks); callbacks.add(callback);
      return { remove: async () => { callbacks.delete(callback); } };
    }),
  };
  class Utterance { text: string; lang = ''; rate = 1; onend: (() => void) | null = null; constructor(text: string) { this.text = text; } }
  const browserSpeech = { getVoices: () => [{ lang: 'en-US', localService: true, voiceURI: 'installed-en' }], speak: vi.fn((utterance: Utterance) => utterance.onend?.()), cancel: vi.fn() };
  const api = createAssistant({ plugin, isNative: () => true, browser: () => ({ speechSynthesis: browserSpeech, SpeechSynthesisUtterance: Utterance } as unknown as AssistantBrowser) });
  return { api, plugin, browserSpeech, emit(name: EventName, event: Parameters<Listener>[0]) { for (const listener of listeners.get(name) ?? []) listener(event); } };
}
afterEach(() => vi.useRealTimers());
describe('bundled prompt native/JS speech contract', () => {
  it('does not replay a known clip failure even if rejection arrives before its native terminal event', async () => {
    const { api, plugin, browserSpeech } = fixture();
    vi.mocked(plugin.speak).mockRejectedValue(Object.assign(new Error('Known prompt resource failed'), { code: 'VOICE_PACK_UNAVAILABLE' }));
    await api.speak(assistantConversationCopy.en.question, 'en');
    expect(browserSpeech.speak).not.toHaveBeenCalled();
  });
  it('preserves the existing pre-playback system-voice fallback for an arbitrary unknown sentence', async () => {
    const { api, plugin, browserSpeech } = fixture();
    vi.mocked(plugin.speak).mockRejectedValue(Object.assign(new Error('Installed native voice unavailable'), { code: 'UNAVAILABLE' }));
    await api.speak('An arbitrary public test sentence.', 'en');
    expect(browserSpeech.speak).toHaveBeenCalledOnce();
  });
  it('accepts one clip-start and real completion without invented word events within the watchdog bound', async () => {
    vi.useFakeTimers(); const { api, plugin, browserSpeech, emit } = fixture(); let id = '', finished = false;
    vi.mocked(plugin.speak).mockImplementation(async options => { id = options.sessionId; emit('speechProgress', { sessionId: id, stage: 'started' }); return {}; });
    const speaking = api.speak(assistantConversationCopy.en.question, 'en').then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(14_999); expect(finished).toBe(false); expect(plugin.stopSpeaking).not.toHaveBeenCalled();
    emit('speechEnded', { sessionId: id, reason: 'completed' }); await speaking;
    // Listener removals run through the bridge's bounded asynchronous cleanup.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(finished).toBe(true); expect(browserSpeech.speak).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cannot fall back when cancellation wins against a late known-clip failure', async () => {
    const { api, plugin, browserSpeech } = fixture(); let reject: ((reason: unknown) => void) | undefined;
    vi.mocked(plugin.speak).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const speaking = api.speak(assistantConversationCopy.en.question, 'en');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    api.stopSpeaking(); reject?.(Object.assign(new Error('Late resource error'), { code: 'VOICE_PACK_UNAVAILABLE' })); await speaking;
    expect(browserSpeech.speak).not.toHaveBeenCalled(); expect(plugin.stopSpeaking).toHaveBeenCalled();
  });
});
