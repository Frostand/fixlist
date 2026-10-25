#!/usr/bin/env node
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promptInventory, inventorySHA256, projectRoot, sha256 } from './inventory.mjs';
import { decodeWav, pcmMetrics } from './wav.mjs';
const fail = message => { throw new Error(`English prompt voice pack: ${message}`); };
export async function verifyVoicePack({ root = projectRoot, packDir = join(root, 'public/voice/en'), nativeSourcePath = join(root, 'ios/App/App/FixListAssistantPlugin.swift'), checkRecipe = true } = {}) {
  const inventory = await promptInventory(root), manifestBytes = readFileSync(join(packDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.mode !== 'bundled-english-assistant-prompt-clips' || manifest.language !== 'en' || manifest.voice !== 'af_heart' || manifest.model !== 'Kokoro-82M CoreML v1') fail('unsupported manifest mode/model/voice');
  if (manifest.inventorySHA256 !== inventorySHA256(inventory) || !Array.isArray(manifest.clips) || manifest.clips.length !== inventory.length) fail('stale source inventory; regenerate exact authored prompts');
  if (manifest.pins?.originalKokoroConversionRevision !== 'UNVERIFIED' || manifest.pins?.sdkRevision !== 'b10bdcb51dcfeedb8001353b4ba363da1a616d6d' || manifest.pins?.modelRevision !== 'e61d9ee79a01ad4ebf6b3d8bcfe2a03f6b8da105' || manifest.pins?.lexiconGeneratingMisakiRevision !== 'UNVERIFIED' || manifest.pins?.originalG2PConversionRevision !== 'UNVERIFIED') fail('wrong provenance pins');
  if (manifest.settings?.voiceSpeed !== 1 || manifest.settings?.deEss !== true || manifest.settings?.variant !== 'kokoro_21_15s.mlmodelc') fail('unexpected synthesis settings');
  const names = ['manifest.json', 'LICENSE.txt', 'NOTICES.txt', ...inventory.map(clip => `${clip.id}.wav`)].sort();
  const actualNames = readdirSync(packDir).sort();
  if (JSON.stringify(names) !== JSON.stringify(actualNames)) fail('missing or extra pack files');
  let totalBytes = 0, totalWavBytes = 0, longestSeconds = 0;
  for (const name of names) {
    const stat = lstatSync(join(packDir, name)); if (!stat.isFile() || stat.isSymbolicLink()) fail(`non-regular resource ${name}`);
    totalBytes += stat.size;
  }
  if (totalBytes > 10 * 1024 * 1024) fail('pack exceeds 10 MiB');
  for (const name of ['LICENSE.txt', 'NOTICES.txt']) {
    const data = readFileSync(join(packDir, name));
    if (data.length < 100 || sha256(data) !== manifest.notices?.[name]) fail(`missing/corrupt notice ${name}`);
  }
  for (let index = 0; index < inventory.length; index++) {
    const expected = inventory[index], clip = manifest.clips[index];
    if (clip.id !== expected.id || clip.text !== expected.text || JSON.stringify(clip.sources) !== JSON.stringify(expected.sources) || clip.textSHA256 !== sha256(expected.text) || clip.path !== `${expected.id}.wav`) fail(`stale/text/path mismatch at ${expected.id}`);
    const data = readFileSync(join(packDir, clip.path));
    if (data.length !== clip.bytes || sha256(data) !== clip.sha256) fail(`corrupt WAV ${clip.path}`);
    const wav = decodeWav(data), metrics = pcmMetrics(wav.samples);
    if (wav.durationSeconds !== clip.durationSeconds || wav.durationSeconds <= 0 || wav.durationSeconds >= 15) fail(`invalid duration ${clip.path}`);
    if (JSON.stringify(clip.format) !== JSON.stringify({ encoding: 'PCM', channels: 1, sampleRate: 24000, bitsPerSample: 16 })) fail(`invalid format ${clip.path}`);
    for (const [key, value] of Object.entries(metrics)) if (Math.abs(value - clip.metrics?.[key]) > 1e-12 || !Number.isFinite(clip.metrics?.[key])) fail(`PCM metrics mismatch ${clip.path}: ${key}`);
    if (metrics.peak > .701 || metrics.rms <= .001 || metrics.fullScaleSamples !== 0 || metrics.first20msPeak > .028 || metrics.last20msPeak > .028 || clip.generation?.fixedGain !== .70) fail(`headroom/endpoints/silence failed ${clip.path}`);
    if (!/^[a-f0-9]{64}$/.test(clip.generation?.rawWavSHA256 ?? '') || clip.generation.rawMetrics?.first20msPeak > .04 || clip.generation.rawMetrics?.last20msPeak > .04) fail(`missing/raw endpoint evidence ${clip.path}`);
    totalWavBytes += data.length; longestSeconds = Math.max(longestSeconds, wav.durationSeconds);
  }
  if (manifest.totalWavBytes !== totalWavBytes) fail('total WAV byte mismatch');
  if (checkRecipe) {
    for (const [file, hash] of Object.entries(manifest.regeneration?.provenanceFiles ?? {})) {
      if (file.startsWith('/') || file.split('/').includes('..') || sha256(readFileSync(join(root, 'scripts/voice-pack', file))) !== hash) fail(`changed regeneration input ${file}`);
    }
    if (Object.keys(manifest.regeneration?.provenanceFiles ?? {}).length < 12 || !manifest.regeneration?.toolchain?.swift || !manifest.regeneration?.toolchain?.xcode) fail('incomplete recipe/toolchain evidence');
  }
  const native = readFileSync(nativeSourcePath, 'utf8');
  const block = native.match(/\/\/ BEGIN GENERATED ENGLISH PROMPT CATALOG([\s\S]*?)\/\/ END GENERATED ENGLISH PROMPT CATALOG/)?.[1];
  if (!block || block.match(/manifestSHA256 = "([a-f0-9]+)"/)?.[1] !== sha256(manifestBytes)) fail('native manifest pin is stale');
  const texts = JSON.parse(block.match(/texts: Set<String> = (\[[\s\S]*\])/)?.[1] ?? 'null');
  if (JSON.stringify(texts) !== JSON.stringify(inventory.map(clip => clip.text))) fail('native exact-text catalog is stale');
  return { clips: inventory.length, totalBytes, totalWavBytes, longestSeconds, inventorySHA256: manifest.inventorySHA256 };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--pack-dir')) throw new Error('Usage: node scripts/voice-pack/verify.mjs [--pack-dir PATH]');
  verifyVoicePack(args.length ? { packDir: resolve(args[1]) } : {}).then(result => console.log(`Verified English prompt voice pack: ${JSON.stringify(result)}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
