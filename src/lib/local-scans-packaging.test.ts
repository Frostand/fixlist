import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { suggestionsV2Fixture } from './scan-suggestions.fixture';
const script = '../../scripts/ios-demo-scan.mjs';
interface Options { projectRoot: string; beforeInstall?: () => Promise<void> }
const { bundleScans, stageScans, installStaged } = await import(script) as {
  bundleScans: (names: string[], options: Options) => Promise<unknown>;
  stageScans: (names: string[], options: { projectRoot: string; stageDir?: string }) => Promise<{ directory: string; index: unknown[] }>;
  installStaged: (directory: string, options: Options) => Promise<unknown>;
};
let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });
async function setup() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fixlist-bundle-')));
  const source = join(root, 'private-captures/scans/room');
  const target = join(root, 'ios/App/App/public/local-scans');
  await mkdir(source, { recursive: true }); await mkdir(target, { recursive: true });
  await writeFile(join(target, 'previous.txt'), 'previous usable synthetic bundle');
  const bytes = Buffer.alloc(32);
  bytes.writeFloatLE(1, 12); bytes.writeFloatLE(1, 16); bytes.writeFloatLE(1, 20);
  bytes.set([255, 128, 128, 128], 28);
  await writeFile(join(source, 'scene.splat'), bytes);
  return { source, target, bytes };
}
async function prior(target: string) { expect(await readFile(join(target, 'previous.txt'), 'utf8')).toBe('previous usable synthetic bundle'); }
describe('private native scan packaging preflight and replacement', () => {
  it('packages a complete app-readable index', async () => {
    const { target } = await setup();
    await bundleScans(['room'], { projectRoot: root });
    expect(JSON.parse(await readFile(join(target, 'index.json'), 'utf8'))).toEqual([{ name: 'room', sizes: { 'scene.splat': 32, 'scene.json': null, 'suggestions.json': null } }]);
  });
  it.each([[], ['../bad'], ['room', 'room'], ['missing']].map((names) => ({ names })))('retains the previous bundle after invalid input $names', async ({ names }) => {
    const { target } = await setup();
    await expect(bundleScans(names, { projectRoot: root })).rejects.toThrow(); await prior(target);
  });
  it.each([Buffer.alloc(0), Buffer.alloc(32), Buffer.alloc(33)])('rejects zero/invalid/partial scans', async (bytes) => {
    const { source, target } = await setup(); await writeFile(join(source, 'scene.splat'), bytes);
    await expect(bundleScans(['room'], { projectRoot: root })).rejects.toThrow(); await prior(target);
  });
  it.each(['private-captures', 'private-captures/scans', 'private-captures/scans/room'])('rejects symlinked parent %s before reading any input', async (part) => {
    const { target } = await setup();
    const outside = join(root, 'outside'); await mkdir(outside);
    await rm(join(root, part), { recursive: true }); await symlink(outside, join(root, part));
    await expect(bundleScans(['room'], { projectRoot: root })).rejects.toThrow(/symlink/i); await prior(target);
  });
  it('rejects malformed metadata/suggestions before replacing output', async () => {
    const { source, target } = await setup();
    for (const name of ['scene.json', 'suggestions.json']) {
      await writeFile(join(source, name), '{}');
      await expect(bundleScans(['room'], { projectRoot: root })).rejects.toThrow(); await prior(target);
      await rm(join(source, name));
    }
  });
  it('rejects suggestions for another scene with the same splat count', async () => {
    const { source, target } = await setup();
    await writeFile(join(source, 'suggestions.json'), JSON.stringify(suggestionsV2Fixture()));
    await expect(bundleScans(['room'], { projectRoot: root })).rejects.toThrow(/content hash/); await prior(target);
  });
  it('packages suggestions when their hash is computed from the actual synthetic bytes', async () => {
    const { source, target, bytes } = await setup(); const suggestions = suggestionsV2Fixture();
    suggestions.scan.identity!.sceneSHA256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(source, 'suggestions.json'), JSON.stringify(suggestions));
    await bundleScans(['room'], { projectRoot: root });
    expect(JSON.parse(await readFile(join(target, 'room/suggestions.json'), 'utf8')).scan.identity.sceneSHA256).toBe(suggestions.scan.identity!.sceneSHA256);
  });
  it('rolls back the directory replacement if installation fails', async () => {
    const { target } = await setup();
    await expect(bundleScans(['room'], { projectRoot: root, beforeInstall: async () => { throw new Error('synthetic installation failure'); } })).rejects.toThrow('synthetic installation failure');
    await prior(target);
  });
  it('retains the previous bundle when the native atomic exchange fails', async () => {
    const { target } = await setup();
    await expect(bundleScans(['room'], { projectRoot: root, beforeInstall: async () => {
      const parent = join(root, 'ios/App/App/public');
      const stage = (await readdir(parent)).find((name) => name.startsWith('.local-scans-stage-'));
      if (!stage) throw new Error('Missing synthetic staging directory.');
      await rm(join(parent, stage, 'next'), { recursive: true });
    } })).rejects.toThrow();
    await prior(target);
  });
});

