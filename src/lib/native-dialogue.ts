import type { AssistantReply, ChatTurn, Language } from '../community/types';
import { analyzeTaskWithRules } from '../community/task-rules';
import { assistantFollowupCopy } from './assistant-copy';
import { ambiguousInput, cancellationInput, draft, emergencyInput, negatedActionInput, negatedEvidence, unsupportedInstructionInput, TASK_SEEDS, taskAnalysis, type ConversationField, type ConversationState, type Evidence, type ResolvedFacts, type UserFact } from './assistant-conversation';

export const DIALOGUE_LIMITS = { evidenceCharacters: 4000, userTurns: 64, recentTurns: 12, superseded: 64, requestCharacters: 30000 } as const;
const fields = ['action', 'object', 'outcome', 'location', 'origin', 'destination', 'quantity', 'timing', 'access'] as const;
type Field = typeof fields[number];
type UserTurn = { id: string; role: 'user'; text: string };
export interface DialogueLedger {
  version: 2; language: Language; state: ConversationState; users: UserTurn[];
  superseded: Array<{ field: Field; fact: UserFact }>;
  disputed: Partial<Record<Field, Evidence>>;
  asked: Partial<Record<ConversationField, number>>; declined: ConversationField[];
  failed: boolean; exhausted: boolean;
  unprocessed: string[];
}
/** Host-owned checkpoint, never inferred from assistant prose or accepted from a bridge. */
const checkpoints = new WeakSet<DialogueLedger>();
export interface NativeDialogueRequest {
  version: 2; revision: string; language: Language;
  task: ConversationState['task']; facts: ResolvedFacts;
  disputed: DialogueLedger['disputed']; superseded: DialogueLedger['superseded'];
  asked: DialogueLedger['asked']; declined: ConversationField[];
  pendingField: ConversationField | null; questionId: string | null;
  evidenceTurns: UserTurn[];
  turns: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
}
export interface DialogueResult {
  version: 2; revision: string; reply: string;
  proposal: null | {
    intent: 'amend' | 'replace' | 'cancel';
    task: keyof typeof TASK_SEEDS | null; quote: string;
    changes: Array<{ field: Field; op: 'set' | 'hold' | 'clear'; quote: string }>;
  };
  question: ConversationField | null; declined: ConversationField[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const questionFields: readonly string[] = ['task', 'object', 'outcome', 'location', 'destination', 'quantity', 'timing', 'access', 'correction', 'review'];
const isQuestion = (v: unknown): v is ConversationField => typeof v === 'string' && questionFields.includes(v);
const checkpoint = (ledger: DialogueLedger) => { checkpoints.add(ledger); return ledger; };
export const dialogueCopy: Record<Language, { failure: string; manual: string; retry: string; limit: string; manualAction: string }> = {
  en: { manualAction: 'Edit and review manually', failure: 'On-device conversation could not finish. Your words and draft are kept. Choose Retry, edit the draft, or come back later.', manual: 'You can edit the draft directly or leave this detail for later.', retry: 'Retry conversation', limit: 'This conversation has reached its evidence limit. Your accepted details are kept. Start a new request to continue.' },
  es: { manualAction: 'Editar y revisar manualmente', failure: 'No se pudo completar la conversación en el dispositivo. Se conservan tus palabras y el borrador. Reintenta, edita el borrador o vuelve más tarde.', manual: 'Puedes editar el borrador directamente o dejar este detalle para más tarde.', retry: 'Reintentar conversación', limit: 'La conversación alcanzó su límite. Se conservan los detalles aceptados. Inicia una solicitud nueva para continuar.' },
  zh: { manualAction: '手动编辑并检查', failure: '设备上的对话未能完成。你的话和草稿已保留。可以重试、编辑草稿或稍后回来。', manual: '你可以直接编辑草稿，或稍后再补充这个细节。', retry: '重试对话', limit: '对话已达到内容上限。已保留确认的细节。请开始新的请求以继续。' },
  ko: { manualAction: '직접 수정하고 검토하기', failure: '기기 내 대화를 완료하지 못했어요. 말씀과 초안은 보관되어 있어요. 다시 시도하거나 초안을 수정하거나 나중에 돌아오세요.', manual: '초안을 직접 수정하거나 이 내용은 나중에 정할 수 있어요.', retry: '대화 다시 시도', limit: '대화 내용 한도에 도달했어요. 확인된 내용은 보관되어 있어요. 계속하려면 새 요청을 시작하세요.' },
  vi: { manualAction: 'Tự sửa và xem lại', failure: 'Không thể hoàn tất cuộc trò chuyện trên thiết bị. Lời nói và bản nháp được giữ lại. Hãy thử lại, sửa bản nháp hoặc quay lại sau.', manual: 'Bạn có thể sửa bản nháp trực tiếp hoặc để chi tiết này lại sau.', retry: 'Thử lại cuộc trò chuyện', limit: 'Cuộc trò chuyện đã đạt giới hạn nội dung. Các chi tiết đã xác nhận được giữ lại. Hãy bắt đầu yêu cầu mới để tiếp tục.' },
  tl: { manualAction: 'Manu-manong i-edit at suriin', failure: 'Hindi natapos ang pag-uusap sa device. Nananatili ang mga sinabi mo at ang draft. Subukang muli, i-edit ang draft, o bumalik mamaya.', manual: 'Maaari mong direktang i-edit ang draft o balikan ang detalyeng ito mamaya.', retry: 'Subukang muli ang pag-uusap', limit: 'Naabot na ang limitasyon ng pag-uusap. Nananatili ang tinanggap na detalye. Magsimula ng bagong kahilingan para magpatuloy.' },
  ru: { manualAction: 'Изменить и проверить вручную', failure: 'Не удалось завершить разговор на устройстве. Ваши слова и черновик сохранены. Повторите попытку, измените черновик или вернитесь позже.', manual: 'Можно изменить черновик вручную или уточнить эту деталь позже.', retry: 'Повторить разговор', limit: 'Достигнут предел объёма разговора. Принятые детали сохранены. Начните новый запрос, чтобы продолжить.' },
  fr: { manualAction: 'Modifier et relire manuellement', failure: 'La conversation sur cet appareil n’a pas pu aboutir. Vos mots et le brouillon sont conservés. Réessayez, modifiez le brouillon ou revenez plus tard.', manual: 'Vous pouvez modifier le brouillon directement ou préciser ce détail plus tard.', retry: 'Réessayer la conversation', limit: 'Cette conversation a atteint sa limite. Les détails acceptés sont conservés. Commencez une nouvelle demande pour continuer.' },
  ar: { manualAction: 'التعديل والمراجعة يدويًا', failure: 'تعذّر إكمال المحادثة على الجهاز. تم الاحتفاظ بكلماتك والمسودة. أعد المحاولة أو عدّل المسودة أو عُد لاحقًا.', manual: 'يمكنك تعديل المسودة مباشرة أو ترك هذه التفاصيل لوقت لاحق.', retry: 'إعادة محاولة المحادثة', limit: 'وصلت المحادثة إلى حد المحتوى. تم الاحتفاظ بالتفاصيل المقبولة. ابدأ طلبًا جديدًا للمتابعة.' },
};
function initial(language: Language): DialogueLedger {
  return { version: 2, language, users: [], superseded: [], disputed: {}, asked: {}, declined: [], failed: false, exhausted: false, unprocessed: [],
    state: { task: null, revision: '', status: 'collecting', pending: null, facts: {}, originalText: '', job: null, text: '' } };
}
function evidence(user: UserTurn, quote: unknown): Evidence | null {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 500) return null;
  const start = user.text.indexOf(quote);
  // Ambiguous repeated spans must be quoted with enough context to identify them.
  return start < 0 || user.text.indexOf(quote, start + 1) >= 0 ? null : { turnId: user.id, start, end: start + quote.length, quote };
}
function response(ledger: DialogueLedger, text: string, engine: AssistantReply['engine'] = 'rules'): AssistantReply {
  ledger.state.text = text;
  return { text, job: ledger.exhausted ? null : ledger.state.job, engine, originalText: ledger.state.originalText,
    conversation: ledger.state, dialogue: checkpoint(ledger), retryable: ledger.failed && !ledger.exhausted,
    requiresResolution: ledger.failed || ledger.exhausted || ledger.state.status !== 'ready' };
}
export async function nativeDialogue(turns: readonly ChatTurn[], language: Language, call: (request: NativeDialogueRequest) => Promise<unknown>, retry = false): Promise<AssistantReply> {
  const known = [...turns].reverse().find(t => t.dialogue && checkpoints.has(t.dialogue) && t.dialogue.language === language)?.dialogue;
  let ledger = known ? structuredClone(known) : initial(language);
  const raw = retry && ledger.unprocessed.length ? turns.find(t => t.id === ledger.unprocessed[0]) : [...turns].reverse().find(t => t.role === 'user');
  const user: UserTurn = retry && ledger.unprocessed.length ? ledger.users.find(t => t.id === ledger.unprocessed[0])! : { id: raw?.id ?? crypto.randomUUID(), role: 'user', text: raw?.text ?? '' };
  const already = ledger.users.some(t => t.id === user.id);
  if ((!retry && already) || !user.text.trim()) return response(ledger, '');
  if (ledger.exhausted) return response(ledger, '');
  if (!already) {
    if (ledger.users.length >= DIALOGUE_LIMITS.userTurns || [...ledger.users, user].map(t => t.text).join('\n').length > DIALOGUE_LIMITS.evidenceCharacters) {
      ledger.exhausted = true; ledger.state.status = 'blocked'; ledger.state.reason = 'context';
      return response(ledger, dialogueCopy[language].limit);
    }
    ledger.users.push(user);
  }
  ledger.state.originalText = ledger.users.map(t => t.text).join('\n');
  ledger.state.revision = `${user.id}:${crypto.randomUUID()}`;
  if (emergencyInput(user.text)) {
    ledger.state = { ...ledger.state, status: 'blocked', reason: 'emergency', job: null, pending: null };
    return response(ledger, assistantFollowupCopy[language].emergency);
  }
  // Preserve the existing controller cancellation guard, including during recovery.
  if (cancellationInput(user.text)) {
    ledger.state = { ...ledger.state, status: 'cancelled', task: null, facts: {}, pending: null, job: null };
    delete ledger.state.reason;
    ledger.failed = false; ledger.unprocessed = []; ledger.disputed = {}; ledger.asked = {}; ledger.declined = [];
    return response(ledger, assistantFollowupCopy[language].cancelled);
  }
  // Safety latch is independent of model output and cannot be reset by a social turn.
  if (ledger.state.reason === 'emergency') return response(ledger, assistantFollowupCopy[language].emergency);
  if (ledger.failed && !retry) { ledger.unprocessed.push(user.id); return response(ledger, ''); }
  const userIndex = ledger.users.findIndex(t => t.id === user.id);
  const request: NativeDialogueRequest = { version: 2, revision: ledger.state.revision, language, task: ledger.state.task, facts: ledger.state.facts,
    disputed: ledger.disputed, superseded: ledger.superseded, asked: ledger.asked, declined: ledger.declined,
    pendingField: ledger.state.pending?.field ?? null, questionId: ledger.state.pending?.id ?? null,
    evidenceTurns: ledger.users.slice(0, userIndex + 1), turns: turns.slice(0, turns.lastIndexOf(raw!) + 1).slice(-12).map((t, i) => ({ id: t.id ?? `recent-${i}`, role: t.role, text: t.text })) };
  if (request.turns.at(-1)) request.turns[request.turns.length - 1] = user; else request.turns.push(user);
  if (JSON.stringify(request).length > DIALOGUE_LIMITS.requestCharacters) {
    ledger.exhausted = true; ledger.state.status = 'blocked'; ledger.state.reason = 'context'; return response(ledger, dialogueCopy[language].limit);
  }
  try {
    const value = await call(request);
    const applied = applyDialogueResult(ledger, user, request, value);
    if (!applied) throw new Error('Invalid on-device dialogue.');
    ledger = applied; ledger.unprocessed = ledger.unprocessed.filter(id => id !== user.id); ledger.failed = ledger.unprocessed.length > 0;
    return response(ledger, ledger.state.text, ledger.exhausted ? 'rules' : 'apple-on-device');
  } catch (error) {
    ledger.failed = true;
    if (!ledger.unprocessed.includes(user.id)) ledger.unprocessed.push(user.id);
    return response(ledger, record(error) && error.code === 'CONTEXT_LIMIT' ? dialogueCopy[language].limit : dialogueCopy[language].failure);
  }
}

/** Only the proposal can change the ledger. Reply text never becomes evidence. */
function applyDialogueResult(before: DialogueLedger, user: UserTurn, request: NativeDialogueRequest, value: unknown): DialogueLedger | null {
  if (!shape(value, ['version', 'revision', 'reply', 'proposal', 'question', 'declined']) || value.version !== 2 || value.revision !== request.revision
    || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 1000 || (value.reply.match(/[?؟？]/gu)?.length ?? 0) > 1
    || !(value.question === null || isQuestion(value.question)) || !Array.isArray(value.declined) || value.declined.length > 3 || !value.declined.every(isQuestion)) return null;
  const next = structuredClone(before), proposal = value.proposal;
  if (proposal !== null) {
    if (!shape(proposal, ['intent', 'task', 'quote', 'changes']) || !['amend', 'replace', 'cancel'].includes(proposal.intent as string)
      || !(proposal.task === null || typeof proposal.task === 'string' && Object.hasOwn(TASK_SEEDS, proposal.task))
      || !evidence(user, proposal.quote) || !Array.isArray(proposal.changes) || proposal.changes.length > 9) return null;
    if (proposal.intent === 'cancel') {
      if (proposal.task !== null || proposal.changes.length) return null;
      next.state = { ...next.state, task: null, facts: {}, job: null, pending: null, status: 'cancelled' }; next.disputed = {};
    } else {
      if (proposal.intent === 'replace') {
        if (!proposal.task) return null;
        const taskEvidence = evidence(user, proposal.quote)!;
        if (negatedEvidence(user.text, taskEvidence) || negatedActionInput(taskEvidence.quote) || ambiguousInput(user.text) || unsupportedInstructionInput(user.text)) return null;
        for (const [field, fact] of Object.entries(next.state.facts)) next.superseded.push({ field: field as Field, fact });
        next.state.facts = {}; next.disputed = {}; next.asked = {}; next.declined = [];
        next.state.task = { kind: proposal.task as keyof typeof TASK_SEEDS, evidence: taskEvidence };
      } else if (proposal.task !== null) return null;
      if (!next.state.task) return null;
      const seen = new Set<string>();
      for (const change of proposal.changes) {
        if (!shape(change, ['field', 'op', 'quote']) || !fields.includes(change.field as Field) || !['set', 'hold', 'clear'].includes(change.op as string) || seen.has(change.field as string)) return null;
        const span = evidence(user, change.quote); if (!span) return null;
        // Retain the established negative-evidence/alternative guards. Uncertainty
        // may hold a field; it cannot promote a quoted rejected option to work.
        if (change.op === 'set' && (negatedEvidence(user.text, span) || negatedActionInput(span.quote) || ambiguousInput(user.text))) return null;
        const field = change.field as Field; seen.add(field);
        if (field === 'outcome' && next.state.task.kind !== 'tech') return null;
        const previous = next.state.facts[field];
        if (previous) next.superseded.push({ field, fact: previous });
        delete next.state.facts[field];
        if (change.op === 'set') {
          next.state.facts[field] = { ...span, value: span.quote, turn: next.users.findIndex(t => t.id === user.id), source: 'native' };
          delete next.disputed[field];
        } else if (change.op === 'hold') next.disputed[field] = span;
        else delete next.disputed[field];
      }
      // An object's previous count never carries over without current evidence.
      if (seen.has('object') && !seen.has('quantity') && before.state.facts.object?.value !== next.state.facts.object?.value && next.state.facts.quantity) {
        next.superseded.push({ field: 'quantity', fact: next.state.facts.quantity }); delete next.state.facts.quantity;
      }
      const missing = next.state.task.kind === 'general' && !next.state.facts.action ? 'task'
        : next.state.task.kind === 'moving' && !next.state.facts.object ? 'object'
        : next.state.task.kind === 'moving' && !next.state.facts.destination ? 'destination'
          : next.state.task.kind === 'tech' && !next.state.facts.outcome ? 'outcome' : null;
      const held = Object.keys(next.disputed).length > 0;
      next.state.status = missing || held ? 'collecting' : 'ready';
      next.state.job = missing || held ? null : draft(taskAnalysis(next.state.task.kind, next.language, analyzeTaskWithRules), next.state.facts, next.language);
      if (next.state.job && next.state.task.kind === 'general') {
        // The existing generic template adds no inferred tools or specialist claims.
        // Retain the user's actual request, including when their language is not English.
        next.state.job.summary = next.state.facts.action!.value;
        next.state.job.summaryEnglish = next.state.facts.action!.value;
        const details = ['location', 'timing', 'access'] as const;
        const suffix = details.flatMap(field => next.state.facts[field] ? [next.state.facts[field]!.value] : []).join('; ');
        if (suffix) { next.state.job.summary += ` ${suffix}`; next.state.job.summaryEnglish += ` ${suffix}`; }
      }
      next.state.pending = missing ? { field: missing, id: `${user.id}:${missing}` } : null;
    }
  }
  if (next.superseded.length > DIALOGUE_LIMITS.superseded) {
    // Keep the last accepted checkpoint intact rather than partially applying an over-bound proposal.
    before.exhausted = true; before.state.status = 'blocked'; before.state.reason = 'context'; before.state.text = dialogueCopy[before.language].limit;
    return before;
  }
  next.declined = [...new Set([...next.declined, ...value.declined as ConversationField[]])];
  const field = value.question as ConversationField | null;
  // A declined, answered or once-failed question cannot re-enter a clarification loop.
  const stopQuestion = field && (field === 'review' || next.declined.includes(field) || !!next.state.facts[field as Field] || (next.asked[field] ?? 0) >= 1);
  if (field && !stopQuestion) {
    next.asked[field] = 1; next.state.pending = { field, id: `${user.id}:${field}` };
  }
  next.state.text = stopQuestion || (!field && /[?؟？]/u.test(value.reply)) ? dialogueCopy[next.language].manual : value.reply.trim();
  return next;
}
