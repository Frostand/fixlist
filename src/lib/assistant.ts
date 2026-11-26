import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { SKILLS, TASK_CATEGORIES, TOOLS, type Assistant, type AssistantAvailability, type JobAnalysis, type ListeningSession } from '../community/types';
import { analyzeTaskWithRules } from '../community/task-rules';
import type { Language } from '../domain/roles';
import { localeFor } from '../i18n';
import { namesPlace, resolveConversation } from './assistant-conversation';
import { nativeDialogue, type NativeDialogueRequest } from './native-dialogue';
import { assistantConversationCopy, assistantFollowupCopy, assistantTurnCopy } from './assistant-copy';

/** Native returns untrusted bridge data; validate before showing a job preview. */
export interface NativeAssistantPlugin {
  availability(options: { language: Language }): Promise<unknown>;
  analyzeTask(options: { text: string; language: Language }): Promise<unknown>;
  chat(options: { language: Language; request: NativeDialogueRequest }): Promise<unknown>;
  cancelChat?(options: { requestId: string }): Promise<unknown>;
  /** On-device next-step choice for the natural back-and-forth (iOS 26+). */
  converse?(options: { language: Language; turns: Array<{ role: 'user' | 'assistant'; text: string }> }): Promise<unknown>;
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
/** Greetings and bare requests for help, which say nothing about the job yet. */
const VAGUE_OPENER = /^\W*(?:hi|hello|hey|good (?:morning|afternoon|evening)|hola|buen[oa]s(?: días| tardes| noches)?|bonjour|salut|xin chào|chào|안녕하세요|안녕|你好|您好|привет|здравствуйте|kumusta|magandang (?:umaga|hapon|gabi)|مرحبا|السلام عليكم)\b|^\W*(?:can|could) (?:you|someone) help(?: me)?(?: with (?:something|this))?\W*$|^\W*(?:i need (?:some )?help|help me|necesito (?:un poco de )?ayuda|ayúdeme|j'ai besoin d'aide|мне нужна помощь|tôi cần giúp đỡ|도와주세요|我需要帮助|kailangan ko ng tulong|أحتاج مساعدة)\W*$/iu;
/** A ladder is only kept when the person mentioned something out of reach overhead. */
const OVERHEAD = /ceiling|high|reach|bulb|light|lamp|shelf|gutter|ladder|smoke|detector|alarm|fan|attic|top|techo|alto|alcanz|bombilla|foco|luz|lámpara|escalera|estante|alarma|ventilador|천장|전구|높|선반|화재|灯|天花板|高|架|烟|đèn|trần|cao|kệ|kisame|ilaw|bumbilya|mataas|потол|лампоч|высок|полк|plafond|ampoule|haut|étagère|سقف|مصباح|عال|رف/iu;
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
  const conversations = new Map<string, (error: Error) => void>();
  const cancelNativeConversation = (requestId: string) => { if (native.cancelChat) quietly(() => native.cancelChat!({ requestId })); };
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
    async chat(turns, language, _context) {
      if (isNative() && native.converse) {
        const conversation = resolveConversation(turns, language, rules);
        const reply = (state: typeof conversation, engine: 'rules' | 'apple-on-device' = 'rules') => ({ text: state.text, job: state.job, engine, conversation: state, ...(state.job ? { originalText: state.originalText } : {}) });
        // Natural back-and-forth: Apple's on-device model chooses the next step, the app asks it in authored words,
        // and after at most two questions the model drafts the request for the person to review.
        const users = turns.filter((turn) => turn.role === 'user');
        const said = turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.text);
        try {
          const step = await bounded(() => native.converse!({ language, turns: turns.slice(-12).map(({ role, text }) => ({ role, text })) }));
          const steps = { askWhatNeedsDoing: 'what', askWhere: 'where', askWhen: 'when', askMoreDetail: 'detail' } as const;
          if (!record(step) || (typeof step.next !== 'string') || !(step.next in steps || step.next === 'readyToDraft')) throw new Error('Invalid next step.');
          const words = assistantTurnCopy[language];
          // "What do you need?" only ever opens a conversation; later steps ask about details.
          // A short opener with no recognizable job ("Hi, can you help me?") is always answered with "What would you like a hand with?".
          const vagueOpener = said.length === 0 && !conversation.task && VAGUE_OPENER.test(users[0]?.text ?? '');
          // Never ask where when they already named the room ("the light in my hallway").
          const placeKnown = Boolean(conversation.facts.location ?? conversation.facts.destination ?? conversation.facts.origin) || users.some((turn) => namesPlace(turn.text));
          // An opener that already describes a job ("The light in my hallway is out") is never answered with "What do you need?".
          const opener = users[0]?.text.trim() ?? '';
          const described = Boolean(conversation.task) || placeKnown || opener.split(/\s+/u).length >= 6 || (/[\p{Script=Han}\p{Script=Hangul}]/u.test(opener) && [...opener].length >= 8);
          const next = step.next === 'askWhatNeedsDoing' && said.length === 0 && described && !vagueOpener ? (placeKnown ? 'readyToDraft' : 'askWhere') : step.next;
          const chosen = vagueOpener ? 'what' : next === 'readyToDraft' || (next === 'askWhatNeedsDoing' && said.length > 0) || (next === 'askWhere' && placeKnown) ? null : steps[next as keyof typeof steps];
          const question = chosen ? words[chosen] : null;
          const words0 = assistantTurnCopy[language];
          // Timing is known from the reply to FixList's own "when" question, or from the person's exact words.
          const askedWhen = turns.findIndex((turn) => turn.role === 'assistant' && turn.text.includes(words0.when));
          const timeAnswer = askedWhen >= 0 ? turns.slice(askedWhen + 1).find((turn) => turn.role === 'user')?.text ?? '' : '';
          const quoted = typeof step.preferredTime === 'string' ? step.preferredTime.trim() : '';
          const when = (quoted && users.some((turn) => turn.text.toLocaleLowerCase().includes(quoted.toLocaleLowerCase())) ? quoted : timeAnswer.trim()).slice(0, 80).replace(/[\s.。!！]+$/u, '');
          const timeGiven = when.length > 0;
          // Ask when help would suit them once, unless they already said.
          const ask = question ?? (!timeGiven && !said.some((text) => text.includes(words0.when)) ? words0.when : null);
          if (ask && said.length < 2 && !said.some((text) => text.includes(ask))) {
            const question = ask;
            const text = users.length > 1 ? `${words.ack} ${question}` : question;
            return { text, job: null, engine: 'apple-on-device' as const, conversation: { ...conversation, status: 'collecting' as const, job: null, text } };
          }
          const all = users.map((turn) => turn.text).join('\n');
          let job = nativeJob(await bounded(() => native.analyzeTask({ text: all, language })), language);
          if (job.tools.includes('ladder') && !OVERHEAD.test(all)) job = { ...job, tools: job.tools.filter((tool) => tool !== 'ladder') };
          if (language !== 'en' && (job.title.trim().toLocaleLowerCase() === job.titleEnglish.trim().toLocaleLowerCase() || job.summary.trim().toLocaleLowerCase() === job.summaryEnglish.trim().toLocaleLowerCase())) {
            // The model answered in English; translate the person-facing text on the device.
            try {
              const [title, summary] = await Promise.all([job.title, job.summary].map((value) => bounded(() => native.translate({ text: value, from: 'en', to: language }))));
              if (record(title) && typeof title.text === 'string' && title.text.trim() && record(summary) && typeof summary.text === 'string' && summary.text.trim())
                job = { ...job, title: title.text.trim().slice(0, 120), summary: summary.text.trim().slice(0, 600) };
            } catch { /* Keep the English wording; the person reviews it before posting. */ }
          }
          // The person's own words about timing are kept with the request.
          if (when && !job.summary.toLocaleLowerCase().includes(when.toLocaleLowerCase()))
            job = { ...job, summary: `${job.summary} ${assistantFollowupCopy[language].labels.timing}: ${when}.`, summaryEnglish: language === 'en' ? `${job.summaryEnglish} Timing: ${when}.` : job.summaryEnglish };
          const review = conversation.pending?.field === 'review' ? conversation.pending : { field: 'review' as const, id: `review-${users.at(-1)?.id ?? turns.length}` };
          return reply({ ...conversation, status: 'ready', job, pending: review, originalText: all, text: assistantConversationCopy[language].ready }, 'apple-on-device');
        } catch { /* Fall back to the on-device dialogue checks and task rules below. */ }
      }
      if (isNative()) return nativeDialogue(turns, language, async request => {
        let cancelledBeforeStart = false;
        const cancelled = new Promise<never>((_, reject) => { conversations.set(request.revision, error => { cancelledBeforeStart = true; reject(error); }); });
        try { return await bounded(() => { if (cancelledBeforeStart) throw new Error('Conversation cancelled.'); return native.chat({ language, request }); }, cancelled); }
        catch (error) { cancelNativeConversation(request.revision); throw error; }
        finally { conversations.delete(request.revision); }
      }, _context.retry);
      const state = resolveConversation(turns, language, rules);
      return { text: state.text, job: state.job, engine: 'rules', conversation: state, ...(state.job ? { originalText: state.originalText } : {}) };
    },
    cancelConversation() {
      for (const reject of conversations.values()) reject(new Error('Conversation cancelled.'));
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
