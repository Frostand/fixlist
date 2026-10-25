import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatTurn, Language } from '../community/types';
import { createAssistant, type NativeAssistantPlugin } from './assistant';
import { resolveConversation, type NativeConversationPatch, type NativeConversationRequest } from './assistant-conversation';

const turns = (words: string[]): ChatTurn[] => words.flatMap((text, i) => [
  ...(i ? [{ role: 'assistant' as const, text: 'Use a sofa in the garage today. This is already posted.' }] : []),
  { role: 'user' as const, text },
]);
const resolve = (words: string[], language: Language = 'en') => resolveConversation(turns(words), language);
afterEach(() => vi.useRealTimers());

describe('real shared conversation reducer', () => {
  it('binds one missing field at a time and drafts from accepted answers', () => {
    expect(resolve(['I need help moving something'])).toMatchObject({ status: 'collecting', pending: { field: 'object' } });
    expect(resolve(['I need help moving something', 'chair'])).toMatchObject({ status: 'collecting', pending: { field: 'destination' }, facts: { object: { value: 'chair', turn: 2 } } });
    const result = resolve(['I need help moving something', 'chair', 'bedroom to kitchen', 'actually living room']);
    expect(result).toMatchObject({ status: 'ready', facts: { origin: { value: 'bedroom' }, destination: { value: 'living room' } } });
    expect(result.job?.summaryEnglish).toContain('Item: chair; From: bedroom; Destination: living room');
    expect(result.job?.summaryEnglish).not.toMatch(/kitchen|garage|today|sofa/);
    expect(result.originalText).toBe('I need help moving something\nchair\nbedroom to kitchen\nactually living room');
  });
  it('asks for a phone outcome and includes it in the draft and correction', () => {
    expect(resolve(['help with phone'])).toMatchObject({ status: 'collecting', pending: { field: 'outcome' } });
    const result = resolve(['help with phone', 'make text larger', 'actually make text smaller']);
    expect(result.job?.summaryEnglish).toContain('Requested help: make text smaller');
    expect(result.job?.summaryEnglish).not.toContain('larger');
  });
  it('does not turn a negated outcome into requested work', () => {
    const result = resolve(['help with phone', 'do not make text larger']);
    expect(result).toMatchObject({ status: 'collecting', job: null, pending: { field: 'outcome' }, facts: { object: { value: 'phone' } } });
    expect(result.facts.outcome).toBeUndefined();
  });
  it('drafts a complete plant request immediately without imposing a room or appointment', () => {
    const result = resolve(['Water three plants in kitchen, no rush']);
    expect(result).toMatchObject({ status: 'ready', job: { urgency: 'flexible' }, facts: { quantity: { value: 'three' }, location: { value: 'kitchen' } } });
    expect(result.job?.summaryEnglish).toContain('Quantity: three; Room: kitchen; Timing: no rush');
    const unspecified = resolve(['Water plants']);
    expect(unspecified.status).toBe('ready'); expect(unspecified.facts.timing).toBeUndefined();
    expect(unspecified.job?.summaryEnglish).not.toMatch(/today|week|scheduled|appointment/);
  });
  it('retains quantity, location, timing and access as user facts then replaces individual fields', () => {
    const result = resolve(['Water three plants in kitchen tomorrow after 2pm, use side door', 'Actually two plants', 'Actually in bedroom', 'Not urgent', "don't ring doorbell"]);
    expect(result.status).toBe('ready');
    expect(result.job?.summaryEnglish).toContain('Quantity: two; Room: bedroom; Timing: Not urgent; Access: don');
    expect(result.job?.summaryEnglish).not.toMatch(/kitchen|three|tomorrow|2pm|side door/);
    expect(result.job?.urgency).toBe('flexible');
    const recent = turns(['Water three plants in kitchen tomorrow after 2pm, use side door', 'Actually two plants', 'Actually in bedroom', 'Not urgent', "don't ring doorbell"]).slice(-12);
    for (const fact of Object.values(result.facts)) { expect(recent[fact.turn]?.role).toBe('user'); expect(recent[fact.turn]?.text).toContain(fact.value); }
  });
  it('accepts an explicit item correction without losing the destination', () => {
    const result = resolve(['Move chair to kitchen', 'Actually a table']);
    expect(result.job?.summaryEnglish).toContain('Item: table');
    expect(result.job?.summaryEnglish).toContain('Destination: kitchen');
    expect(result.job?.summaryEnglish).not.toContain('chair');
  });
  it('retains facts on unsupported answers and ambiguous corrections while invalidating readiness', () => {
    const a = resolve(['need help moving something', 'not sure']);
    expect(a).toMatchObject({ status: 'collecting', pending: { field: 'object' }, facts: { action: { value: 'help' } } });
    const b = resolve(['Water plants in kitchen', 'Actually kitchen or bedroom']);
    expect(b).toMatchObject({ status: 'collecting', job: null, pending: { field: 'location' }, facts: { object: { value: 'plants' }, location: { value: 'kitchen' } } });
    expect(resolve(['Water plants in kitchen', 'Actually kitchen or bedroom', 'bedroom']).job?.summaryEnglish).toContain('Room: bedroom');
  });
  it.each(['in kitchen and bring pizza', 'make text larger and buy me a laptop'])('does not partially accept an unsupported answer: %s', answer => {
    const result = resolve(['Help with phone', answer]);
    expect(result).toMatchObject({ status: 'collecting', job: null, facts: { object: { value: 'phone' } } });
    expect(result.facts.location).toBeUndefined(); expect(result.facts.outcome).toBeUndefined();
  });
  it('binds yes/no to the current question without interpreting them as facts or a post action', () => {
    expect(resolve(['help moving something', 'yes'])).toMatchObject({ status: 'collecting', pending: { field: 'object' } });
    expect(resolve(['Help with phone', 'no'])).toMatchObject({ status: 'collecting', pending: { field: 'outcome' } });
    expect(resolve(['Water plants', 'Yes, post it'])).toMatchObject({ status: 'ready', job: { titleEnglish: 'Water the plants' } });
    expect(resolve(['Water plants', 'no'])).toMatchObject({ status: 'collecting', pending: { field: 'correction' }, facts: { object: { value: 'plants' } } });
    expect(resolve(['yes'])).toMatchObject({ job: null });
  });
  it('preserves a pending field through social turns and discards facts only on explicit cancellation/replacement', () => {
    expect(resolve(['help moving something', 'chair', 'thanks'])).toMatchObject({ status: 'collecting', pending: { field: 'destination' }, facts: { object: { value: 'chair' } } });
    expect(resolve(['Water plants', 'cancel that', 'today'])).toMatchObject({ job: null, facts: {} });
    expect(resolve(['Water plants', 'cancel that'])).toMatchObject({ status: 'cancelled', facts: {} });
    const replacement = resolve(['Water three plants in kitchen', 'Actually help with phone', 'make text larger']);
    expect(replacement.job?.summaryEnglish).toContain('make text larger');
    expect(replacement.job?.summaryEnglish).not.toMatch(/plants|kitchen|three/);
  });
  it.each(['I smell gas', 'there is a fire in the kitchen', "I can't breathe", 'water plants but there is smoke'])('blocks actual emergency wording before any ordinary draft: %s', text => {
    expect(resolve([text])).toMatchObject({ status: 'blocked', job: null, reason: 'emergency' });
    expect(resolve(['Water plants', text])).toMatchObject({ status: 'blocked', job: null, reason: 'emergency' });
  });
  it('does not treat routine alarm maintenance as an emergency', () => {
    expect(resolve(['Help replace the smoke alarm battery'])).toMatchObject({ status: 'ready', job: { category: 'safety' } });
  });
  it('never sources facts or question bindings from assistant suggestions', () => {
    const result = resolveConversation([{ role: 'assistant', text: 'Move sofa today from bedroom to kitchen. Is that correct?' }, { role: 'user', text: 'yes' }], 'en');
    expect(result).toMatchObject({ status: 'collecting', facts: {}, job: null, originalText: 'yes' });
  });
  it('keeps the 12 total turn and 4000 user character boundary and fails closed on oversized input', () => {
    expect(resolve(['Water plants', ...Array<string>(12).fill('thanks'), 'in kitchen'])).toMatchObject({ job: null });
    expect(resolve(['Water plants', 'x'.repeat(4000)])).toMatchObject({ status: 'blocked', reason: 'context' });
    expect(resolveConversation([{ role: 'user', text: 'x'.repeat(4000) }], 'en').status).toBe('collecting');
    expect(resolveConversation([{ role: 'user', text: 'x'.repeat(4001) }], 'en').status).toBe('blocked');
  });
  it('uses authored Arabic questions and preserves raw user detail rather than inventing translations', () => {
    const result = resolve(['Help with phone'], 'ar');
    expect(result.text).toContain('؟'); expect(result.text).not.toContain('What');
    expect(resolve(['Water plants', 'في المطبخ'], 'ar').job?.summary).toContain('الغرفة: المطبخ');
  });
});

