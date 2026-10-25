import { describe, expect, it } from 'vitest';
import { createAssistant } from './assistant';
import type { ChatTurn, Language } from '../community/types';

const api = createAssistant({ isNative: () => false });
const chat = (words: string[], language: Language = 'en') => api.chat(words.flatMap((text, i): ChatTurn[] => [
  ...(i ? [{ role: 'assistant' as const, text: 'This assistant text is never fact evidence.' }] : []), { role: 'user', text },
]), language, { firstName: 'Resident' });

describe('Astra HOLD production regressions', () => {
  it('amends plant quantity without dropping room or timing', async () => {
    const reply = await chat(['Water three plants in kitchen tomorrow after 2pm', 'Actually water two plants']);
    expect(reply.job?.summaryEnglish).toContain('Quantity: two; Room: kitchen; Timing: tomorrow after 2pm');
  });
  it('amends a moving object without dropping either location or timing, and clears the old object quantity', async () => {
    const reply = await chat(['Move two chairs from bedroom to kitchen tomorrow', 'Actually move the table']);
    expect(reply.job?.summaryEnglish).toContain('Item: table; From: bedroom; Destination: kitchen; Timing: tomorrow');
    expect(reply.job?.summaryEnglish).not.toMatch(/chairs|Quantity: two/);
  });
  it.each(['I do not want to move the chair to the kitchen', 'No need to move a chair to the kitchen'])('never turns negated moving into a draft: %s', async text => {
    expect(await chat([text])).toMatchObject({ job: null, engine: 'rules' });
  });
  it('classifies carrying groceries separately from moving furniture', async () => {
    const reply = await chat(['Help carry groceries to the kitchen']);
    expect(reply.job).not.toBeNull(); expect(reply.job?.category).not.toBe('moving');
    expect(reply.job?.summaryEnglish).toMatch(/carry groceries/iu); expect(reply.job?.summaryEnglish).not.toMatch(/furniture|\bcar\b|trip/iu);
  });
  it.each(['Move plants to kitchen', 'Help carry a phone to kitchen'])('clarifies unsupported transport instead of inventing furniture or watering: %s', async text => {
    expect(await chat([text])).toMatchObject({ job: null });
  });
  it('treats a standalone emergency denial as clarification and still blocks a later emergency', async () => {
    expect(await chat(['I smell gas', 'Not an emergency'])).toMatchObject({ job: null, conversation: { status: 'collecting' } });
    expect(await chat(['I smell gas', 'Not an emergency', 'Now there is smoke'])).toMatchObject({ job: null, conversation: { status: 'blocked' } });
  });
  it('clears old facts for an explicit new request even in the same task family', async () => {
    const reply = await chat(['Water three plants in kitchen tomorrow', 'New request: water two plants']);
    expect(reply.job?.summaryEnglish).toContain('Quantity: two'); expect(reply.job?.summaryEnglish).not.toMatch(/kitchen|tomorrow/);
  });
  it.each([
    ['en', 'Water plants, urgent', 'urgent'], ['es', 'Regar plantas hoy', 'hoy'], ['zh', '请帮我今天浇水', '今天'],
  ] satisfies [Language, string, string][])('retains explicit urgency and its evidence in %s', async (language, text, timing) => {
    const reply = await chat([text], language);
    expect(reply.job?.urgency).toBe('today'); expect(reply.conversation?.facts.timing?.value).toContain(timing);
  });
  it.each(['Help replace the carbon monoxide sensor battery', 'No gas leak; help replace a bulb'])('allows ordinary maintenance without a false emergency latch: %s', async text => {
    expect(await chat([text])).toMatchObject({ conversation: { status: 'ready' } });
  });
  it('can recover from a false alarm but still triages a later actual emergency', async () => {
    const reply = await chat(['I smell gas', 'Not an emergency; help replace the carbon monoxide sensor battery']);
    expect(reply.job).not.toBeNull();
    expect(await chat(['I smell gas', 'Not an emergency; help replace the carbon monoxide sensor battery', 'Now I smell gas again'])).toMatchObject({ job: null, conversation: { status: 'blocked', reason: 'emergency' } });
  });
});
