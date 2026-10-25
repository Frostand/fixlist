import type { ChatTurn, JobAnalysis, Language } from '../community/types';
import { analyzeTaskWithRules, clearRuleTask, ruleFollowup, ruleUrgency } from '../community/task-rules';
import { assistantConversationCopy as copy, assistantFollowupCopy as followup } from './assistant-copy';

export type ConversationField = 'task' | 'object' | 'outcome' | 'location' | 'destination' | 'quantity' | 'timing' | 'access' | 'correction' | 'review';
export interface Evidence { turnId: string; start: number; end: number; quote: string }
export interface UserFact extends Evidence { value: string; turn: number; source: 'rules' | 'native' }
export const TASK_SEEDS = { plants: 'Water plants', moving: 'Move furniture', tech: 'Help with phone', groceries: 'Pick up groceries', 'carry-groceries': 'Pick up groceries', bulb: 'Replace a bulb', alarm: 'Check smoke alarm', 'grab-bar': 'Install grab bar', rug: 'Secure rug', 'night-light': 'Install night lights', clutter: 'Clear walkway', plumbing: 'Fix leaking tap', company: 'Help with companionship', yard: 'Help in the yard' } as const;
export type ConversationTaskKind = keyof typeof TASK_SEEDS;
export interface ConversationTask { kind: ConversationTaskKind; evidence: Evidence }
export interface NativeConversationPatch {
  version: 1; revision: string; questionId: string | null;
  intent: 'amend' | 'replace' | 'cancel' | 'clarify';
  task: { kind: ConversationTaskKind; evidence: Evidence } | null;
  operations: Array<{ field: keyof ResolvedFacts; op: 'set' | 'clear'; evidence: Evidence }>;
}
export interface NativeConversationRequest {
  version: 1; revision: string; questionId: string | null; language: Language;
  pendingField: ConversationField | null; task: ConversationTask | null; facts: ResolvedFacts;
  turns: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
}
export type ResolvedFacts = Partial<Record<'action' | 'object' | 'outcome' | 'location' | 'origin' | 'destination' | 'quantity' | 'timing' | 'access', UserFact>>;
export interface PendingQuestion { field: ConversationField; id: string }
export interface ConversationState {
  task: ConversationTask | null;
  revision: string;
  status: 'collecting' | 'ready' | 'blocked' | 'cancelled';
  pending: PendingQuestion | null;
  facts: ResolvedFacts;
  /** Only bounded, ordered user turns. Questions and derived facts never enter provenance. */
  originalText: string;
  job: JobAnalysis | null;
  text: string;
  reason?: 'context' | 'emergency';
}

