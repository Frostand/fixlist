import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { SKILLS, TASK_CATEGORIES, TOOLS, type Assistant, type AssistantAvailability, type ChatTurn, type JobAnalysis, type ListeningSession } from '../community/types';
import { analyzeTaskWithRules, clearRuleTask, ruleFollowup, ruleUrgency } from '../community/task-rules';
import type { Language } from '../domain/roles';
import { localeFor } from '../i18n';
import { assistantConversationCopy as copy } from './assistant-copy';

/** Native returns untrusted bridge data; validate before showing a job preview. */
export interface NativeAssistantPlugin {
  availability(options: { language: Language }): Promise<unknown>;
  analyzeTask(options: { text: string; language: Language }): Promise<unknown>;
  chat(options: { turns: readonly ChatTurn[]; language: Language; firstName: string }): Promise<unknown>;
  startListening(options: { sessionId: string; language: Language }): Promise<unknown>;
  stopListening(options: { sessionId: string }): Promise<unknown>;
  cancelListening(options: { sessionId: string }): Promise<unknown>;
  addListener(event: 'partial' | 'listeningEnded' | 'speechProgress' | 'speechEnded', callback: (value: { sessionId: string; text?: string; reason?: string; stage?: string }) => void): Promise<PluginListenerHandle>;
  speak(options: { sessionId: string; text: string; language: Language }): Promise<unknown>;
  stopSpeaking(options: { sessionId: string }): Promise<unknown>;
  translate(options: { text: string; from: Language; to: Language }): Promise<unknown>;
}
interface RecognitionResult { readonly [index: number]: { transcript: string }; isFinal: boolean; length: number }
export interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult>; resultIndex: number }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface AssistantBrowser {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}
export interface AssistantDependencies {
  plugin?: NativeAssistantPlugin;
  isNative?: () => boolean;
  browser?: () => AssistantBrowser | undefined;
  analyzeWithRules?: typeof analyzeTaskWithRules;
}
const plugin = registerPlugin<NativeAssistantPlugin>('FixListAssistant');
const TIMEOUT_MS = 20_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
function nativeJob(value: unknown, language: Language): JobAnalysis {
  if (!record(value) || !['title', 'titleEnglish', 'summary', 'summaryEnglish'].every((key) => textValue(value[key]))
    || !TASK_CATEGORIES.includes(value.category as JobAnalysis['category'])
    || !Array.isArray(value.skills) || value.skills.length > SKILLS.length || !value.skills.every((s) => SKILLS.includes(s as typeof SKILLS[number]))
    || !Array.isArray(value.tools) || value.tools.length > TOOLS.length || !value.tools.every((t) => TOOLS.includes(t as typeof TOOLS[number]))
    || !Number.isInteger(value.estimatedMinutes) || (value.estimatedMinutes as number) < 10 || (value.estimatedMinutes as number) > 480
    || (value.peopleNeeded !== 1 && value.peopleNeeded !== 2) || !['today', 'this-week', 'flexible'].includes(value.urgency as string)
    || !Array.isArray(value.safetyNotes) || value.safetyNotes.length > 3 || !value.safetyNotes.every((s) => textValue(s) && s.length <= 300)
    || value.language !== language || value.engine !== 'apple-on-device') throw new Error('Invalid on-device job draft.');
  return { title: value.title as string, titleEnglish: value.titleEnglish as string, summary: value.summary as string, summaryEnglish: value.summaryEnglish as string,
    category: value.category as JobAnalysis['category'], skills: [...new Set(value.skills)] as JobAnalysis['skills'], tools: [...new Set(value.tools)] as JobAnalysis['tools'],
    estimatedMinutes: value.estimatedMinutes as number, peopleNeeded: value.peopleNeeded, urgency: value.urgency as JobAnalysis['urgency'], safetyNotes: [...value.safetyNotes] as string[], language, engine: 'apple-on-device' };
}
/** Promise.race attaches rejection handlers even when native completes after timeout. */
async function bounded<T>(run: () => Promise<T>, cancelled: Promise<never> = new Promise(() => {})): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([cancelled, Promise.resolve().then(run), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Native assistant timed out.')), TIMEOUT_MS); })]); }
  finally { clearTimeout(timer); }
}
function quietly(run: () => Promise<unknown>): void { void bounded(run).catch(() => {}); }
function browserVoice(synthesis: SpeechSynthesis | undefined, language: Language): SpeechSynthesisVoice | undefined {
  const locale = localeFor(language).toLowerCase(), base = locale.split('-')[0];
  try {
    return synthesis?.getVoices().filter(voice => voice.localService && voice.lang.toLowerCase().split('-')[0] === base).sort((left, right) => {
      const leftExact = left.lang.toLowerCase() === locale, rightExact = right.lang.toLowerCase() === locale;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      return left.voiceURI < right.voiceURI ? -1 : left.voiceURI > right.voiceURI ? 1 : 0;
    })[0];
  } catch { return undefined; }
}
function browserAvailability(browser: AssistantBrowser | undefined, language: Language): AssistantAvailability {
  return { language, onDeviceModel: false, speechInput: !!(browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition), speechOutput: !!(browser?.SpeechSynthesisUtterance && browserVoice(browser.speechSynthesis, language)) };
}
/** Keep a small, auditable user-only provenance window within Job.originalText's limit.
 * Fail closed rather than silently truncate a correction or an oversized turn. */
function conversationWindow(turns: readonly ChatTurn[]): ChatTurn[] | null {
  const recent = turns.slice(-12);
  if (!recent.length || recent.at(-1)?.role !== 'user' || recent.some(turn => !['user', 'assistant'].includes(turn.role) || !textValue(turn.text))) return null;
  const original = recent.filter(turn => turn.role === 'user').map(turn => turn.text).join('\n');
  return original.length <= 4000 ? recent : null;
}
function rulesConversationJob(turns: readonly ChatTurn[], language: Language, rules: typeof analyzeTaskWithRules): { job: JobAnalysis; reply: 'ready' | 'updated' | 'timing' | 'detail' } | null {
  let task: string | null = null, timing: JobAnalysis['urgency'] | undefined;
  let reply: 'ready' | 'updated' | 'timing' | 'detail' = 'ready';
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    if (clearRuleTask(turn.text)) { reply = task ? 'updated' : 'ready'; task = turn.text; timing = undefined; }
    else {
      const followup = ruleFollowup(turn.text);
      if (task && followup) { reply = followup === 'timing' ? 'timing' : 'detail'; if (followup === 'timing') timing = ruleUrgency(turn.text); }
      else { task = null; timing = undefined; }
    }
  }
  if (!task) return null;
  const job = rules(task, language);
  return { job: timing === undefined ? job : { ...job, urgency: timing }, reply };
}
/** Whole utterances only: social words embedded in a request never change task parsing. */
function rulesConversationReply(text: string, language: Language): string {
  const social = text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  if (/^(?:hi|hello|hey|hola|你好|您好|안녕하세요|안녕|xinchào|chào|kumusta|здравствуйте|привет|bonjour|salut|مرحبا|مرحبًا)$/u.test(social)) return copy[language].greeting;
  if (/^(?:thanks|thankyou|gracias|谢谢|謝謝|감사합니다|고마워요|cảmơn|salamat|спасибо|merci|شكرا|شكرًا)$/u.test(social)) return copy[language].thanks;
  if (/^(?:(?:actually|no|cancel|нет|не|hindi|không|non|ليس|لا)(?![\p{L}\p{N}])|아니|不是|不要|取消)/iu.test(text.trim())) return copy[language].clarify;
  return copy[language].question;
}
function shortReply(value: unknown, language: Language): value is string {
  if (!textValue(value) || value.length > 500 || (value.match(/[?؟？]/gu)?.length ?? 0) > 1) return false;
  const sentences = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(localeFor(language), { granularity: 'sentence' }).segment(value)).filter((part) => part.segment.trim())
    : value.split(/[.!?。！？؟]+/u).filter((part) => part.trim());
  return sentences.length <= 2;
}

