#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promptInventory, inventorySHA256, sha256, projectRoot } from './inventory.mjs';
import { decodeWav, encodeWav, pcmMetrics } from './wav.mjs';
const here = fileURLToPath(new URL('./', import.meta.url));
const args = process.argv.slice(2);
let cache = join(homedir(), '.local/share/fixlist-voice/prompt-pack'), reuse;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cache') cache = resolve(args[++i]);
  else if (args[i] === '--reuse-assets') reuse = resolve(args[++i]);
  else throw new Error('Usage: node scripts/voice-pack/regenerate.mjs [--cache PATH] [--reuse-assets PATH]');
}
const inside = (path, root) => path === root || path.startsWith(root + sep);
if (inside(resolve(cache), resolve(projectRoot))) throw new Error('SDK/model cache must stay outside the Git checkout.');
mkdirSync(cache, { recursive: true });
cache = realpathSync(cache);
if (inside(cache, realpathSync(projectRoot))) throw new Error('SDK/model cache redirects into the Git checkout.');
const inventory = await promptInventory();
const input = join(cache, 'inventory.json'), raw = join(cache, 'raw');
writeFileSync(input, JSON.stringify(inventory, null, 2) + '\n');
const prepared = JSON.parse(execFileSync('python3', [join(here, 'prepare.py'), '--cache', cache, ...(reuse ? ['--reuse-assets', reuse] : [])], { encoding: 'utf8' }));
const env = { ...process.env, FIXLIST_VOICE_SDK_PATH: prepared.sdk };
const scratch = join(cache, 'build');
execFileSync('swift', ['build', '-c', 'release', '--product', 'voice-pack-batch', '--package-path', join(here, 'host'), '--scratch-path', scratch], { env, stdio: 'inherit' });
const binaryRoot = execFileSync('swift', ['build', '-c', 'release', '--show-bin-path', '--package-path', join(here, 'host'), '--scratch-path', scratch], { env, encoding: 'utf8' }).trim();
// The selected runtime is explicitly offline; additionally deny host network for generation.
execFileSync('sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', join(binaryRoot, 'voice-pack-batch'), prepared.assets, input, raw], { env, stdio: 'inherit' });
const clips = inventory.map(prompt => {
  const data = readFileSync(join(raw, `${prompt.id}.wav`)), decoded = decodeWav(data), rawMetrics = pcmMetrics(decoded.samples);
  if (decoded.durationSeconds >= 14.8 || rawMetrics.rms <= .002 || rawMetrics.first20msPeak > .04 || rawMetrics.last20msPeak > .04) throw new Error(`Inspect possible silent/truncated/overlong raw output: ${prompt.id}`);
  // Fixed gain across the whole pack; no concatenation, time stretching, or invented timings.
  const normalized = decoded.samples.map(value => Math.round(value * .70));
  const wav = encodeWav(normalized), metrics = pcmMetrics(normalized);
  if (metrics.peak > .701 || metrics.fullScaleSamples !== 0) throw new Error(`Headroom failed: ${prompt.id}`);
  return { ...prompt, textSHA256: sha256(prompt.text), path: `${prompt.id}.wav`, sha256: sha256(wav), bytes: wav.length,
    durationSeconds: decoded.durationSeconds, format: { encoding: 'PCM', channels: 1, sampleRate: 24000, bitsPerSample: 16 }, metrics,
    generation: { rawWavSHA256: sha256(data), fixedGain: .70, rawMetrics, endpointReview: 'Measured raw 20ms endpoint peaks below 0.04; short complete whole utterance; human completeness/listening review still required' }, wav };
});
const pack = join(projectRoot, 'public/voice/en'); mkdirSync(pack, { recursive: true });
for (const name of readdirSync(pack)) if (name.endsWith('.wav')) rmSync(join(pack, name));
for (const clip of clips) writeFileSync(join(pack, clip.path), clip.wav);
const noticeNames = ['FluidAudio-LICENSE', 'Kokoro-LICENSE', 'G2P-LICENSE', 'Misaki-LICENSE', 'fastcluster-LICENSE.md', 'vbx-LICENSE.md'];
writeFileSync(join(pack, 'LICENSE.txt'), noticeNames.map(name => `===== ${name} =====\n` + readFileSync(join(here, 'licenses', name), 'utf8')).join('\n\n'));
writeFileSync(join(pack, 'NOTICES.txt'), readFileSync(join(here, 'licenses/NOTICES.txt')));
const provenanceFiles = [...readdirSync(join(here, 'licenses')).map(name => `licenses/${name}`), 'model-assets.json', 'offline-sdk.patch', 'sdk-patch-manifest.json', 'host/Package.swift', 'host/Sources/ProbeCore/AssetVerifier.swift', 'host/Sources/ProbeCore/ProbeBackend.swift', 'host/Sources/ProbeCore/ProbeLog.swift', 'host/Sources/VoicePackBatch/Batch.swift', 'prepare.py', 'regenerate.mjs', 'inventory.mjs', 'wav.mjs'];
const manifest = { schemaVersion: 1, mode: 'bundled-english-assistant-prompt-clips', language: 'en', voice: 'af_heart', model: 'Kokoro-82M CoreML v1', assetLicense: 'Project-generated audio assets; model/SDK licenses do not automatically license every generated output. See NOTICES.txt.',
  inventorySHA256: inventorySHA256(inventory), source: 'src/lib/assistant-copy.ts English authored exports; whole utterances only', sourceFileSHA256AtGeneration: sha256(readFileSync(join(projectRoot, 'src/lib/assistant-copy.ts'))),
  settings: { variant: 'kokoro_21_15s.mlmodelc', voiceSpeed: 1, deEss: true, computeUnits: 'cpuAndGPU requested; actual placement UNVERIFIED', g2pComputeUnits: 'cpuOnly', normalization: 'Fixed linear gain 0.70 on every original PCM16 sample; no trim, stitch, resample, or padding' },
  pins: { sdkRevision: 'b10bdcb51dcfeedb8001353b4ba363da1a616d6d', modelRevision: 'e61d9ee79a01ad4ebf6b3d8bcfe2a03f6b8da105', originalKokoroConversionRevision: 'UNVERIFIED', originalG2PConversionRevision: 'UNVERIFIED', lexiconGeneratingMisakiRevision: 'UNVERIFIED' },
  regeneration: { command: 'node scripts/voice-pack/regenerate.mjs', platform: 'Apple Silicon macOS 14+ with full Xcode, Swift 6 and Python 3.12+; public pinned downloads only', toolchain: { swift: execFileSync('swift', ['--version'], { encoding: 'utf8' }).trim(), xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim(), os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() }, reproducibility: 'Same pinned recipe and verified inputs; Core ML inference is not asserted bitwise deterministic across OS/hardware versions', provenanceFiles: Object.fromEntries(provenanceFiles.map(path => [path, sha256(readFileSync(join(here, path)))])) },
  notices: Object.fromEntries(['LICENSE.txt', 'NOTICES.txt'].map(name => [name, sha256(readFileSync(join(pack, name)))])),
  totalWavBytes: clips.reduce((sum, clip) => sum + clip.bytes, 0), clips: clips.map(({ wav, ...clip }) => clip) };
writeFileSync(join(pack, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const plugin = join(projectRoot, 'ios/App/App/FixListAssistantPlugin.swift'), source = readFileSync(plugin, 'utf8');
const catalog = `// BEGIN GENERATED ENGLISH PROMPT CATALOG\n    static let manifestSHA256 = "${sha256(readFileSync(join(pack, 'manifest.json')))}"\n    static let texts: Set<String> = ${JSON.stringify(inventory.map(clip => clip.text), null, 4)}\n    // END GENERATED ENGLISH PROMPT CATALOG`;
if (!source.includes('// BEGIN GENERATED ENGLISH PROMPT CATALOG')) throw new Error('Production prompt helper/catalog marker missing');
writeFileSync(plugin, source.replace(/\/\/ BEGIN GENERATED ENGLISH PROMPT CATALOG[\s\S]*?\/\/ END GENERATED ENGLISH PROMPT CATALOG/, catalog));
console.log(`Generated ${clips.length} clips, ${manifest.totalWavBytes} bytes. Run node scripts/voice-pack/verify.mjs before building.`);
