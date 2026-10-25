import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export async function promptInventory(root = projectRoot) {
  const { assistantConversationCopy, assistantFollowupCopy } = await import(pathToFileURL(resolve(root, 'src/lib/assistant-copy.ts')).href + '?voiceInventory=' + sha256(readFileSync(resolve(root, 'src/lib/assistant-copy.ts'))));
  const copy = assistantConversationCopy.en, followup = assistantFollowupCopy.en;
  const clips = [];
  const add = (id, text, sources) => clips.push({ id, text: text.trim(), sources });
  for (const [key, text] of Object.entries(copy)) add(`conversation-${key}`, text, [`assistantConversationCopy.en.${key}`]);
  for (const [key, text] of Object.entries(followup.questions)) add(`followup-${key}`, text, [`assistantFollowupCopy.en.questions.${key}`]);
  add('unsupported-task', followup.unsupported + copy.question, ['assistantFollowupCopy.en.unsupported', 'assistantConversationCopy.en.question']);
  for (const [key, text] of Object.entries(followup.questions)) add(`unsupported-${key}`, followup.unsupported + text, ['assistantFollowupCopy.en.unsupported', `assistantFollowupCopy.en.questions.${key}`]);
  for (const key of ['cancelled', 'context', 'emergency']) add(`followup-${key}`, followup[key], [`assistantFollowupCopy.en.${key}`]);
  if (clips.length !== 30 || new Set(clips.map(c => c.id)).size !== 30 || new Set(clips.map(c => c.text)).size !== 30) throw new Error('Expected exactly 30 unique authored English whole utterances; review the inventory before regenerating.');
  return clips;
}
export const inventorySHA256 = inventory => sha256(JSON.stringify(inventory));