let audioSequence = 0;
const audioId = () => globalThis.crypto?.randomUUID?.() ?? `audio-${Date.now()}-${++audioSequence}`;
type ListeningEnd = Awaited<ListeningSession['done']>;
const listeningReasons: readonly ListeningEnd['reason'][] = ['final', 'stopped', 'cancelled', 'error', 'interrupted', 'background'];

/** Injectable platform/audio adapters keep tests independent of the model, permissions, and DOM. */
export function createAssistant(deps: AssistantDependencies = {}): Assistant {
  const native = deps.plugin ?? plugin, isNative = deps.isNative ?? (() => Capacitor.isNativePlatform());
  const browser = deps.browser ?? (() => typeof window === 'undefined' ? undefined : window as unknown as AssistantBrowser);
  const rules = deps.analyzeWithRules ?? analyzeTaskWithRules;
  let speechEpoch = 0, finishSpeech: (() => void) | undefined;
  let currentListening: ListeningSession | undefined, listeningEpoch = 0;
  // Late listener-registration ACKs are removed as well as already registered handles.
  const listeners = () => {
    let closed = false;
    const handles: PluginListenerHandle[] = [];
    return {
      async add(event: Parameters<NativeAssistantPlugin['addListener']>[0], callback: Parameters<NativeAssistantPlugin['addListener']>[1], cancelled: Promise<never>) {
        await bounded(async () => {
          const handle = await native.addListener(event, callback);
          if (closed) quietly(() => handle.remove()); else handles.push(handle);
        }, cancelled);
      },
      close() { closed = true; for (const handle of handles.splice(0)) quietly(() => handle.remove()); },
    };
  };
  const stopSpeaking = () => {
    speechEpoch++;
    finishSpeech?.(); finishSpeech = undefined;
    try { browser()?.speechSynthesis?.cancel(); } catch { /* A missing audio device is recoverable. */ }
  };
  const webListening = async (language: Language, onPartial: (text: string) => void, signal?: AbortSignal): Promise<ListeningSession> => {
    const Constructor = browser()?.SpeechRecognition ?? browser()?.webkitSpeechRecognition;
    if (!Constructor) throw new Error('Speech input is unavailable in this browser. You can type your request instead.');
    const recognition = new Constructor(), sessionId = audioId();
    recognition.lang = localeFor(language); recognition.continuous = true; recognition.interimResults = true;
    let transcript = '', terminal: ListeningEnd | undefined, startSettled = false;
    let stopPromise: Promise<string> | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined;
    let settleStart: (error?: Error) => void = () => {};
    let resolveDone!: (end: ListeningEnd) => void;
    const done = new Promise<ListeningEnd>(resolve => { resolveDone = resolve; });
    const abort = () => session.cancel();
    const finish = (reason: ListeningEnd['reason']) => {
      if (terminal) return;
      terminal = { sessionId, reason, text: reason === 'cancelled' ? '' : transcript };
      settleStart(new Error(reason === 'cancelled' ? 'Speech input was cancelled.' : 'Speech input ended before it started. You can type instead.'));
      clearTimeout(stopTimer); signal?.removeEventListener('abort', abort);
      recognition.onstart = recognition.onresult = recognition.onend = recognition.onerror = null;
      if (currentListening === session) currentListening = undefined;
      resolveDone(terminal);
    };
    const session: ListeningSession = {
      sessionId, done,
      stop() {
        if (!stopPromise) {
          stopPromise = done.then(end => end.text);
          if (!terminal) {
            stopTimer = setTimeout(() => { finish('stopped'); try { recognition.abort(); } catch { /* Already stopped. */ } }, 2000);
            try { recognition.stop(); } catch { finish('error'); }
          }
        }
        return stopPromise;
      },
      cancel() { if (terminal) return; finish('cancelled'); try { recognition.abort(); } catch { /* Already stopped. */ } },
    };
    currentListening = session;
    const started = new Promise<void>((resolve, reject) => {
      const startTimer = setTimeout(() => { finish('error'); try { recognition.abort(); } catch { /* Already stopped. */ } }, TIMEOUT_MS);
      settleStart = (error?: Error) => { if (startSettled) return; startSettled = true; clearTimeout(startTimer); if (error) reject(error); else resolve(); };
      recognition.onstart = () => settleStart();
      recognition.onresult = event => {
        transcript = Array.from(event.results, result => result[0]?.transcript ?? '').join(' ').trim();
        onPartial(transcript);
      };
      recognition.onerror = event => {
        settleStart(new Error(`Speech input could not start (${event.error}). You can type instead.`)); finish('error');
        try { recognition.abort(); } catch { /* Already stopped. */ }
      };
      recognition.onend = () => finish(stopPromise ? 'stopped' : 'final');
      try { recognition.start(); } catch { finish('error'); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) session.cancel();
    await started; return session;
  };
  return {
    async availability(language) {
      if (!isNative()) return browserAvailability(browser(), language);
      try {
        const value = await bounded(() => native.availability({ language }));
        const modelReasons = ['requires-iOS-26', 'unsupported-language', 'apple-intelligence-not-enabled', 'device-not-eligible', 'model-not-ready', 'model-unavailable', 'native-unavailable'];
        const inputReasons = ['permission-denied', 'recognizer-unavailable', 'on-device-recognition-unavailable'];
        if (!record(value) || value.language !== language || typeof value.onDeviceModel !== 'boolean' || typeof value.speechInput !== 'boolean' || typeof value.speechOutput !== 'boolean'
          || (value.reason !== undefined && !modelReasons.includes(value.reason as string))
          || (value.speechInputReason !== undefined && !inputReasons.includes(value.speechInputReason as string))
          || (value.speechOutputReason !== undefined && value.speechOutputReason !== 'voice-unavailable')
          || (value.onDeviceModel && value.reason !== undefined) || (value.speechInput && value.speechInputReason !== undefined) || (value.speechOutput && value.speechOutputReason !== undefined)) throw new Error('Invalid availability.');
        return { language, onDeviceModel: value.onDeviceModel, speechInput: value.speechInput, speechOutput: value.speechOutput,
          ...(value.reason !== undefined ? { reason: value.reason as NonNullable<AssistantAvailability['reason']> } : {}),
          ...(value.speechInputReason !== undefined ? { speechInputReason: value.speechInputReason as NonNullable<AssistantAvailability['speechInputReason']> } : {}),
          ...(value.speechOutputReason === 'voice-unavailable' ? { speechOutputReason: value.speechOutputReason } : {}) };
      } catch { return { language, onDeviceModel: false, speechInput: false, speechOutput: false, reason: 'native-unavailable' }; }
    },
    async analyzeTask(text, language) {
      if (isNative()) { try { return nativeJob(await bounded(() => native.analyzeTask({ text, language })), language); } catch { /* Deterministic, labelled local fallback. */ } }
      return rules(text, language);
    },
    async chat(turns, language, context) {
      const recent = conversationWindow(turns);
      if (!recent) return { text: copy[language].question, job: null, engine: 'rules' };
      const originalText = recent.filter(turn => turn.role === 'user').map(turn => turn.text).join('\n');
      if (isNative()) {
        try {
          const value = await bounded(() => native.chat({ turns: recent, language, firstName: context.firstName }));
          if (!record(value) || !shortReply(value.text, language)) throw new Error('Invalid assistant reply.');
          const job = value.job == null ? null : nativeJob(value.job, language);
          return { text: value.text, job, engine: 'apple-on-device', ...(job ? { originalText } : {}) };
        } catch { /* A failed session never prevents typing a request. */ }
      }
      const draft = rulesConversationJob(recent, language, rules);
      return { text: draft ? copy[language][draft.reply] : rulesConversationReply(recent.at(-1)!.text, language), job: draft?.job ?? null, engine: 'rules', ...(draft ? { originalText } : {}) };
    },
    async startListening(language, onPartial, signal) {
      if (signal?.aborted) throw new Error('Speech input was cancelled.');
      const epoch = ++listeningEpoch;
      currentListening?.cancel(); stopSpeaking();
      if (isNative()) {
        const sessionId = audioId(), events = listeners();
        let transcript = '', terminal: ListeningEnd | undefined, stopped: Promise<string> | undefined;
        let resolveDone!: (end: ListeningEnd) => void, rejectStart!: (error: Error) => void;
        const done = new Promise<ListeningEnd>(resolve => { resolveDone = resolve; });
        const cancelled = new Promise<never>((_, reject) => { rejectStart = reject; });
        void cancelled.catch(() => {});
        const abort = () => session.cancel();
        const finish = (reason: ListeningEnd['reason'], text = transcript) => {
          if (terminal) return;
          terminal = { sessionId, reason, text: reason === 'cancelled' ? '' : text };
          events.close(); signal?.removeEventListener('abort', abort);
          if (currentListening === session) currentListening = undefined;
          resolveDone(terminal);
        };
        const session: ListeningSession = {
          sessionId, done,
          stop() {
            if (!stopped) {
              stopped = done.then(end => end.text);
              if (!terminal) void bounded(() => native.stopListening({ sessionId }), cancelled).then(result => {
                // Responses carry the same terminal reason as the event, whichever arrives first.
                if (record(result) && result.sessionId === sessionId) finish(listeningReasons.includes(result.reason as ListeningEnd['reason']) ? result.reason as ListeningEnd['reason'] : 'stopped', typeof result.text === 'string' ? result.text : transcript);
                else if (!terminal) { quietly(() => native.cancelListening({ sessionId })); finish('error'); }
              }).catch(() => { if (!terminal) { quietly(() => native.cancelListening({ sessionId })); finish('error'); } });
            }
            return stopped;
          },
          cancel() {
            if (terminal) return;
            finish('cancelled'); rejectStart(new Error('Speech input was cancelled.'));
            quietly(() => native.cancelListening({ sessionId }));
          },
        };
        currentListening = session;
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) session.cancel();
        try {
          await events.add('partial', event => {
            if (!terminal && event.sessionId === sessionId && typeof event.text === 'string') { transcript = event.text; onPartial(transcript); }
          }, cancelled);
          await events.add('listeningEnded', event => {
            if (event.sessionId === sessionId && listeningReasons.includes(event.reason as ListeningEnd['reason'])) finish(event.reason as ListeningEnd['reason'], typeof event.text === 'string' ? event.text : transcript);
          }, cancelled);
          if (epoch !== listeningEpoch) throw new Error('Speech input was cancelled.');
          await bounded(() => {
            if (epoch !== listeningEpoch || terminal?.reason === 'cancelled') throw new Error('Speech input was cancelled.');
            return native.startListening({ sessionId, language });
          }, cancelled);
          if (epoch !== listeningEpoch) throw new Error('Speech input was cancelled.');
          // A terminal event may arrive before the startup ACK. done retains it for the UI.
          return session;
        } catch (error) {
          const superseded = epoch !== listeningEpoch || terminal?.reason === 'cancelled';
          const receivedTerminal = !!terminal;
          if (!terminal) { quietly(() => native.cancelListening({ sessionId })); finish('error'); }
          if (superseded) throw new Error('Speech input was cancelled.');
          // Any native terminal is authoritative, even an error with no transcript.
          // A bridge failure without a terminal can still recover partial words.
          if (receivedTerminal || terminal?.text) return session;
          throw new Error('On-device speech input is unavailable. You can type your request instead.', { cause: error });
        }
      }
      if (epoch !== listeningEpoch || signal?.aborted) throw new Error('Speech input was cancelled.');
      return webListening(language, onPartial, signal);
    },
    async speak(text, language) {
      stopSpeaking(); const epoch = speechEpoch;
      if (!text.trim()) return;
      if (isNative()) {
        const sessionId = audioId(), events = listeners();
        let ended = false, began = false, fallback = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let resolveDone!: () => void, rejectAck!: (error: Error) => void;
        const done = new Promise<void>(resolve => { resolveDone = resolve; });
        const cancelled = new Promise<never>((_, reject) => { rejectAck = reject; });
        void cancelled.catch(() => {});
        const finish = (cancel = false) => {
          if (ended) return;
          ended = true; clearTimeout(timer); events.close();
          if (finishSpeech === stop) finishSpeech = undefined;
          rejectAck(new Error('Speech output ended.'));
          if (cancel) quietly(() => native.stopSpeaking({ sessionId }));
          resolveDone();
        };
        const stop = () => finish(true);
        const progress = () => { clearTimeout(timer); timer = setTimeout(stop, TIMEOUT_MS); };
        finishSpeech = stop;
        try {
          await events.add('speechProgress', event => {
            if (!ended && event.sessionId === sessionId && (event.stage === 'started' || event.stage === 'word')) { began = true; progress(); }
          }, cancelled);
          await events.add('speechEnded', event => { if (event.sessionId === sessionId && typeof event.reason === 'string') finish(); }, cancelled);
          if (ended || epoch !== speechEpoch) return;
          await bounded(() => {
            if (ended || epoch !== speechEpoch) throw new Error('Speech output ended.');
            return native.speak({ sessionId, text, language });
          }, cancelled);
          if (!ended) progress();
        } catch (error) {
          // Only the bridge's explicit pre-playback rejection permits a browser fallback.
          fallback = !ended && !began && epoch === speechEpoch && record(error) && error.code === 'UNAVAILABLE';
          if (!ended) finish(!fallback);
        }
        if (!fallback) { await done; return; }
      }
      if (epoch !== speechEpoch) return;
      const web = browser(), synthesis = web?.speechSynthesis, Utterance = web?.SpeechSynthesisUtterance;
      if (!synthesis || !Utterance) return;
      const voice = browserVoice(synthesis, language);
      if (!voice) return;
      await new Promise<void>(resolve => {
        let utterance: SpeechSynthesisUtterance | undefined, timer: ReturnType<typeof setTimeout> | undefined, ended = false;
        const finish = () => {
          if (ended) return; ended = true; clearTimeout(timer);
          if (utterance) utterance.onend = utterance.onerror = utterance.onstart = utterance.onboundary = null;
          if (finishSpeech === finish) finishSpeech = undefined; resolve();
        };
        const progress = () => { clearTimeout(timer); timer = setTimeout(() => { finish(); try { synthesis.cancel(); } catch { /* Already stopped. */ } }, TIMEOUT_MS); };
        finishSpeech = finish;
        try {
          utterance = new Utterance(text);
          utterance.lang = localeFor(language); utterance.rate = 1; utterance.voice = voice;
          utterance.onend = finish; utterance.onerror = finish; utterance.onstart = progress; utterance.onboundary = progress;
          progress(); synthesis.speak(utterance);
        } catch { finish(); }
      });
    },
    stopSpeaking,
    async translate(text, from, to) {
      if (!isNative()) return null;
      try { const value = await bounded(() => native.translate({ text, from, to })); return record(value) && textValue(value.text) ? value.text : null; }
      catch { return null; }
    },
  };
}

export const assistant: Assistant = createAssistant();
