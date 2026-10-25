import type { ChatTurn, Language } from '../community/types';
import { assistant } from './assistant';

/** Thin transient adapter shared by typed/voice demo turns and live requests.
 * Address, consent, transport retries and server policy stay with the caller. */
export async function sendRequestTurn(turns: readonly ChatTurn[], words: string, language: Language, firstName = '') {
  const next: ChatTurn[] = [...turns, { role: 'user' as const, text: words, id: crypto.randomUUID() }].slice(-12);
  const reply = await assistant.chat(next, language, { firstName });
  return { reply, turns: [...next, { role: 'assistant' as const, text: reply.text, id: crypto.randomUUID(), ...(reply.extraction ? { extraction: reply.extraction } : {}) }].slice(-12),
    originalText: reply.originalText ?? next.filter(t => t.role === 'user').map(t => t.text).join('\n') };
}
