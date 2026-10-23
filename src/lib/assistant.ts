import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { SKILLS, TASK_CATEGORIES, TOOLS, type Assistant, type AssistantAvailability, type ChatTurn, type JobAnalysis, type ListeningSession } from '../community/types';
import { analyzeTaskWithRules } from '../community/task-rules';
import type { Language } from '../domain/roles';
import { localeFor } from '../i18n';

/** Native returns untrusted bridge data; validate before showing a job preview. */
export interface NativeAssistantPlugin {
  availability(): Promise<unknown>;
  analyzeTask(options: { text: string; language: Language }): Promise<unknown>;
  chat(options: { turns: readonly ChatTurn[]; language: Language; firstName: string }): Promise<unknown>;
  startListening(options: { language: Language }): Promise<unknown>;
  stopListening(): Promise<unknown>;
  cancelListening(): Promise<unknown>;
  addListener(event: 'partial', callback: (value: { text: string }) => void): Promise<PluginListenerHandle>;
  speak(options: { text: string; language: Language }): Promise<unknown>;
  stopSpeaking(): Promise<unknown>;
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
const copy: Record<Language, { question: string; ready: string }> = {
  en: { question: 'What do you need help with, and in which room?', ready: 'I wrote this up for you. Would you like to post it?' },
  es: { question: '¿Con qué necesita ayuda y en qué habitación?', ready: 'Ya preparé su solicitud. ¿Quiere publicarla?' },
  zh: { question: '您需要什么帮助，在哪个房间？', ready: '我已为您写好请求。您想发布吗？' },
  vi: { question: 'Bác cần giúp việc gì và ở phòng nào?', ready: 'Tôi đã viết yêu cầu giúp bác. Bác có muốn đăng không?' },
  ko: { question: '어떤 도움이 필요하시고, 어느 방인가요?', ready: '요청을 정리해 드렸어요. 게시할까요?' },
  tl: { question: 'Ano po ang kailangan ninyong tulong at saang silid?', ready: 'Naisulat ko na po ang inyong kahilingan. Gusto po ba ninyong i-post ito?' },
  ru: { question: 'С чем вам нужна помощь и в какой комнате?', ready: 'Я подготовил вашу просьбу. Хотите её опубликовать?' },
  fr: { question: 'De quelle aide avez-vous besoin et dans quelle pièce ?', ready: 'J’ai rédigé votre demande. Voulez-vous la publier ?' },
  ar: { question: 'ما المساعدة التي تحتاج إليها، وفي أي غرفة؟', ready: 'كتبت طلبك لك. هل تريد نشره؟' },
};
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
async function bounded<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Native assistant timed out.')), TIMEOUT_MS); })]); }
  finally { clearTimeout(timer); }
}
function quietly(run: () => Promise<unknown>): void { void bounded(run).catch(() => {}); }
function browserAvailability(browser: AssistantBrowser | undefined): AssistantAvailability {
  return { onDeviceModel: false, speechInput: !!(browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition), speechOutput: !!(browser?.speechSynthesis && browser.SpeechSynthesisUtterance) };
}
function wordCount(text: string, language: Language): number {
  // Chinese does not separate words with spaces; use the device's locale segmenter.
  if (typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter(localeFor(language), { granularity: 'word' }).segment(text)).filter((part) => part.isWordLike).length;
  return text.split(/\s+/u).filter(Boolean).length;
}
function shortReply(value: unknown, language: Language): value is string {
  if (!textValue(value) || value.length > 500 || (value.match(/[?؟？]/gu)?.length ?? 0) > 1) return false;
  const sentences = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(localeFor(language), { granularity: 'sentence' }).segment(value)).filter((part) => part.segment.trim())
    : value.split(/[.!?。！？؟]+/u).filter((part) => part.trim());
  return sentences.length <= 2;
}

