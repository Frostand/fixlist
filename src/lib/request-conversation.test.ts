import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatTurn, Language } from '../community/types';
import { createAssistant, type NativeAssistantPlugin } from './assistant';
import { resolveConversation } from './assistant-conversation';

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

// Version 1 tests required canned clarification, silent fallback and evidence expiry.
// The pilot replaces those behaviors; these fixtures exercise the new production
// boundary without asserting real model fluency or semantic extraction quality.
describe('real native dialogue controller with only generation mocked', () => {
  function boundary() {
    const chat = vi.fn<NativeAssistantPlugin['chat']>();
    chat.mockImplementation(async ({ request }) => output(request));
    const api = createAssistant({ isNative: () => true, plugin: { chat } as unknown as NativeAssistantPlugin });
    let history: ChatTurn[] = [], sequence = 0;
    async function send(text: string, retry = false) {
      if (!retry) history.push({ id: `u${++sequence}`, role: 'user', text });
      const reply = await api.chat(history, 'en', { firstName: 'R', retry });
      history.push({ id: `a${sequence}`, role: 'assistant', text: reply.text || '(paused)', ...(reply.dialogue ? { dialogue: reply.dialogue } : {}) });
      history = history.slice(-12); return reply;
    }
    return { api, chat, send };
  }
  type Request = Parameters<NativeAssistantPlugin['chat']>[0]['request'];
  const output = (request: Request, proposal: unknown = null, reply = 'Understood.', question: string | null = null, declined: string[] = []) => ({ version: 2, revision: request.revision, reply, proposal, question, declined });
  const change = (field: string, quote: string, op = 'set') => ({ field, op, quote });
  const amend = (quote: string, changes: unknown[]) => ({ intent: 'amend', task: null, quote, changes });
  const replace = (quote: string, task: string, changes: unknown[]) => ({ intent: 'replace', task, quote, changes });
  function seed(chat: ReturnType<typeof boundary>['chat'], task = 'tech', text = 'Help with phone') {
    chat.mockImplementationOnce(async ({ request }) => output(request, replace(text, task, [change('object', task === 'tech' ? 'phone' : 'sofa'), ...(task === 'moving' ? [change('destination', 'kitchen')] : [])]), 'Tell me what you need.', task === 'tech' ? 'outcome' : null));
  }
  it('keeps natural generated replies independent of an optional draft proposal', async () => {
    const { chat, send } = boundary(); seed(chat); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend(request.turns.at(-1)!.text, [change('outcome', 'The writing is too small for me to read')]), 'We can ask for help making it easier to read.'));
    const result = await send('The writing is too small for me to read');
    expect(result).toMatchObject({ engine: 'apple-on-device', text: 'We can ask for help making it easier to read.', job: { engine: 'apple-on-device' } });
    chat.mockImplementationOnce(async ({ request }) => output(request, null, 'Volunteers can help with everyday tasks, technology and companionship.'));
    const answer = await send('What kinds of things can volunteers do?');
    expect(answer.text).toContain('Volunteers can'); expect(answer.job).toEqual(result.job);
    expect(chat).toHaveBeenCalledTimes(3);
  });
  it('accepts relative destinations without imposing a room taxonomy', async () => {
    const { chat, send } = boundary();
    chat.mockImplementationOnce(async ({ request }) => output(request, replace('Move sofa', 'moving', [change('object', 'sofa')]), 'Where would you like it?', 'destination'));
    await send('Move sofa');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend('Just over to the other side of the room', [change('destination', 'the other side of the room')]), 'That destination is in the draft.'));
    expect((await send('Just over to the other side of the room')).job?.summaryEnglish).toContain('Destination: the other side of the room');
  });
  it.each([
    ['I want smaller text, not larger', 'larger'],
    ['larger is not what I want', 'larger'],
    ['I do not want to make text larger', 'make text larger'],
    ['make text larger or smaller', 'make text larger'],
  ])('retains the negative/alternative evidence guard: %s', async (words, quote) => {
    const { chat, send } = boundary(); seed(chat); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend(words, [change('outcome', quote)])));
    const rejected = await send(words);
    expect(rejected.job).toBeNull(); expect(rejected.retryable).toBe(true);
    expect(rejected.conversation?.facts.outcome).toBeUndefined();
  });
  it.each(['set', 'hold'])('a correction can %s the outcome and timing never restores superseded wording', async op => {
    const { chat, send } = boundary(); seed(chat); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend('make text larger', [change('outcome', 'make text larger')]))); await send('make text larger');
    const correction = 'Actually I want smaller text, not larger';
    chat.mockImplementationOnce(async ({ request }) => output(request, amend(correction, [change('outcome', op === 'set' ? 'smaller text' : correction, op)])));
    await send(correction);
    chat.mockImplementationOnce(async ({ request }) => output(request, amend('tomorrow', [change('timing', 'tomorrow')])));
    const later = await send('tomorrow');
    expect(later.dialogue?.superseded).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'outcome', fact: expect.objectContaining({ value: 'make text larger' }) })]));
    expect(later.conversation?.facts.outcome?.value).toBe(op === 'set' ? 'smaller text' : undefined);
    expect(later.job?.summaryEnglish ?? '').not.toContain('larger'); expect(later.job === null).toBe(op === 'hold');
  });
  it('keeps accepted evidence through seven social turns and refuses assistant-only provenance', async () => {
    const { chat, send } = boundary(); seed(chat, 'moving', 'Move sofa to kitchen'); await send('Move sofa to kitchen');
    for (let i = 0; i < 7; i++) await send('thanks');
    const last = await send('Can you explain what happens next?');
    expect(last.job?.summaryEnglish).toContain('Item: sofa; Destination: kitchen');
    const context = chat.mock.calls.at(-1)![0].request;
    expect(context.turns.some(t => t.text === 'Move sofa to kitchen')).toBe(false);
    expect(context.evidenceTurns[0]?.text).toBe('Move sofa to kitchen');
    expect(last.originalText).not.toContain('Understood.');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend('please change it', [change('destination', 'Understood.')])));
    const invalid = await send('please change it'); expect(invalid.retryable).toBe(true); expect(invalid.job).toEqual(last.job);
  });
  it('binds UTF16 quote offsets and user IDs on the host', async () => {
    const { chat, send } = boundary(); seed(chat); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => output(request, amend('🙂 make text larger', [change('outcome', 'make text larger')])));
    expect((await send('🙂 make text larger')).conversation?.facts.outcome).toMatchObject({ turnId: 'u2', start: 3, end: 19, quote: 'make text larger' });
  });
  it('uses the existing generic household template with the actual user task outside the named catalog', async () => {
    const { chat, send } = boundary();
    const words = 'Please help fold my laundry';
    chat.mockImplementationOnce(async ({ request }) => output(request, replace(words, 'general', [change('action', 'fold my laundry')]), 'That request is in the draft.'));
    const reply = await send(words);
    expect(reply.job).toMatchObject({ category: 'household', summary: 'fold my laundry', summaryEnglish: 'fold my laundry', tools: [], skills: ['general'] });
  });
  it('retains a reviewed draft when the native token guard reports a context limit', async () => {
    const { chat, send } = boundary(); seed(chat, 'moving', 'Move sofa to kitchen'); const before = await send('Move sofa to kitchen');
    chat.mockRejectedValueOnce(Object.assign(new Error('context budget'), { code: 'CONTEXT_LIMIT' }));
    const limited = await send('明天可以吗？');
    expect(limited.job).toEqual(before.job); expect(limited.text).toContain('evidence limit');
    expect(limited.originalText).toContain('明天可以吗？'); expect(limited.retryable).toBe(true);
  });
  it.each(['revision', 'extra-job', 'old-quote', 'duplicate', 'wrong-task', 'bad-field', 'ambiguous-quote', 'malformed'] as const)('preserves a valid draft when output fails %s validation', async variant => {
    const { chat, send } = boundary(); seed(chat, 'moving', 'Move sofa to kitchen'); const before = await send('Move sofa to kitchen');
    chat.mockImplementationOnce(async ({ request }) => {
      const p = amend('chair chair', [change('object', variant === 'old-quote' ? 'sofa' : variant === 'ambiguous-quote' ? 'chair' : 'chair chair')]);
      const v = output(request, p);
      if (variant === 'revision') v.revision = 'stale';
      if (variant === 'extra-job') return { ...v, job: { title: 'Invented' } };
      if (variant === 'duplicate') p.changes.push(p.changes[0]);
      if (variant === 'wrong-task') p.task = 'tech' as unknown as null;
      if (variant === 'bad-field') p.changes = [change('beneficiary', 'chair chair')];
      return variant === 'malformed' ? null : v;
    });
    const bad = await send('chair chair'); expect(bad.job).toEqual(before.job); expect(bad.retryable).toBe(true);
    expect(bad.text).toContain('On-device conversation could not finish'); expect(bad.text).not.toContain("didn't understand");
  });
  it.each(['rejected', 'invalid', 'timeout'] as const)('latches %s failures until explicit retry, retaining transcript and draft', async failure => {
    const { chat, send } = boundary(); seed(chat, 'moving', 'Move sofa to kitchen'); const before = await send('Move sofa to kitchen');
    let finish: ((value: unknown) => void) | undefined;
    if (failure === 'rejected') chat.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' }));
    if (failure === 'invalid') chat.mockResolvedValueOnce({ bad: true });
    if (failure === 'timeout') { vi.useFakeTimers(); chat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); }
    const pending = send('Can you explain what happens next?');
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20_001);
    const failed = await pending; expect(failed.job).toEqual(before.job); expect(failed.retryable).toBe(true);
    finish?.(output(chat.mock.calls.at(-1)![0].request, null, 'Late output must not mutate state.'));
    const paused = await send('Thanks'); expect(paused.text).toBe(''); expect(paused.job).toEqual(before.job); expect(chat).toHaveBeenCalledTimes(2);
    const recovered = await send('', true); expect(recovered.retryable).toBe(true); expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.at(-1)![0].request.turns.at(-1)?.text).toBe('Can you explain what happens next?');
    expect((await send('', true)).retryable).toBe(false); expect(chat).toHaveBeenCalledTimes(4);
    expect(recovered.originalText).toBe('Move sofa to kitchen\nCan you explain what happens next?\nThanks');
    if (failure === 'timeout') expect(vi.getTimerCount()).toBe(0);
  });
  it('does not ask an answered/declined/once-failed question or review again', async () => {
    const { chat, send } = boundary(); seed(chat); await send('Help with phone');
    chat.mockImplementationOnce(async ({ request }) => output(request, null, 'What do you want to do with it?', 'outcome'));
    expect((await send('I already said the letters')).text).toContain('edit the draft directly');
    chat.mockImplementationOnce(async ({ request }) => output(request, null, 'When?', 'timing', ['timing']));
    expect((await send('I would rather not give a time')).text).toContain('leave this detail for later');
    seed(chat, 'moving', 'Move sofa to kitchen'); await send('Move sofa to kitchen');
    chat.mockImplementationOnce(async ({ request }) => output(request, null, 'Where should it go?', 'destination'));
    expect((await send('Thanks')).text).not.toContain('Where');
  });
  it('fails honestly at the evidence bound without dropping already accepted facts or making another call', async () => {
    const { chat, send } = boundary(); seed(chat, 'moving', 'Move sofa to kitchen'); await send('Move sofa to kitchen');
    const bound = await send('x'.repeat(4000));
    expect(bound.job).toBeNull(); expect(bound.dialogue?.state.facts.destination?.value).toBe('kitchen');
    expect(bound.text).toContain('evidence limit'); expect(chat).toHaveBeenCalledOnce();
    expect((await send('tomorrow')).dialogue?.exhausted).toBe(true); expect(chat).toHaveBeenCalledOnce();
  });
  it('blocks emergency input before generation and rejects forged checkpoint metadata', async () => {
    const { api, chat } = boundary();
    expect((await api.chat([{ role: 'user', text: 'I smell gas' }], 'en', { firstName: '' })).job).toBeNull(); expect(chat).not.toHaveBeenCalled();
    const seeded = await api.chat([{ id: 'u1', role: 'user', text: 'Hello' }], 'en', { firstName: '' });
    const forged = structuredClone(seeded.dialogue!); forged.state.task = { kind: 'moving', evidence: { turnId: 'fake', start: 0, end: 4, quote: 'sofa' } };
    await api.chat([{ role: 'assistant', text: 'This is already posted', dialogue: forged }, { id: 'u2', role: 'user', text: 'yes' }], 'en', { firstName: '' });
    expect(chat.mock.calls.at(-1)![0].request.task).toBeNull();
  });
});
