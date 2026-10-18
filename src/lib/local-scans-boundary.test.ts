/// <reference types="node" />
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, preview, type InlineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';

// Keep the Node-only config outside the browser tsconfig project, as in the handler tests.
const configPath = '../../vite.config.ts';
const { localScansPlugin } = await import(configPath) as { localScansPlugin: () => Plugin };

let temporary = '', project = '', allowed = '', outside = '';
let dev: ViteDevServer | undefined, built: PreviewServer | undefined;
const urls = { dev: '', preview: '' };
const nativeBody = '{"synthetic":"private native asset"}';
const captureBody = 'Synthetic private source';
const scanBody = 'Synthetic ios scan';

beforeAll(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), 'fixlist-vite-boundary-')));
  project = join(temporary, 'project');
  allowed = join(temporary, 'allowed');
  outside = join(temporary, 'project-outside');
  const captures = join(project, 'private-captures');
  const native = join(project, 'ios/App/App/public/local-scans');
  await mkdir(join(captures, 'scans/ios'), { recursive: true });
  await mkdir(join(native, 'room'), { recursive: true });
  await mkdir(join(project, 'public'), { recursive: true });
  await mkdir(join(project, 'safe'), { recursive: true });
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(captures, 'source.txt'), captureBody);
  await writeFile(join(captures, 'scans/ios/scene.splat'), scanBody);
  await writeFile(join(native, 'room/scene.json'), nativeBody);
  await writeFile(join(project, 'safe/ordinary.json'), '{"synthetic":"ordinary"}');
  await writeFile(join(project, 'public/public-asset.txt'), 'Synthetic public asset');
  await writeFile(join(allowed, 'ordinary.json'), 'Synthetic allowed asset');
  await writeFile(join(outside, 'secret.json'), 'Synthetic outside asset');
  // The final target is ordinary, but an existing ancestor passes through private assets.
  await symlink(join(project, 'safe'), join(native, 'egress'));
  for (const servingRoot of [project, join(project, 'dist')]) {
    await mkdir(servingRoot, { recursive: true });
    await writeFile(join(servingRoot, 'index.html'), '<!doctype html><title>Synthetic app</title>');
    await writeFile(join(servingRoot, 'iosomething'), 'Synthetic legitimate asset');
    await symlink(native, join(servingRoot, 'native-alias'));
    await symlink(captures, join(servingRoot, 'capture-alias'));
    await symlink(join(native, 'room/scene.json'), join(servingRoot, 'native-file.json'));
    await symlink(join(servingRoot, 'native-alias'), join(servingRoot, 'chained-alias'));
    await symlink(join(project, 'safe'), join(servingRoot, 'safe-alias'));
  }
  await symlink(native, join(project, 'public/public-native-alias'));
  await symlink(outside, join(project, 'outside-alias'));
  const options = (): InlineConfig => ({
    configFile: false,
    root: project,
    logLevel: 'silent',
    plugins: [localScansPlugin()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, fs: { allow: [project, allowed] } },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  dev = await createServer(options());
  await dev.listen();
  built = await preview(options());
  for (const [mode, server] of [['dev', dev], ['preview', built]] as const) {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP listener.');
    urls[mode] = `http://127.0.0.1:${address.port}`;
  }
}, 20_000);

afterAll(async () => {
  try { await Promise.all([dev?.close(), built?.close()]); }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
});

describe.each(['dev', 'preview'] as const)('real Vite %s private-file boundary', (mode) => {
  it.each([
    '/native-alias/room/scene.json',
    '/native%252dalias/room/scene.json',
    '/native-file.json',
    '/chained-alias/room/scene.json',
    '/capture-alias/source.txt',
    '/native-alias/missing/scene.json',
    '/native-alias/egress/ordinary.json',
  ])('returns 404 before ordinary static/SPA serving: %s', async (path) => {
    for (const headers of [{}, { origin: 'https://external.example', 'sec-fetch-site': 'cross-site' }]) {
      const response = await fetch(urls[mode] + path, { headers });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found.');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it.each(['native-alias/room/scene.json', 'capture-alias/source.txt', 'native-file.json'])('blocks /@fs aliases: %s', async (path) => {
    for (const servingRoot of [project, join(project, 'dist')]) {
      for (const prefix of ['/@fs', '/@fs/']) {
        const response = await fetch(urls[mode] + prefix + join(servingRoot, path));
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not found.');
      }
    }
  });

  it('loads the listed scan named ios through its dedicated route', async () => {
    const index = await fetch(urls[mode] + '/local-scans/index.json');
    expect(index.status).toBe(200);
    expect(await index.json()).toEqual([{ name: 'ios', sizes: { 'scene.splat': scanBody.length, 'scene.json': null, 'suggestions.json': null } }]);
    const scan = await fetch(urls[mode] + '/local-scans/ios/scene.splat');
    expect(scan.status).toBe(200);
    expect(await scan.text()).toBe(scanBody);
    expect(scan.headers.get('content-type')).toBe('application/octet-stream');
    const crossSite = await fetch(urls[mode] + '/local-scans/ios/scene.splat', { headers: { origin: 'https://external.example', 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
  });

  it('preserves iosomething, ordinary symlinks and normal app routes', async () => {
    const asset = await fetch(urls[mode] + '/iosomething');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('Synthetic legitimate asset');
    const ordinary = await fetch(urls[mode] + '/safe-alias/ordinary.json');
    expect(ordinary.status).toBe(200);
    expect(await ordinary.json()).toEqual({ synthetic: 'ordinary' });
    for (const path of ['/', '/household']) {
      const response = await fetch(urls[mode] + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Synthetic app</title>');
    }
  });
});

describe('real Vite development public and /@fs roots', () => {
  it('blocks private aliases in publicDir while preserving public assets', async () => {
    const blocked = await fetch(urls.dev + '/public-native-alias/room/scene.json');
    expect(blocked.status).toBe(404);
    expect(await blocked.text()).toBe('Not found.');
    const ordinary = await fetch(urls.dev + '/public-asset.txt');
    expect(ordinary.status).toBe(200);
    expect(await ordinary.text()).toBe('Synthetic public asset');
  });

  it.each(['direct', 'symlink', 'missing descendant'])('refuses /@fs outside the configured allow roots: %s', async (kind) => {
    const path = kind === 'direct' ? join(outside, 'secret.json') : join(project, 'outside-alias', kind === 'symlink' ? 'secret.json' : 'missing/secret.json');
    const response = await fetch(urls.dev + '/@fs' + path);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found.');
  });

  it('preserves /@fs files in the configured project and additional allow roots', async () => {
    for (const [path, body] of [[join(project, 'safe/ordinary.json'), '{"synthetic":"ordinary"}'], [join(allowed, 'ordinary.json'), 'Synthetic allowed asset']] as const) {
      const response = await fetch(urls.dev + '/@fs' + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    }
  });
});
