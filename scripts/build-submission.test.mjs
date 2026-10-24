import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, createServer, preview } from 'vite';
import viteConfig from '../vite.config.ts';
import { buildSubmission, submissionEnvironment } from './build-submission.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const temporary = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('submission release commands', () => {
  it('removes all inherited VITE inputs without changing the caller environment', async () => {
    const env = { PATH: '/bin', HOME: '/synthetic', VITE_SUPABASE_URL: 'private-project', VITE_SUPABASE_PUBLISHABLE_KEY: 'private-key', VITE_AUTH_GOOGLE_ENABLED: 'true', VITE_PRIVATE_CANARY: 'canary', vite_lowercase: 'canary' };
    expect(submissionEnvironment(env)).toEqual({ PATH: '/bin', HOME: '/synthetic' });
    const run = vi.fn().mockResolvedValue(undefined);
    await buildSubmission({ env, run });
    expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
      [process.execPath, join(projectRoot, 'node_modules/typescript/bin/tsc'), '-b'],
      [process.execPath, join(projectRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'submission'],
    ]);
    for (const [, , options] of run.mock.calls) expect(options).toEqual({ cwd: projectRoot, env: { PATH: '/bin', HOME: '/synthetic' } });
    expect(env.VITE_SUPABASE_URL).toBe('private-project');
  });

  it('verifies the native model, typechecks, builds submission, then syncs that artifact only', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await buildSubmission({ ios: true, env: { PATH: '/bin', VITE_PRIVATE_CANARY: 'canary' }, run });
    expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
      ['/bin/sh', join(projectRoot, 'scripts/verify-ios-model.sh')],
      [process.execPath, join(projectRoot, 'node_modules/typescript/bin/tsc'), '-b'],
      [process.execPath, join(projectRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'submission'],
      [process.execPath, join(projectRoot, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'ios'],
    ]);
    expect(run.mock.calls[3][2].env).toEqual({ PATH: '/bin', FIXLIST_SUBMISSION: '1' });
    expect(run.mock.calls[0][2].env).toEqual({ PATH: '/bin' });
  });

  it.each([0, 1, 2, 3])('stops the native release when step %i fails', async failure => {
    const cause = new Error('controlled release failure');
    const run = vi.fn(async () => { if (run.mock.calls.length === failure + 1) throw cause; });
    await expect(buildSubmission({ ios: true, run })).rejects.toBe(cause);
    expect(run).toHaveBeenCalledTimes(failure + 1);
  });

  it('never starts bundling after a failed web typecheck', async () => {
    const run = vi.fn().mockRejectedValue(new Error('typecheck failed'));
    await expect(buildSubmission({ run })).rejects.toThrow('typecheck failed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary build/sync commands and pins submission preview locally', async () => {
    const { scripts } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    expect(scripts.build).toBe('tsc -b && vite build');
    expect(scripts['ios:sync']).toBe('npm run ios:model:check && npm run build && cap sync ios');
    expect(scripts['build:submission']).toBe('node scripts/build-submission.mjs');
    expect(scripts['ios:submission']).toBe('node scripts/build-submission.mjs --ios');
    expect(scripts['preview:submission']).toBe('vite preview --mode submission --outDir dist-submission --host 127.0.0.1 --port 4173 --strictPort');
  });

  it('the installed Capacitor CLI resolves each artifact without editing its JSON config', async () => {
    const path = join(projectRoot, 'capacitor.config.json'), original = await readFile(path, 'utf8');
    const command = join(projectRoot, 'node_modules/@capacitor/cli/bin/capacitor');
    for (const [flag, webDir] of [['0', 'dist'], ['1', 'dist-submission']]) {
      const { stdout } = await promisify(execFile)(process.execPath, [command, 'config', '--json'], {
        cwd: projectRoot, env: { ...process.env, FIXLIST_SUBMISSION: flag },
      });
      const config = JSON.parse(stdout);
      expect(config.app.webDir).toBe(webDir);
      expect(config.app.extConfig).toEqual({ ...JSON.parse(original), webDir });
    }
    expect(await readFile(path, 'utf8')).toBe(original);
  });
});

describe('submission Vite boundary', () => {
  it('changes only submission config and leaves ordinary env/auth configuration available', () => {
    const submission = viteConfig({ command: 'build', mode: 'submission' });
    expect(submission).toMatchObject({ envDir: false, envPrefix: [], base: './', build: { outDir: 'dist-submission', sourcemap: false } });
    for (const mode of ['production', 'development']) {
      const ordinary = viteConfig({ command: 'build', mode });
      expect(ordinary.envDir).toBeUndefined();
      expect(ordinary.envPrefix).toBeUndefined();
      expect(ordinary.build).toBeUndefined();
    }
  });

  it('excludes real env files and inherited canaries from emitted JS and closes local-scans in dev/preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fixlist-submission-')); temporary.push(root);
    await mkdir(join(root, 'public'));
    await mkdir(join(root, 'private-captures/scans/secret-room'), { recursive: true });
    await writeFile(join(root, 'private-captures/scans/secret-room/scene.splat'), 'PRIVATE_SCAN_CANARY');
    await writeFile(join(root, 'index.html'), '<html><script type="module" src="/entry.js"></script></html>');
    await writeFile(join(root, 'entry.js'), 'document.body.textContent = JSON.stringify(import.meta.env);');
    for (const name of ['.env', '.env.local', '.env.submission', '.env.submission.local']) {
      await writeFile(join(root, name), `VITE_${name.replaceAll('.', '_').toUpperCase()}=FILE_ENV_CANARY\nVITE_SUPABASE_URL=https://file-canary.supabase.co\n`);
    }
    vi.stubEnv('VITE_PRIVATE_CANARY', 'INHERITED_ENV_CANARY');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'INHERITED_KEY_CANARY');
    const config = { ...viteConfig({ command: 'build', mode: 'submission' }), configFile: false, root, mode: 'submission', logLevel: 'silent' };
    await build(config);
    const output = join(root, 'dist-submission');
    const assets = await readdir(join(output, 'assets'));
    const body = (await Promise.all(assets.map(name => readFile(join(output, 'assets', name), 'utf8')))).join('\n');
    expect(body).toContain('submission');
    expect(body).not.toMatch(/CANARY|VITE_|supabase\.co/);
    expect(assets.some(name => name.endsWith('.map'))).toBe(false);
    expect(await readdir(output)).toEqual(expect.arrayContaining(['index.html', 'assets']));
    expect(await readFile(join(output, 'index.html'), 'utf8')).toMatch(/src="\.\/assets\//);

    for (const mode of ['submission', 'development']) {
      const dev = await createServer({ ...config, mode, server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null } });
      try {
        await dev.listen();
        const response = await fetch(`${dev.resolvedUrls.local[0]}local-scans/index.json`);
        expect(response.status).toBe(mode === 'submission' ? 404 : 200);
        expect(await response.text()).toContain(mode === 'submission' ? 'Not found.' : 'secret-room');
      } finally { await dev.close(); }
    }
    const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    try {
      for (const path of ['local-scans/index.json', 'local-scans/secret-room/scene.splat', 'local-scans/%2573ecret-room/scene.splat', 'private-captures/scans/secret-room/scene.splat']) {
        const response = await fetch(`${server.resolvedUrls.local[0]}${path}`);
        expect(response.status, path).toBe(404);
        expect(await response.text()).not.toContain('PRIVATE_SCAN_CANARY');
      }
      expect((await fetch(server.resolvedUrls.local[0])).status).toBe(200);
    } finally { await server.close(); }
  }, 20000);
});