describe('staging across Capacitor web-directory replacement', () => {
  it('stages without native web assets and installs the same snapshot after simulated cap sync', async () => {
    const { target, bytes } = await setup(); const publicDir = join(root, 'ios/App/App/public');
    await rm(publicDir, { recursive: true });
    const stage = await stageScans(['room'], { projectRoot: root });
    await expect(readFile(join(target, 'index.json'))).rejects.toThrow();
    const manifest = JSON.parse(await readFile(join(stage.directory, 'stage.json'), 'utf8'));
    expect(manifest.files.find((entry: { path: string }) => entry.path === 'room/scene.splat').sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    // Sync copies the app web tree; original captures may then be unavailable.
    await rm(join(root, 'private-captures'), { recursive: true });
    await mkdir(publicDir); await writeFile(join(publicDir, 'index.html'), 'new synthetic web build');
    await installStaged(stage.directory, { projectRoot: root });
    expect(await readFile(join(target, 'room/scene.splat'))).toEqual(bytes);
    expect(await readFile(join(publicDir, 'index.html'), 'utf8')).toBe('new synthetic web build');
  });

  it('invalid input preserves the old native bundle and an earlier valid stage', async () => {
    const { source, target } = await setup(); const stage = await stageScans(['room'], { projectRoot: root });
    const original = await readFile(join(stage.directory, 'stage.json'));
    await writeFile(join(source, 'scene.splat'), Buffer.alloc(32));
    await expect(stageScans(['room'], { projectRoot: root })).rejects.toThrow();
    expect(await readFile(join(stage.directory, 'stage.json'))).toEqual(original); await prior(target);
  });

  it('replaces a known stage only after the new complete bundle validates', async () => {
    const { source, target, bytes } = await setup(); const stage = await stageScans(['room'], { projectRoot: root });
    const changed = Buffer.from(bytes); changed.writeFloatLE(2, 0); await writeFile(join(source, 'scene.splat'), changed);
    await stageScans(['room'], { projectRoot: root }); await prior(target);
    await installStaged(stage.directory, { projectRoot: root });
    expect(await readFile(join(target, 'room/scene.splat'))).toEqual(changed);
  });

  it.each(['changed-bytes', 'extra-file', 'symlink', 'rewritten-manifest'])('rejects tampered stage %s before native replacement', async (kind) => {
    const { target, bytes } = await setup(); const stage = await stageScans(['room'], { projectRoot: root });
    const scan = join(stage.directory, 'bundle/room/scene.splat');
    if (kind === 'extra-file') await writeFile(join(stage.directory, 'bundle/extra.txt'), 'unexpected');
    else if (kind === 'symlink') { await rm(scan); await symlink(join(root, 'private-captures/scans/room/scene.splat'), scan); }
    else {
      await writeFile(scan, Buffer.alloc(bytes.length));
      if (kind === 'rewritten-manifest') {
        const path = join(stage.directory, 'stage.json'); const manifest = JSON.parse(await readFile(path, 'utf8'));
        manifest.files.find((entry: { path: string }) => entry.path === 'room/scene.splat').sha256 = createHash('sha256').update(Buffer.alloc(bytes.length)).digest('hex');
        await writeFile(path, JSON.stringify(manifest));
      }
    }
    await expect(installStaged(stage.directory, { projectRoot: root })).rejects.toThrow(); await prior(target);
  });

  it.each(['public/stage', 'private-captures/stage', 'ios/App/App/public/stage', 'ios/DerivedData'])('refuses non-private staging path %s', async (stageDir) => {
    const { target } = await setup();
    await expect(stageScans(['room'], { projectRoot: root, stageDir })).rejects.toThrow(/Stage directories/); await prior(target);
  });

  it('does not replace an unrelated directory at a staging path', async () => {
    const { target } = await setup(); const directory = join(root, 'ios/DerivedData/fixlist-demo-scan-stage');
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'owner.txt'), 'preserve');
    await expect(stageScans(['room'], { projectRoot: root })).rejects.toThrow();
    expect(await readFile(join(directory, 'owner.txt'), 'utf8')).toBe('preserve'); await prior(target);
  });

  it('orders the npm workflow as stage, then sync, then staged install', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['ios:demo']).toBe('npm run ios:demo:stage && npm run ios:sync && npm run ios:demo:install');
    expect(pkg.scripts['ios:demo:stage']).toBe('node scripts/ios-demo-scan.mjs --stage ios/DerivedData/fixlist-demo-scan-stage viennese-v2');
    expect(pkg.scripts['ios:demo:install']).toBe('node scripts/ios-demo-scan.mjs --install-staged ios/DerivedData/fixlist-demo-scan-stage');
  });
});