/** Injectable platform/audio adapters keep tests independent of the model, permissions, and DOM. */
export function createAssistant(deps: AssistantDependencies = {}): Assistant {
  const native = deps.plugin ?? plugin, isNative = deps.isNative ?? (() => Capacitor.isNativePlatform());
  const browser = deps.browser ?? (() => typeof window === 'undefined' ? undefined : window as unknown as AssistantBrowser);
  const rules = deps.analyzeWithRules ?? analyzeTaskWithRules;
  let speechEpoch = 0, finishBrowserSpeech: (() => void) | undefined;
  let currentListening: ListeningSession | undefined, listeningEpoch = 0;
  const stopSpeaking = () => {
    speechEpoch++;
    if (isNative()) quietly(() => native.stopSpeaking());
    try { browser()?.speechSynthesis?.cancel(); } catch { /* A missing audio device is recoverable. */ }
    finishBrowserSpeech?.(); finishBrowserSpeech = undefined;
  };
  const webListening = async (language: Language, onPartial: (text: string) => void): Promise<ListeningSession> => {
    const Constructor = browser()?.SpeechRecognition ?? browser()?.webkitSpeechRecognition;
    if (!Constructor) throw new Error('Speech input is unavailable in this browser. You can type your request instead.');
    const recognition = new Constructor();
    recognition.lang = localeFor(language); recognition.continuous = true; recognition.interimResults = true;
    let transcript = '', ended = false, cancelled = false, startSettled = false;
    let finishStop: ((text: string) => void) | undefined, stopPromise: Promise<string> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let settleStart: (error?: Error) => void = () => {};
    const cleanup = () => {
      settleStart(new Error(cancelled ? 'Speech input was cancelled.' : 'Speech input ended before it started. You can type instead.'));
      ended = true; clearTimeout(stopTimer);
      recognition.onstart = recognition.onresult = recognition.onend = recognition.onerror = null;
      finishStop?.(cancelled ? '' : transcript); finishStop = undefined;
    };
    const started = new Promise<void>((resolve, reject) => {
      const startTimer = setTimeout(() => { try { recognition.abort(); } catch { /* Already stopped. */ } cleanup(); reject(new Error('Speech input did not start. You can type instead.')); }, TIMEOUT_MS);
      settleStart = (error?: Error) => { if (startSettled) return; startSettled = true; clearTimeout(startTimer); if (error) reject(error); else resolve(); };
      recognition.onstart = () => settleStart();
      recognition.onresult = (event) => {
        // Web Speech's result list contains all final segments plus current interim segments.
        transcript = Array.from(event.results, (result) => result[0]?.transcript ?? '').join(' ').trim();
        if (!cancelled) onPartial(transcript);
      };
      recognition.onerror = (event) => { settleStart(new Error(`Speech input could not start (${event.error}). You can type instead.`)); cleanup(); };
      recognition.onend = () => { settleStart(new Error('Speech input ended before it started. You can type instead.')); cleanup(); };
      try { recognition.start(); } catch { settleStart(new Error('Speech input could not start. You can type instead.')); cleanup(); }
    });
    const session: ListeningSession = {
      stop() {
        if (cancelled || ended) return Promise.resolve(cancelled ? '' : transcript);
        if (!stopPromise) stopPromise = new Promise<string>((resolve) => {
          finishStop = resolve;
          stopTimer = setTimeout(() => { try { recognition.abort(); } catch { /* Already stopped. */ } cleanup(); }, 2000);
          try { recognition.stop(); } catch { cleanup(); }
        });
        return stopPromise;
      },
      cancel() { cancelled = true; try { recognition.abort(); } catch { /* Already stopped. */ } cleanup(); },
    };
    // Store before permission resolves so another request can cancel it.
    currentListening = session;
    await started; return session;
  };
  return {
    async availability() {
      if (!isNative()) return browserAvailability(browser());
      try {
        const value = await bounded(() => native.availability());
        if (!record(value) || typeof value.onDeviceModel !== 'boolean' || typeof value.speechInput !== 'boolean' || typeof value.speechOutput !== 'boolean') throw new Error('Invalid availability.');
        return { onDeviceModel: value.onDeviceModel, speechInput: value.speechInput, speechOutput: value.speechOutput, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) };
      } catch { return { ...browserAvailability(browser()), reason: 'native-unavailable' }; }
    },
    async analyzeTask(text, language) {
      if (isNative()) { try { return nativeJob(await bounded(() => native.analyzeTask({ text, language })), language); } catch { /* Deterministic, labelled local fallback. */ } }
      return rules(text, language);
    },
    async chat(turns, language, context) {
      if (isNative()) {
        try {
          const value = await bounded(() => native.chat({ turns, language, firstName: context.firstName }));
          if (!record(value) || !shortReply(value.text, language)) throw new Error('Invalid assistant reply.');
          return { text: value.text, job: value.job == null ? null : nativeJob(value.job, language), engine: 'apple-on-device' };
        } catch { /* A failed session never prevents typing a request. */ }
      }
      const latest = turns.findLast((turn) => turn.role === 'user')?.text.trim() ?? '';
      const enough = wordCount(latest, language) >= 3;
      return { text: enough ? copy[language].ready : copy[language].question, job: enough ? rules(latest, language) : null, engine: 'rules' };
    },
    async startListening(language, onPartial) {
      const epoch = ++listeningEpoch;
      currentListening?.cancel(); stopSpeaking();
      if (isNative()) {
        let live = true, listener: PluginListenerHandle | undefined, transcript = '';
        const remove = () => { live = false; if (listener) { const handle = listener; listener = undefined; quietly(() => handle.remove()); } };
        try {
          listener = await bounded(async () => {
            const handle = await native.addListener('partial', (event) => { if (live && typeof event.text === 'string') { transcript = event.text; onPartial(event.text); } });
            if (!live) quietly(() => handle.remove());
            return handle;
          });
          if (epoch !== listeningEpoch) throw new Error('Speech input was cancelled.');
          let stopped: Promise<string> | undefined;
          const session: ListeningSession = {
            stop() {
              if (stopped) return stopped;
              if (!live) return Promise.resolve('');
              stopped = (async () => {
                try {
                  const result = await bounded(() => native.stopListening());
                  if (!live || epoch !== listeningEpoch) return '';
                  return record(result) && typeof result.text === 'string' ? result.text : transcript;
                } catch {
                  if (!live || epoch !== listeningEpoch) return '';
                  quietly(() => native.cancelListening()); return transcript;
                }
                finally { remove(); }
              })();
              return stopped;
            },
            cancel() {
              const wasLive = live; remove();
              // A retained handle from an older session cannot stop the current microphone.
              if (wasLive && currentListening === session) quietly(() => native.cancelListening());
            },
          };
          currentListening = session;
          await bounded(() => native.startListening({ language }));
          if (!live || epoch !== listeningEpoch) throw new Error('Speech input was cancelled.');
          return session;
        } catch {
          const cancelled = !live || epoch !== listeningEpoch; remove();
          if (cancelled) throw new Error('Speech input was cancelled.');
          quietly(() => native.cancelListening());
        }
      }
      if (epoch !== listeningEpoch) throw new Error('Speech input was cancelled.');
      return webListening(language, onPartial);
    },
    async speak(text, language) {
      stopSpeaking(); const epoch = speechEpoch;
      if (!text.trim()) return;
      if (isNative()) {
        try { await bounded(() => native.speak({ text, language })); return; }
        catch { if (epoch !== speechEpoch) return; quietly(() => native.stopSpeaking()); }
      }
      if (epoch !== speechEpoch) return;
      const web = browser(), synthesis = web?.speechSynthesis, Utterance = web?.SpeechSynthesisUtterance;
      if (!synthesis || !Utterance) return;
      await new Promise<void>((resolve) => {
        const finish = () => { if (finishBrowserSpeech === finish) finishBrowserSpeech = undefined; resolve(); };
        try {
          const utterance = new Utterance(text);
          utterance.lang = localeFor(language); utterance.rate = 0.85;
          const voices = synthesis.getVoices();
          const voice = voices.find((v) => v.lang === utterance.lang && v.localService) ?? voices.find((v) => v.lang === utterance.lang) ?? voices.find((v) => v.lang.split('-')[0] === utterance.lang.split('-')[0]);
          if (voice) utterance.voice = voice;
          finishBrowserSpeech = finish; utterance.onend = finish; utterance.onerror = finish;
          synthesis.speak(utterance);
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
