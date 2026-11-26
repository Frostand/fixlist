import type { ChatTurn, Language } from '../community/types';
import { assistant } from './assistant';

/** Thin transient adapter shared by typed/voice demo turns and live requests.
 * Address, consent, transport retries and server policy stay with the caller. */
export async function sendRequestTurn(turns: readonly ChatTurn[], words: string, language: Language, firstName = '', retry = false) {
  const next: ChatTurn[] = retry ? [...turns] : [...turns, { role: 'user' as const, text: words, id: crypto.randomUUID() }];
  const reply = await assistant.chat(next, language, { firstName, retry });
  const result = reply.text ? [...next, { role: 'assistant' as const, text: reply.text, id: crypto.randomUUID(), ...(reply.extraction ? { extraction: reply.extraction } : {}), ...(reply.dialogue ? { dialogue: reply.dialogue } : {}) }]
    : next.map((t, i) => i === next.length - 1 && reply.dialogue ? { ...t, dialogue: reply.dialogue } : t);
  return { reply, turns: result.slice(-12),
    originalText: reply.originalText ?? next.filter(t => t.role === 'user').map(t => t.text).join('\n') };
}
