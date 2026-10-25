import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { promptInventory, projectRoot } from './voice-pack/inventory.mjs';
import { verifyVoicePack } from './voice-pack/verify.mjs';
const fixtures = [];
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fixlist-voice-pack-test-')); fixtures.push(root);
  for (const relative of ['public/voice/en', 'scripts/voice-pack']) { mkdirSync(join(root, relative, '..'), { recursive: true }); cpSync(join(projectRoot, relative), join(root, relative), { recursive: true }); }
  for (const relative of ['src/lib/assistant-copy.ts', 'ios/App/App/FixListAssistantPlugin.swift']) { mkdirSync(join(root, relative, '..'), { recursive: true }); cpSync(join(projectRoot, relative), join(root, relative)); }
  return root;
}
function mutateManifest(root, change) { const path = join(root, 'public/voice/en/manifest.json'), manifest = JSON.parse(readFileSync(path)); change(manifest); writeFileSync(path, JSON.stringify(manifest)); }
describe('committed English whole-utterance prompt pack', () => {
  it('matches all 30 source-derived exact texts, pins, PCM metrics and native resource identities', async () => {
    const result = await verifyVoicePack(); expect(result.clips).toBe(30); expect(result.totalBytes).toBeLessThanOrEqual(10 * 1024 * 1024); expect(result.longestSeconds).toBeLessThan(15);
    const inventory = await promptInventory(); expect(new Set(inventory.map(clip => clip.text)).size).toBe(30);
    expect(inventory.find(clip => clip.id === 'unsupported-task')?.text).toBe("I didn't understand that detail. What would you like help with at home?");
  });
  it('rejects stale authored English even after an earlier verification in the same process', async () => {
    const root = fixture(); await verifyVoicePack({ root }); const path = join(root, 'src/lib/assistant-copy.ts');
    writeFileSync(path, readFileSync(path, 'utf8').replace('What would you like help with at home?', 'What help would you like at home?'));
    await expect(verifyVoicePack({ root })).rejects.toThrow('stale source inventory');
  });
  it('rejects a missing clip', async () => { const root = fixture(); unlinkSync(join(root, 'public/voice/en/conversation-question.wav')); await expect(verifyVoicePack({ root })).rejects.toThrow('missing or extra'); });
  it('rejects extra clips or stale leftovers', async () => { const root = fixture(); writeFileSync(join(root, 'public/voice/en/old-prompt.wav'), 'stale'); await expect(verifyVoicePack({ root })).rejects.toThrow('missing or extra'); });
  it('rejects equal-length PCM tampering', async () => { const root = fixture(), path = join(root, 'public/voice/en/conversation-question.wav'), wav = readFileSync(path); wav[1000] ^= 1; writeFileSync(path, wav); await expect(verifyVoicePack({ root })).rejects.toThrow('corrupt WAV'); });
  it('rejects corrupt licensing material', async () => { const root = fixture(); writeFileSync(join(root, 'public/voice/en/NOTICES.txt'), 'lost'); await expect(verifyVoicePack({ root })).rejects.toThrow('notice'); });
  it('rejects stale source text hashes and unsafe asset paths', async () => { const root = fixture(); mutateManifest(root, manifest => { manifest.clips[0].textSHA256 = '0'.repeat(64); manifest.clips[0].path = '../other.wav'; }); await expect(verifyVoicePack({ root })).rejects.toThrow('text/path mismatch'); });
  it('rejects fabricated duration, metrics and provenance', async () => {
    for (const [change, message] of [[m => { m.clips[0].durationSeconds = 15; }, 'duration'], [m => { m.clips[0].metrics.rms = 0; }, 'PCM metrics'], [m => { m.pins.originalG2PConversionRevision = 'invented'; }, 'provenance']]) {
      const root = fixture(); mutateManifest(root, change); await expect(verifyVoicePack({ root })).rejects.toThrow(message);
    }
  });
  it('rejects a changed generation recipe', async () => { const root = fixture(); writeFileSync(join(root, 'scripts/voice-pack/offline-sdk.patch'), 'changed'); await expect(verifyVoicePack({ root })).rejects.toThrow('changed regeneration input'); });
  it('rejects a stale native catalog/pin', async () => { const root = fixture(), path = join(root, 'ios/App/App/FixListAssistantPlugin.swift'); writeFileSync(path, readFileSync(path, 'utf8').replace(/manifestSHA256 = "[a-f0-9]+"/, 'manifestSHA256 = "0000"')); await expect(verifyVoicePack({ root })).rejects.toThrow('native manifest pin'); });
  it('refuses SDK/weight caches inside the checkout before any generation or download', () => {
    for (const [command, args] of [[process.execPath, [join(projectRoot, 'scripts/voice-pack/regenerate.mjs'), '--cache', projectRoot]], ['python3', [join(projectRoot, 'scripts/voice-pack/prepare.py'), '--cache', projectRoot]]]) {
      let rejected = false;
      try { execFileSync(command, args, { stdio: 'pipe' }); }
      catch (error) { rejected = true; expect(String(error.stderr)).toContain('cache must stay outside the Git checkout'); }
      expect(rejected).toBe(true);
    }
  });
});