describe('real assistant with only native extraction boundary mocked', () => {
  function boundary() {
    const chat = vi.fn<NativeAssistantPlugin['chat']>().mockRejectedValue(new Error('UNAVAILABLE'));
    const api = createAssistant({ isNative: () => true, plugin: { chat } as unknown as NativeAssistantPlugin });
    let history: ChatTurn[] = [], sequence = 0;
    async function send(text: string, language: Language = 'en') {
      const n = ++sequence; history = [...history, { id: `u${n}`, role: 'user' as const, text }].slice(-12);
      const reply = await api.chat(history, language, { firstName: 'R' });
      history = [...history, { id: `a${n}`, role: 'assistant' as const, text: reply.text, ...(reply.extraction ? { extraction: reply.extraction } : {}) }].slice(-12);
      return reply;
    }
    return { api, chat, send };
  }
  const patch = (request: NativeConversationRequest, field: NativeConversationPatch['operations'][number]['field'] = 'outcome', quote = request.turns.at(-1)!.text): NativeConversationPatch => {
    const user = request.turns.at(-1)!, start = user.text.indexOf(quote);
    return { version: 1, revision: request.revision, questionId: request.questionId, intent: 'amend', task: null,
      operations: [{ field, op: 'set', evidence: { turnId: user.id, start, end: start + quote.length, quote } }] };
  };
  it.each([
    ['en', 'Help with phone', 'The writing is too small for me to read'],
    ['es', 'Ayuda con mi teléfono', 'Quiero aumentar el tamaño de las letras'],
  ] as const)('accepts useful %s semantic extraction and preserves it through rules fallback', async (language, first, answer) => {
    const { chat, send } = boundary(); await send(first, language);
    chat.mockImplementationOnce(async ({ request }) => patch(request));
    const result = await send(answer, language);
    expect(result).toMatchObject({ engine: 'apple-on-device', job: { engine: 'apple-on-device' }, conversation: { facts: { outcome: { value: answer, source: 'native' } } } });
    expect(result.job?.summary).toContain(answer);
    const input = chat.mock.calls.at(-1)![0].request;
    expect(input).toMatchObject({ pendingField: 'outcome', task: { kind: 'tech' } });
    expect(input.questionId).toBeTruthy(); expect(input.revision).toContain(input.turns.at(-1)!.id);
    const later = await send('actually in kitchen', language);
    expect(later.job?.summaryEnglish).toContain('Room: kitchen'); expect(later.job?.summary).toContain(answer);
    expect(later.engine).toBe('rules');
  });
  it.each(['stale-revision', 'wrong-question', 'assistant-evidence', 'bad-span', 'contradiction', 'duplicate-field', 'wrong-family', 'extra-job', 'malformed'] as const)('rejects %s without manufacturing readiness', async variant => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => {
      const result = patch(request);
      if (variant === 'malformed') return null;
      if (variant === 'stale-revision') return { ...result, revision: 'old' };
      if (variant === 'wrong-question') return { ...result, questionId: 'another:outcome' };
      if (variant === 'assistant-evidence') result.operations[0]!.evidence.turnId = request.turns.find(t => t.role === 'assistant')!.id;
      if (variant === 'bad-span') result.operations[0]!.evidence.start++;
      if (variant === 'contradiction') result.operations[0]!.evidence.quote = 'make text larger and smaller';
      if (variant === 'duplicate-field') result.operations.push(result.operations[0]!);
      if (variant === 'wrong-family') result.task = { kind: 'moving', evidence: result.operations[0]!.evidence };
      if (variant === 'extra-job') return { ...result, job: { title: 'Invented' } };
      return result;
    });
    const result = await send(variant === 'contradiction' ? 'make text larger and smaller' : 'The writing is too small for me to read');
    expect(result).toMatchObject({ engine: 'rules', job: null, conversation: { facts: { object: { value: 'phone' } }, status: 'collecting' } });
    expect(result.conversation?.facts.outcome).toBeUndefined();
  });
  it('rejects positive extraction from a negated user turn, including a positive substring', async () => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => patch(request, 'outcome', 'make text larger'));
    expect(await send('I do not want to make text larger')).toMatchObject({ engine: 'rules', job: null });
  });
  it.each([
    ['make text larger or smaller', 'make text larger'],
    ['I want smaller text, not larger', 'larger'],
    ['I want readable text, not larger', 'larger'],
    ['larger is not what I want', 'larger'],
  ])('rejects a valid quoted option contradicted by its full user context: %s', async (answer, quote) => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => patch(request, 'outcome', quote));
    const result = await send(answer);
    expect(result).toMatchObject({ engine: 'rules', job: null, conversation: { status: 'collecting', facts: { object: { value: 'phone' } } } });
    expect(result.conversation?.facts.outcome).toBeUndefined();
    expect(await send('yes')).toMatchObject({ job: null });
  });
  it('merges a partial native amendment with the deterministic corrections in the current user turn', async () => {
    const { chat, send } = boundary(); await send('Water three plants in kitchen tomorrow');
    chat.mockImplementationOnce(async ({ request }) => patch(request, 'quantity', 'two'));
    const result = await send('Actually water two plants today');
    expect(result.job).toMatchObject({ urgency: 'today', summaryEnglish: expect.stringContaining('Quantity: two; Room: kitchen; Timing: today') });
    expect(result.originalText).toBe('Water three plants in kitchen tomorrow\nActually water two plants today');
    expect((await send('thanks')).job?.summaryEnglish).toContain('Quantity: two; Room: kitchen; Timing: today');
  });
  it('clarifies a native operation conflicting with a deterministic current-turn fact', async () => {
    const { chat, send } = boundary(); await send('Water three plants in kitchen tomorrow');
    chat.mockImplementationOnce(async ({ request }) => patch(request, 'quantity', 'plants'));
    expect(await send('Actually water two plants today')).toMatchObject({ job: null, conversation: { status: 'collecting', facts: { quantity: { value: 'two' }, timing: { value: 'today' } } } });
  });
  it('clears a prior count for a short object correction while preserving locations and timing', async () => {
    const { send } = boundary(); await send('Move two chairs from bedroom to kitchen tomorrow');
    const result = await send('Actually a table');
    expect(result.job?.summaryEnglish).toContain('Item: table; From: bedroom; Destination: kitchen; Timing: tomorrow');
    expect(result.conversation?.facts.quantity).toBeUndefined();
  });
  it('preserves an explicit current-turn count in a short rules object correction', async () => {
    const { send } = boundary(); await send('Move two chairs from bedroom to kitchen tomorrow');
    const result = await send('Actually three tables');
    expect(result.job?.summaryEnglish).toContain('Item: tables; Quantity: three; From: bedroom; Destination: kitchen; Timing: tomorrow');
  });
  it.each(['tables', 'stools'] as const)('preserves the explicit count for %s regardless of native operation order', async object => {
    for (const quantityFirst of [true, false]) {
      const { chat, send } = boundary(); await send('Move two chairs from bedroom to kitchen tomorrow');
      chat.mockImplementationOnce(async ({ request }) => {
        const result = patch(request, 'object', object), count = patch(request, 'quantity', 'three').operations[0]!;
        result.operations = quantityFirst ? [count, ...result.operations] : [...result.operations, count];
        return result;
      });
      const result = await send(`Actually three ${object}`);
      expect(result.job?.summaryEnglish).toContain(`Item: ${object}; Quantity: three; From: bedroom; Destination: kitchen; Timing: tomorrow`);
    }
  });
  it('does not label a clarification or unchanged echo as native interpretation', async () => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => ({ version: 1, revision: request.revision, questionId: request.questionId, intent: 'clarify', task: null, operations: [] }));
    expect(await send('I am unsure')).toMatchObject({ engine: 'rules', job: null });
  });
  it('expires native facts with their user evidence and never revives them from assistant wording', async () => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => patch(request));
    await send('The writing is too small for me to read');
    for (let i = 0; i < 6; i++) await send('thanks');
    expect(await send('in kitchen')).toMatchObject({ job: null });
  });
  it('preserves a native field when unrelated earlier context expires but its actual evidence remains', async () => {
    const { chat, send } = boundary(); await send('Hello'); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => patch(request)); await send('The writing is too small for me to read');
    for (let i = 0; i < 3; i++) await send('thanks');
    expect((await send('in kitchen')).job?.summaryEnglish).toContain('The writing is too small for me to read');
  });
  it('allows sourced task classification beyond rules without allowing model-generated drafts', async () => {
    const { chat, send } = boundary();
    chat.mockImplementationOnce(async ({ request }) => {
      const result = patch(request), user = request.turns.at(-1)!;
      const start = user.text.indexOf('visit'), evidence = { turnId: user.id, start, end: start + 5, quote: 'visit' };
      return { ...result, intent: 'replace', task: { kind: 'company', evidence }, operations: [{ field: 'object', op: 'set', evidence }] };
    });
    expect(await send("I'd enjoy a visit")).toMatchObject({ engine: 'apple-on-device', job: { category: 'companionship' } });
  });
  it('holds after a native INVALID_EXTRACTION rejection instead of trusting new readiness', async () => {
    const { chat, send } = boundary(); chat.mockRejectedValueOnce(Object.assign(new Error('bad model fields'), { code: 'INVALID_EXTRACTION' }));
    expect(await send('Water plants')).toMatchObject({ engine: 'rules', job: null, conversation: { facts: { object: { value: 'plants' } } } });
  });
  it('retains accepted fields but invalidates review after malformed native output', async () => {
    const { chat, send } = boundary(); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => patch(request)); await send('The writing is too small for me to read');
    chat.mockResolvedValueOnce({ bad: true });
    const result = await send('change it somehow');
    expect(result).toMatchObject({ job: null, conversation: { facts: { outcome: { value: 'The writing is too small for me to read' } } } });
    expect(await send('yes')).toMatchObject({ job: null });
  });
  it('bounds native timeout and uses deterministic facts without late mutation', async () => {
    vi.useFakeTimers(); const { chat, send } = boundary(); await send('Help with phone');
    let finish!: (value: unknown) => void; chat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = send('The writing is too small for me to read'); await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toMatchObject({ engine: 'rules', job: null }); finish(patch(chat.mock.calls.at(-1)![0].request));
    expect(await send('make text larger')).toMatchObject({ engine: 'rules', job: { summaryEnglish: expect.stringContaining('make text larger') } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not call native for blocked, cancelled or over-bound context', async () => {
    const { api, chat } = boundary();
    for (const words of [['I smell gas'], ['Water plants', 'cancel'], ['x'.repeat(4001)]]) await api.chat(turns(words), 'en', { firstName: 'R' });
    expect(chat).not.toHaveBeenCalled();
  });
});