const ROOM = /\b(?:living\s*room|cocina|sala|dining\s*room|bedroom|bathroom|kitchen|hallway|garage|porch|garden|yard|upstairs|downstairs)\b|厨房|廚房|客厅|客廳|부엌|거실|nhà bếp|phòng khách|kusina|кухне|гостиной|cuisine|المطبخ|غرفة المعيشة/giu;
const OBJECT = /\b(?:chairs?|sofas?|couches?|tables?|beds?|furniture|boxes|box|plants?|flowers?|groceries|phone|computer|printer|wi-?fi)\b|椅子|桌子|沙发|沙發|椅子|의자|소파|teléfono|telefono|computadora|휴대폰|컴퓨터|手机|手機|电脑|電腦|điện thoại|máy tính|telepono|телефон|компьютер|téléphone|ordinateur|الهاتف|كمبيوتر/iu;
const MOVE = /\bmov(?:e|ing)\b/iu;
const CARRY = /\bcarry(?:ing)?\b/iu;
const OUTCOME = /\b(?:make (?:the |my )?(?:text|font|letters)(?: size)? (?:larger|bigger|smaller)|(?:increase|enlarge|adjust|change) (?:the |my )?(?:text|font)(?: size)?|(?:learn (?:how )?to |help (?:me )?(?:to )?)?(?:send (?:a |an )?(?:text|message|email)|make (?:a )?(?:phone |video )?call|(?:find|organize|share) (?:my )?photos|connect (?:to )?(?:the )?(?:wi-?fi|internet)|set up (?:my |the )?(?:phone|email|printer)|use (?:my |the )?(?:phone|computer|printer)))\b/iu;
const QUANTITY = /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|all|both)\b(?=\s+(?:(?:of\s+)?(?:the|my)\s+)?(?:plants?|flowers?|chairs?|sofas?|tables?|boxes|box|bulbs?|bags?))/iu;
const ACCESS = /\b(?:use (?:the )?(?:side|front|back) (?:door|entrance)|(?:please )?(?:knock|call|ring (?:the )?(?:bell|doorbell))(?: first| before (?:you )?(?:arrive|enter))?|(?:do not|don't) ring (?:the )?(?:bell|doorbell)|no stairs|(?:there (?:are|is) )?\d{1,2} (?:stairs|steps)|(?:door|gate) (?:is )?(?:locked|unlocked)|(?:do not|don't) enter(?: (?:the )?\w+)?)/iu;
const TIMING = /\b(?:urgent|urgente|hoy|hôm nay|ngay|khẩn cấp|ngayon|agaran|сегодня|срочно|aujourd['’]hui|اليوم|عاجل|today|tomorrow|tonight|this (?:week|weekend)|next week|(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:before|after|at) \d{1,2}(?::\d\d)?\s*(?:am|pm)|no rush|not urgent|not today|whenever|flexible)\b|오늘|지금|긴급|今天|紧急|緊急/giu;
const socialKind = (text: string) => {
  const compact = text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  if (/^(?:hi|hello|hey|hola|你好|您好|안녕하세요|안녕|xinchào|chào|kumusta|здравствуйте|привет|bonjour|salut|مرحبا|مرحبًا)$/u.test(compact)) return 'greeting';
  if (/^(?:thanks|thankyou|gracias|谢谢|謝謝|감사합니다|고마워요|cảmơn|salamat|спасибо|merci|شكرا|شكرًا)$/u.test(compact)) return 'thanks';
  return null;
};
const cancellation = /^(?:cancel(?: that| this| the request)?|never mind|nevermind|forget (?:it|that)|stop|取消|취소|hủy|annuler|отмена|إلغاء)[.!\s]*$/iu;
const correction = /^(?:actually\b|no\b|not that\b|instead\b|change\b|correction\b|нет\b|不是|아니|لا\b)/iu;
const ambiguous = /\b(?:maybe|or|not that|other one)\b|或者/iu;
const yes = /^(?:yes|yeah|yep|ok|okay|sure|sí|si|oui|да|نعم|是|네)(?:[,!\s]+(?:please|post it|review it))?[.!\s]*$/iu;
const no = /^(?:no|nope|non|нет|لا|아니요|不是)[.!\s]*$/iu;
/** Phrase triage, not a safety assessment. Always runs before ordinary task parsing. */
export function emergencyInput(text: string): boolean {
  const value = text.replace(/\b(?:no (?:smoke|fire|gas leak)|not (?:a fire|an emergency)|(?:smoke|fire) alarm|carbon monoxide (?:alarm|detector|sensor)(?: battery)?)\b/giu, ' ');
  return /\b(?:smell(?:ing)? gas|gas leak|(?:there is|there's|active) (?:a )?fire|(?:house|kitchen|room) (?:is )?(?:on fire|filling with smoke)|(?:i (?:see|smell)|there is|there's) smoke|carbon monoxide(?: poisoning| leak| detected)|can't breathe|cannot breathe|chest pain|unconscious|bleeding heavily|fell and (?:can't|cannot) get up)\b|huele a gas|fuga de gas|no puedo respirar|incendio|煤气泄漏|煤氣洩漏|着火了|无法呼吸|가스 냄새|불이 났|숨을 쉴 수|rò rỉ khí|khó thở|fuite de gaz|не могу дышать|утечка газа|تسرب غاز|لا أستطيع التنفس/iu.test(value);
}
/** Keep the established total-turn and user-character limits; never clip a correction. */
export function conversationWindow(turns: readonly ChatTurn[]): ChatTurn[] | null {
  const recent = turns.slice(-12);
  if (!recent.length || recent.at(-1)?.role !== 'user' || recent.some(t => !['user', 'assistant'].includes(t.role) || typeof t.text !== 'string' || !t.text.trim() || t.text.length > 4000)) return null;
  const identified = recent.map((t, i) => ({ ...t, id: t.id ?? `legacy-${i}-${hash(t.text)}` }));
  return identified.filter(t => t.role === 'user').map(t => t.text).join('\n').length <= 4000 && new Set(identified.map(t => t.id)).size === identified.length && identified.every(t => /^[a-zA-Z0-9:_-]{1,100}$/u.test(t.id)) ? identified : null;
}
function fieldHint(text: string, moving: boolean): ConversationField {
  if (ROOM.test(text)) { ROOM.lastIndex = 0; return moving ? 'destination' : 'location'; }
  ROOM.lastIndex = 0;
  if (/\b(?:time|today|tomorrow|urgent|rush|when|week|am|pm)\b/iu.test(text)) return 'timing';
  if (/\b(?:quantity|how many|\d+|one|two|three|all)\b/iu.test(text)) return 'quantity';
  if (/\b(?:door|access|stairs|knock|bell)\b/iu.test(text)) return 'access';
  return 'correction';
}
function pending(field: ConversationField, turn: number | string): PendingQuestion { return { field, id: `${turn}:${field}` }; }
function question(field: ConversationField, language: Language): string {
  return field === 'task' ? copy[language].question : followup[language].questions[field];
}
function draft(base: JobAnalysis, facts: ResolvedFacts, language: Language): JobAnalysis {
  const keys = ['object', 'outcome', 'quantity', 'origin', 'destination', 'location', 'timing', 'access'] as const;
  const details = (lang: Language) => keys.flatMap(key => facts[key] ? [`${followup[lang].labels[key]}: ${facts[key]!.value}`] : []).join('; ');
  const english = details('en'), local = details(language);
  return { ...base, engine: Object.values(facts).some(f => f.source === 'native') ? 'apple-on-device' : 'rules', urgency: ruleUrgency(facts.timing?.value ?? '') ?? 'this-week',
    summaryEnglish: `${base.summaryEnglish}${english ? ` ${english}.` : ''}`,
    summary: `${base.summary}${local ? ` ${local}.` : ''}` };
}

/** Replay a bounded transient reducer. Assistant words are never parsed, even as suggestions.
 * Every accepted detail is a literal span of a user turn; only deterministic classification
 * and question identity are derived. Replaying makes native -> rules fallback lossless. */
export function resolveConversation(turns: readonly ChatTurn[], language: Language, rules = analyzeTaskWithRules): ConversationState {
  const recent = conversationWindow(turns);
  return recent ? reduceWindow(recent, language, rules) : { task: null, revision: '', status: 'blocked', pending: null, facts: {}, originalText: '', job: null, text: followup[language].context, reason: 'context' };
}
function reduceWindow(recent: readonly ChatTurn[], language: Language, rules: typeof analyzeTaskWithRules): ConversationState {
  const strings = followup[language];
  const originalText = recent.filter(t => t.role === 'user').map(t => t.text).join('\n');
  let state: ConversationState = { task: null, revision: '', status: 'collecting', pending: pending('task', 0), facts: {}, originalText, job: null, text: copy[language].question };
  let base: JobAnalysis | null = null, moving = false, tech = false;
  for (const [index, turn] of recent.entries()) {
    if (turn.role !== 'user') continue;
    const text = turn.text.trim(), turnId = turn.id!;
    const before = structuredClone(state), request = extractionRequest(before, recent.slice(0, index + 1), language);
    const fact = (value: string): UserFact => ({ value, turn: index, source: 'rules', turnId, start: turn.text.indexOf(value), end: turn.text.indexOf(value) + value.length, quote: value });
    const ask = (field: ConversationField, prefix = '') => {
      state = { ...state, status: 'collecting', pending: pending(field, turnId), job: null, text: `${prefix}${question(field, language)}` };
    };
    try {
      if (emergencyInput(text)) { state = { ...state, status: 'blocked', pending: null, job: null, reason: 'emergency', text: strings.emergency }; continue; }
      if (cancellation.test(text)) {
        base = null; moving = tech = false;
        state = { task: null, revision: request.revision, status: 'cancelled', pending: null, facts: {}, originalText, job: null, text: strings.cancelled }; continue;
      }
      if (state.status === 'blocked') {
        if (!/not (?:an? )?emergency|no (?:gas leak|smoke|fire)/iu.test(text)) continue;
        if (!clearRuleTask(text.replace(/not (?:an? )?emergency[;,!.]?\s*/giu, ''))) { ask('task'); continue; }
        state = { ...state, status: 'collecting' }; delete state.reason;
      }
      const social = socialKind(text);
      if (social) {
        if (!base) state = { ...state, status: 'collecting', pending: pending('task', turnId), text: copy[language][social] };
        else if (state.status === 'collecting') state = { ...state, text: question(state.pending!.field, language) };
        else state = { ...state, text: copy[language].detail };
        continue;
      }
      if (yes.test(text) || no.test(text)) {
        if (state.pending?.field === 'review' && yes.test(text)) state = { ...state, text: copy[language].detail };
        else ask(state.pending?.field === 'review' ? 'correction' : state.pending?.field ?? 'task');
        continue;
      }
      // Never take alternatives, negated tasks or instructions as resolved details.
      const unsafeInstruction = /ignore.{0,40}instructions|system\s*[:>]|automatically/iu.test(text);
      const negatedTask = negatedActionInput(text);
      if (ambiguous.test(text) || contradictory(text) || unsafeInstruction || negatedTask || /^no[,\s]+not\b/iu.test(text)) {
        ask(base ? (negatedTask && state.pending?.field !== 'review' ? state.pending?.field ?? 'task' : fieldHint(text, moving)) : 'task', base ? strings.unsupported : ''); continue;
      }
      const movement = MOVE.test(text) || CARRY.test(text), objectMention = text.match(OBJECT)?.[0];
      const carryGroceries = movement && /\bgroceries\b/iu.test(text);
      const hasMove = movement && (!objectMention || /^(?:chairs?|sofas?|couches?|tables?|beds?|furniture|box|boxes)$/iu.test(objectMention));
      if (movement && objectMention && !hasMove && !carryGroceries) { ask('task', strings.unsupported); continue; }
      const taskText = text.replace(/\b(?:no gas leak|not (?:an? )?emergency)[;,!.]?\s*/giu, '');
      const isTask = clearRuleTask(taskText) || hasMove || carryGroceries;
      let changed = false, reply: 'ready' | 'updated' | 'detail' | 'timing' = base ? 'detail' : 'ready';
      if (isTask) {
        const kind = carryGroceries ? 'carry-groceries' : hasMove ? 'moving' : taskKind(rules(text, language));
        const replace = !state.task || state.task.kind !== kind || explicitReplacement(text);
        if (!kind) { ask('task'); continue; }
        const candidate = taskAnalysis(kind, language, rules);
        base = candidate; moving = kind === 'moving'; tech = kind === 'tech';
        state = { ...state, task: { kind, evidence: evidenceOf(fact(text)) }, facts: replace ? {} : { ...state.facts } };
        delete state.reason; changed = true;
        reply = before.task ? 'updated' : 'ready';
        const action = text.match(/\b(?:water|replace|change|move|moving|carry|carrying|install|secure|remove|clear|pick up|check|fix|repair|help)\b/iu)?.[0];
        if (action) state.facts.action = fact(action);
        const object = text.match(OBJECT)?.[0];
        if (object) { if (state.facts.object && singular(state.facts.object.value) !== singular(object)) delete state.facts.quantity; state.facts.object = fact(object); }
      }
      if (!base) { ask('task'); continue; }
      const facts = { ...state.facts };
      const rooms = [...text.matchAll(ROOM)].map(m => m[0]);
      if (rooms.length) {
        if (moving) {
          if (rooms.length === 2 && /\bto\b|→/iu.test(text)) { facts.origin = fact(rooms[0]!); facts.destination = fact(rooms[1]!); }
          else if (rooms.length === 1 && ((/\bfrom\b/iu.test(text) && !/\bto\b/iu.test(text)) || /(?:房|厅|廳|厨房|廚房)的/u.test(text))) facts.origin = fact(rooms[0]!);
          else if (rooms.length === 1) facts.destination = fact(rooms[0]!);
          else { ask('destination', strings.unsupported); continue; }
        } else if (rooms.length === 1) facts.location = fact(rooms[0]!);
        else { ask('location', strings.unsupported); continue; }
        changed = true;
      }
      const quantity = text.match(QUANTITY)?.[0] ?? (state.pending?.field === 'quantity' ? text.match(/^(?:\d{1,3}|one|two|three|four|five|all|both)$/iu)?.[0] : undefined);
      if (quantity) { facts.quantity = fact(quantity); changed = true; }
      const access = text.match(ACCESS)?.[0];
      if (access) { facts.access = fact(access); changed = true; }
      const timings = [...text.matchAll(TIMING)].map(m => m[0]);
      const localTiming = ruleFollowup(text) === 'timing' ? text.replace(/^actually[,\s]*/iu, '') : undefined;
      if (timings.length || localTiming) {
        // Multiple compatible time constraints are kept verbatim, never an appointment.
        const timingSpan = text.slice(text.indexOf(timings[0] ?? ''), text.lastIndexOf(timings.at(-1) ?? '') + (timings.at(-1)?.length ?? 0));
        const nonTiming = timingSpan.replace(TIMING, '').replace(/\b(?:and|but|please)\b|[\p{P}\s]/giu, '');
        if (!localTiming && nonTiming) { ask('timing', strings.unsupported); continue; }
        facts.timing = fact(localTiming ?? timingSpan); changed = true;
        if (!isTask) reply = 'timing';
      }
      if (moving && !isTask && (state.pending?.field === 'object' || correction.test(text))) {
        const object = text.match(OBJECT)?.[0];
        if (object && !/phone|computer|plants?|flowers?/iu.test(object)) {
          if (facts.object && singular(facts.object.value) !== singular(object) && facts.quantity?.turnId !== turnId) delete facts.quantity;
          facts.object = fact(object); changed = true;
        }
      }
      if (tech) {
        const outcome = text.match(OUTCOME)?.[0];
        if (outcome) { facts.outcome = fact(outcome); changed = true; }
      }
      if (!isTask && changed && !ruleFollowup(text)) {
        // A recognized word inside an otherwise unsupported answer is not consent
        // to silently discard the remainder (or to attach it to the old task).
        const spans = [...rooms, ...timings, quantity, access, localTiming, text.match(OBJECT)?.[0], tech ? text.match(OUTCOME)?.[0] : undefined]
          .filter((value): value is string => !!value).sort((a, b) => b.length - a.length);
        let remainder = text;
        for (const span of spans) remainder = remainder.split(span).join(' ');
        remainder = remainder.replace(/^no,\s*/iu, '').replace(/\b(?:actually|please|instead|in|the|a|an|my|from|to|and|but|it|is|at|on)\b|[\p{P}\s]/giu, '');
        if (remainder) { ask(state.pending?.field === 'review' ? 'correction' : state.pending?.field ?? 'task', strings.unsupported); continue; }
      }
      // Unsupported answers retain all previously resolved facts and the exact pending field.
      if (!changed) { ask(state.pending?.field === 'review' ? 'correction' : state.pending?.field ?? 'correction', strings.unsupported); continue; }
      state = { ...state, facts };
      if (moving && !facts.object) ask('object');
      else if (moving && !facts.destination) ask('destination');
      else if (tech && !facts.outcome) ask('outcome');
      else state = { ...state, status: 'ready', pending: pending('review', turnId), job: draft(base, facts, language), text: copy[language][reply] };
    } finally {
      state.revision = request.revision;
      const metadata = recent[index + 1]?.role === 'assistant' ? recent[index + 1]?.extraction : undefined;
      if (metadata && state.status !== 'blocked' && state.status !== 'cancelled') {
        const applied = applyNativeExtraction(before, request, metadata, language, rules, state);
        if (applied) state = applied.state;
      }
      base = state.task ? taskAnalysis(state.task.kind, language, rules) : null;
      moving = state.task?.kind === 'moving'; tech = state.task?.kind === 'tech';
    }
  }
  return { ...state, originalText };
}

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(36);
}
const singular = (value: string) => value.toLocaleLowerCase().replace(/s$/u, '');
const evidenceOf = ({ turnId, start, end, quote }: Evidence): Evidence => ({ turnId, start, end, quote });
export function negatedActionInput(text: string): boolean {
  return /\b(?:do not|don't|don’t|never|not to|no need(?: to)?|no longer (?:want|need)|no quiero|no necesito)(?:\s+[\p{L}’']+){0,5}?\s+(?:water|move|moving|install|replace|help|fix|make|increase|enlarge|adjust|change|send|connect|set up|use|carry|mover|regar|aumentar)\b|不要|하지\s*마/iu.test(text);
}
function explicitReplacement(text: string): boolean { return /\b(?:new request|start over|different request|replace (?:this|that|the) request|forget (?:this|that)[,;])\b/iu.test(text); }
function taskKind(job: JobAnalysis): ConversationTaskKind | null {
  const byTitle: Record<string, ConversationTaskKind> = { 'Water the plants': 'plants', 'Move furniture': 'moving', 'Help with a phone or computer': 'tech', 'Pick up groceries': 'groceries', 'Replace a light bulb': 'bulb', 'Check a smoke alarm': 'alarm', 'Install a grab bar': 'grab-bar', 'Secure or remove a loose rug': 'rug', 'Install night lights': 'night-light', 'Clear a walkway': 'clutter', 'Review a leaking tap': 'plumbing', 'Spend some time together': 'company', 'Help in the yard': 'yard' };
  return byTitle[job.titleEnglish] ?? null;
}
function taskAnalysis(kind: ConversationTaskKind, language: Language, rules: typeof analyzeTaskWithRules): JobAnalysis {
  const base = rules(TASK_SEEDS[kind], language);
  if (kind !== 'carry-groceries') return { ...base, urgency: 'this-week' };
  const titles: Record<Language, string> = { en: 'Help carry groceries', es: 'Ayuda para llevar la compra', zh: '帮忙搬运食品', ko: '장본 물건 나르기', vi: 'Giúp mang thực phẩm', tl: 'Tulong sa pagdadala ng pinamili', ru: 'Помочь донести продукты', fr: 'Aider à porter les courses', ar: 'المساعدة في حمل البقالة' };
  return { ...base, title: titles[language], titleEnglish: titles.en, summary: language === 'en' ? 'Help carry groceries.' : titles[language] + '.', summaryEnglish: 'Help carry groceries.', category: 'household', tools: [], skills: ['general'], peopleNeeded: 1, estimatedMinutes: 20, safetyNotes: ['Carry manageable loads and keep the path clear.'] };
}
function extractionRequest(before: ConversationState, turns: readonly ChatTurn[], language: Language): NativeConversationRequest {
  const facts = Object.fromEntries(Object.entries(before.facts).map(([field, f]) => [field, { value: f.value, ...evidenceOf(f), source: f.source }]));
  const revision = `${turns.at(-1)!.id}:${hash(JSON.stringify({ language, task: before.task, facts, pending: before.pending }))}`;
  return { version: 1, revision, questionId: before.pending?.id ?? null, language, pendingField: before.pending?.field ?? null,
    task: before.task, facts: structuredClone(before.facts), turns: turns.map(t => ({ id: t.id!, role: t.role, text: t.text })) };
}
export function prepareConversation(turns: readonly ChatTurn[], language: Language, rules = analyzeTaskWithRules) {
  const recent = conversationWindow(turns);
  if (!recent) return null;
  const before = reduceWindow(recent.slice(0, -1), language, rules);
  return { before, request: extractionRequest(before, recent, language), fallback: reduceWindow(recent, language, rules) };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function validEvidence(v: unknown, request: NativeConversationRequest): v is Evidence {
  if (!shape(v, ['turnId', 'start', 'end', 'quote']) || typeof v.turnId !== 'string' || typeof v.quote !== 'string'
    || !v.quote.trim() || v.quote.length > 500 || !Number.isInteger(v.start) || !Number.isInteger(v.end)) return false;
  const user = request.turns.at(-1)!;
  return user.role === 'user' && user.id === v.turnId && (v.start as number) >= 0 && (v.end as number) > (v.start as number)
    && (v.end as number) <= user.text.length && user.text.slice(v.start as number, v.end as number) === v.quote;
}
function contradictory(text: string) { return /\b(?:larger|bigger|aumentar)\b.*\b(?:smaller|disminuir)\b|\b(?:smaller|disminuir)\b.*\b(?:larger|bigger|aumentar)\b/iu.test(text); }
function negatedEvidence(text: string, span: Evidence): boolean {
  // Exact quoting is insufficient when a selected option is negated just outside
  // the quote. Keep this conservative: ask rather than choose the opposite option.
  const prefix = text.slice(0, span.start).split(/[.!?;,\n]/u).at(-1)!;
  const suffix = text.slice(span.end).split(/[.!?;,\n]/u)[0]!;
  return /\b(?:not|never|neither|without|don't|don’t|no)\b/iu.test(prefix)
    || /^\s*(?:(?:is|are|was|were|would be)\s+)?(?:not|never|no)\b/iu.test(suffix);
}
function clarification(state: ConversationState, language: Language, turnId: string): ConversationState {
  const field = state.pending?.field === 'review' ? 'correction' : state.pending?.field ?? 'task';
  return { ...state, status: 'collecting', job: null, pending: pending(field, turnId), text: question(field, language) };
}
export function clarificationPatch(request: NativeConversationRequest): NativeConversationPatch {
  return { version: 1, revision: request.revision, questionId: request.questionId, intent: 'clarify', task: null, operations: [] };
}
/** A model interprets only typed fields. It cannot provide prose, readiness, a job,
 * tools, urgency enums, or posting authority. All evidence must be in the latest
 * bound user turn; existing facts carry their original user evidence separately. */
export function applyNativeExtraction(before: ConversationState, request: NativeConversationRequest, value: unknown, language: Language, rules = analyzeTaskWithRules, fallback = before): { state: ConversationState; patch: NativeConversationPatch; useful: boolean } | null {
  if (!shape(value, ['version', 'revision', 'questionId', 'intent', 'task', 'operations']) || value.version !== 1
    || value.revision !== request.revision || value.questionId !== request.questionId
    || !['amend', 'replace', 'cancel', 'clarify'].includes(value.intent as string) || !Array.isArray(value.operations) || value.operations.length > 9) return null;
  const user = request.turns.at(-1)!, text = user.text;
  const fields = ['action', 'object', 'outcome', 'location', 'origin', 'destination', 'quantity', 'timing', 'access'];
  if (ambiguous.test(text) || contradictory(text) || negatedActionInput(text) || emergencyInput(text) || /ignore.{0,40}instructions|system\s*[:>]|automatically/iu.test(text)) return null;
  if (value.task !== null && (!shape(value.task, ['kind', 'evidence']) || !Object.hasOwn(TASK_SEEDS, value.task.kind as string) || !validEvidence(value.task.evidence, request))) return null;
  const seen = new Set<string>();
  for (const op of value.operations) {
    if (!shape(op, ['field', 'op', 'evidence']) || !fields.includes(op.field as string) || seen.has(op.field as string)
      || !['set', 'clear'].includes(op.op as string) || !validEvidence(op.evidence, request)) return null;
    seen.add(op.field as string);
    if (op.op === 'set' && (yes.test(op.evidence.quote) || no.test(op.evidence.quote) || socialKind(op.evidence.quote) || ambiguous.test(op.evidence.quote) || contradictory(op.evidence.quote) || negatedEvidence(text, op.evidence))) return null;
    if (op.op === 'set') {
      const limits: Record<string, number> = { action: 80, object: 160, outcome: 500, location: 100, origin: 100, destination: 100, quantity: 40, timing: 160, access: 160 };
      if (op.evidence.quote.length > limits[op.field as string]!) return null;
      if (op.field === 'quantity' && /^\d+$/u.test(op.evidence.quote) && (+op.evidence.quote < 1 || +op.evidence.quote > 999)) return null;
    }
    if (op.op === 'clear') {
      const aliases: Record<string, RegExp> = { action: /action|task/iu, object: /object|item/iu, outcome: /outcome|requested help/iu, location: /location|room/iu, origin: /origin|from/iu, destination: /destination/iu, quantity: /quantity|count/iu, timing: /timing|time/iu, access: /access|entry/iu };
      if (!/\b(?:clear|remove|forget|unspecified|no preference|quitar|eliminar)\b|不限|取消/iu.test(op.evidence.quote)
        || !aliases[op.field as string]!.test(op.evidence.quote)) return null;
    }
  }
  const patch = structuredClone(value) as unknown as NativeConversationPatch;
  const raw = request.turns.filter(t => t.role === 'user').map(t => t.text).join('\n');
  let state = { ...structuredClone(before), originalText: raw, revision: request.revision };
  if (patch.intent === 'clarify') {
    if (patch.task || patch.operations.length) return null;
    return { state: clarification({ ...fallback, revision: request.revision, originalText: raw }, language, user.id), patch, useful: false };
  }
  if (patch.intent === 'cancel') {
    if (!cancellation.test(text.trim()) || patch.task || patch.operations.length) return null;
    return { state: { ...state, task: null, status: 'cancelled', pending: null, facts: {}, job: null, text: followup[language].cancelled }, patch, useful: true };
  }
  if (patch.intent === 'replace') {
    if (!patch.task || (before.task?.kind === patch.task.kind && !explicitReplacement(text))) return null;
    state.facts = {}; state.task = patch.task;
  } else if (patch.task) {
    if (before.task && before.task.kind !== patch.task.kind) return null;
    state.task = patch.task;
  }
  if (!state.task || !patch.operations.length) return null;
  if (fallback.task?.kind === state.task.kind) {
    // Rules may already have resolved other fields in this same answer. Native
    // extraction is a partial patch, not permission to roll those corrections back.
    state.facts = structuredClone(patch.intent === 'replace'
      ? Object.fromEntries(Object.entries(fallback.facts).filter(([, fact]) => fact.turnId === user.id))
      : fallback.facts);
    state.task = fallback.task;
  } else if (fallback.task?.evidence.turnId === user.id) return null;
  let useful = JSON.stringify(state.task) !== JSON.stringify(before.task);
  for (const op of patch.operations) {
    const current = state.facts[op.field];
    if (current?.turnId === user.id && (op.op === 'clear' || current.value.trim().toLocaleLowerCase() !== op.evidence.quote.trim().toLocaleLowerCase())) return null;
    if (op.op === 'clear') { useful ||= !!state.facts[op.field]; delete state.facts[op.field]; if (op.field === 'action') state.task = null; continue; }
    if (op.field === 'outcome' && (state.task?.kind !== 'tech' || op.evidence.quote.trim().length < 2 || ROOM.test(op.evidence.quote))) { ROOM.lastIndex = 0; return null; }
    ROOM.lastIndex = 0;
    if (op.field === 'object' && state.task?.kind === 'moving' && /groceries|phone|computer|plants|teléfono/iu.test(op.evidence.quote)) return null;
    if (op.field === 'object' && state.facts.object && singular(state.facts.object.value) !== singular(op.evidence.quote) && state.facts.quantity?.turnId !== user.id) delete state.facts.quantity;
    useful ||= state.facts[op.field]?.value !== op.evidence.quote;
    state.facts[op.field] = { ...op.evidence, value: op.evidence.quote, turn: request.turns.length - 1, source: 'native' };
  }
  if (!state.task) return { state: { ...state, status: 'collecting', job: null, pending: pending('task', user.id), text: question('task', language) }, patch, useful };
  const missing = state.task.kind === 'moving' && !state.facts.object ? 'object' : state.task.kind === 'moving' && !state.facts.destination ? 'destination' : state.task.kind === 'tech' && !state.facts.outcome ? 'outcome' : null;
  state = missing ? { ...state, status: 'collecting', pending: pending(missing, user.id), job: null, text: question(missing, language) }
    : { ...state, status: 'ready', pending: pending('review', user.id), job: draft(taskAnalysis(state.task.kind, language, rules), state.facts, language), text: copy[language].updated };
  return { state, patch, useful };
}
