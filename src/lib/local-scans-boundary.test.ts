/// <reference types="node" />
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, preview, type InlineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the Node-only config outside the browser tsconfig project, as in the handler tests.
const configPath = '../../vite.config.ts';
const { localScansPlugin } = await import(configPath) as { localScansPlugin: () => Plugin };

let temporary = '', project = '', allowed = '', outside = '';
let dev: ViteDevServer | undefined, built: PreviewServer | undefined;
const urls = { dev: '', preview: '' };
const nativeBody = '{"synthetic":"private native asset"}';
const captureBody = 'Synthetic private source';
const scanBody = 'Synthetic ios scan';

// fetch normalizes dot segments and drops fragments; send the exact wire target.
async function rawRequest(base: string, path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(base, { path }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

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
  await mkdir(join(project, 'src'), { recursive: true });
  await mkdir(join(project, 'node_modules/.vite/deps'), { recursive: true });
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(captures, 'source.txt'), captureBody);
  await writeFile(join(captures, 'scans/ios/scene.splat'), scanBody);
  await writeFile(join(native, 'room/scene.json'), nativeBody);
  await writeFile(join(project, 'safe/ordinary.json'), '{"synthetic":"ordinary"}');
  await writeFile(join(project, 'public/public-asset.txt'), 'Synthetic public asset');
  await writeFile(join(project, 'public/favicon.svg'), '<svg><title>Synthetic favicon</title></svg>');
  await writeFile(join(project, 'src/main.tsx'), 'export const synthetic = "Synthetic source";');
  await mkdir(join(project, 'scan'));
  await writeFile(join(project, 'scan/hazard-questions.json'), '{"synthetic":"photo catalog"}');
  await writeFile(join(project, 'scan/suggest.py'), 'synthetic = "pipeline source"');
  await writeFile(join(project, 'node_modules/.vite/deps/synthetic.js'), 'export const dependency = "Synthetic dependency";');
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
    await mkdir(join(servingRoot, 'safe-directory'));
    await symlink(join(native, 'room/scene.json'), join(servingRoot, 'safe-directory/index.html'));
    await symlink(join(native, 'room/scene.json'), join(servingRoot, 'extension-alias.html'));
    await symlink(join(native, 'room/scene.json'), join(servingRoot, 'file-alias.json'));
  }
  await mkdir(join(project, 'dist/assets'));
  await writeFile(join(project, 'dist/assets/synthetic.js'), 'console.log("Synthetic built asset");');
  // A build copies a public/ symlink target into dist as a regular file.
  await mkdir(join(project, 'public/assets'), { recursive: true });
  await symlink(join(native, 'room/scene.json'), join(project, 'public/assets/copied-private.txt'));
  await writeFile(join(project, 'dist/assets/copied-private.txt'), nativeBody);
  await writeFile(join(project, 'dist/favicon.svg'), '<svg><title>Synthetic favicon</title></svg>');
  await writeFile(join(project, 'dist/public-asset.txt'), 'Synthetic public asset');
  // A copied dist file cannot make an unsafe source symlink an allowed public URL.
  await writeFile(join(project, 'dist/private-file.json'), nativeBody);
  await writeFile(join(project, 'dist/private-egress.json'), nativeBody);
  // Exercise canonical checks inside each otherwise allowed static family.
  for (const family of ['src', 'node_modules', 'public', 'dist/assets']) {
    const familyRoot = join(project, family);
    await symlink(join(native, 'room/scene.json'), join(familyRoot, 'private-file.json'));
    await symlink(join(native, 'egress/ordinary.json'), join(familyRoot, 'private-egress.json'));
    await mkdir(join(familyRoot, 'safe-directory'));
    await symlink(join(native, 'room/scene.json'), join(familyRoot, 'safe-directory/index.html'));
    await symlink(join(native, 'room/scene.json'), join(familyRoot, 'extension-alias.html'));
  }
  await symlink(native, join(project, 'public/public-native-alias'));
  await symlink(join(project, 'public/public-asset.txt'), join(project, 'public/public-file-alias.txt'));
  await writeFile(join(project, 'dist/public-file-alias.txt'), 'Synthetic public asset');
  for (const servingRoot of ['public', 'dist']) {
    await mkdir(join(project, servingRoot, 'demo/ios'), { recursive: true });
    await writeFile(join(project, servingRoot, 'demo/ios/ordinary.json'), '{"synthetic":"public demo"}');
  }
  await symlink(outside, join(project, 'outside-alias'));
  const virtualModule: Plugin = {
    name: 'synthetic-virtual-module',
    resolveId(id) { if (id === '\0synthetic') return id; },
    load(id) { if (id === '\0synthetic') return 'export const virtual = "Synthetic virtual module";'; },
  };
  // Internal route families must not expose HTML fallbacks either.
  for (const family of ['@id', '@vite']) {
    await mkdir(join(project, family, 'safe-directory'), { recursive: true });
    await symlink(join(native, 'room/scene.json'), join(project, family, 'safe-directory/index.html'));
    await symlink(join(native, 'room/scene.json'), join(project, family, 'extension-alias.html'));
  }
  const options = (): InlineConfig => ({
    configFile: false,
    root: project,
    // Keep optimizer housekeeping separate from the synthetic dependency fixture.
    cacheDir: join(temporary, 'vite-cache'),
    logLevel: 'silent',
    plugins: [react(), localScansPlugin(), virtualModule],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null, fs: { strict: true, allow: [project, allowed] } },
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
    '/private-captures/source.txt', '/private-captures/scans/ios/scene.splat',
    '/%70rivate-captures/source.txt', '/%2570rivate-captures%252fsource.txt', '/PRIVATE-CAPTURES/source.txt',
    '/ios/App/App/public/local-scans/room/scene.json', '/%69os/App/App/public/local-scans/room/scene.json',
    '/%2569os%252fApp%252fApp%252fpublic/local-scans/room/scene.json', '/IOS/App/App/public/local-scans/room/scene.json',
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

  it.each([
    '/safe-directory/', '/safe-directory/?cache=1', '/SAFE-DIRECTORY/',
    '/extension-alias', '/extension-alias?cache=1', '/EXTENSION-ALIAS',
    '/file-alias.json#ignored', '/file-alias.json?cache=1#ignored',
    '/favicon.svg#ignored', '/favicon.svg%23ignored',
    '/src/../index.html', '/src/%2e%2e/index.html', '/src/%252e%252e/index.html',
    '/src/./main.tsx', '/src/%2e/main.tsx', '/src/%252e/main.tsx',
    '/src\\main.tsx', '/src/%255cmain.tsx', '/src/%2500main.tsx',
    '/favicon.svg?bad=\\', '/%E0%A4%A', '/favicon.svg%3Fignored',
    '/household', '/iosomething', '/safe-alias/ordinary.json',
    '/SRC/main.tsx', '/FAVICON.svg',
    '/src/safe-directory/', '/src/extension-alias', '/src/private-file.json', '/src/private-egress.json',
    '/node_modules/safe-directory/', '/node_modules/extension-alias', '/node_modules/private-file.json', '/node_modules/private-egress.json',
    '/assets/safe-directory/', '/assets/extension-alias', '/assets/private-file.json', '/assets/private-egress.json',
    '/private-file.json', '/private-egress.json',
    '/@id/safe-directory/', '/@id/extension-alias', '/@id/extension-alias.html',
    '/@vite/safe-directory/', '/@vite/extension-alias', '/@vite/extension-alias.html',
  ])('rejects fallback aliases and nonallowlisted wire targets: %s', async (path) => {
    const response = await rawRequest(urls[mode], path);
    expect(response.status).toBe(404);
    expect(response.body).toBe('Not found.');
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

  it('preserves exact app entry points, query strings and public files', async () => {
    for (const path of ['/', '/index.html', '/?localScan=x', '/?localScan=viennese-v2#scan-heading']) {
      const response = await fetch(urls[mode] + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Synthetic app</title>');
    }
    const favicon = await fetch(urls[mode] + '/favicon.svg');
    expect(favicon.status).toBe(200);
    expect(await favicon.text()).toContain('Synthetic favicon');
    for (const path of ['/public-asset.txt', '/public-file-alias.txt']) {
      const publicAsset = await fetch(urls[mode] + path);
      expect(publicAsset.status).toBe(200);
      expect(await publicAsset.text()).toBe('Synthetic public asset');
    }
    const demo = await fetch(urls[mode] + '/demo/ios/ordinary.json');
    expect(demo.status).toBe(200);
    expect(await demo.json()).toEqual({ synthetic: 'public demo' });
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

  it('refuses /@fs project files and additional fs.allow roots outside src/node_modules', async () => {
    for (const path of [join(project, 'safe/ordinary.json'), join(allowed, 'ordinary.json')]) {
      const response = await fetch(urls.dev + '/@fs' + path);
      expect(response.status).toBe(404);
    }
  });

  it.each(['/src/main.tsx', '/@vite/client', '/@react-refresh', '/@id/__x00__synthetic', '/node_modules/.vite/deps/synthetic.js'])('preserves development modules: %s', async (path) => {
    const response = await fetch(urls.dev + path);
    expect(response.status).toBe(200);
    expect(/Synthetic|WebSocket|performReactRefresh/.test(await response.text())).toBe(true);
  });

  it('preserves /@fs inside src and node_modules', async () => {
    for (const path of [join(project, 'src/main.tsx'), join(project, 'node_modules/.vite/deps/synthetic.js')]) {
      const response = await fetch(urls.dev + '/@fs' + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Synthetic');
    }
  });

  it('preserves the Vite HMR websocket upgrade path', async () => {
    const socket = new WebSocket(urls.dev.replace('http:', 'ws:'), 'vite-hmr');
    try {
      const message = await new Promise<string>((resolve, reject) => {
        socket.addEventListener('message', (event) => resolve(String(event.data)), { once: true });
        socket.addEventListener('error', () => reject(new Error('HMR websocket connection failed.')), { once: true });
      });
      expect(JSON.parse(message)).toEqual({ type: 'connected' });
    } finally { socket.close(); }
  });
});

describe('real Vite preview assets', () => {
  it('serves built assets', async () => {
    const response = await fetch(urls.preview + '/assets/synthetic.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Synthetic built asset');
  });

  it.each(['/src/main.tsx', '/@vite/client', '/@id/synthetic', '/@react-refresh', '/node_modules/.vite/deps/synthetic.js'])('refuses development-only routes: %s', async (path) => {
    expect((await fetch(urls.preview + path)).status).toBe(404);
  });
});

describe('photo catalog import and copied public assets', () => {
  it('serves the trusted photo-question catalog to the dev module graph only', async () => {
    const catalog = await fetch(urls.dev + '/scan/hazard-questions.json?import');
    expect(catalog.status).toBe(200);
    expect(await catalog.text()).toContain('photo catalog');
    for (const path of ['/scan/suggest.py', '/scan/', '/scan']) expect((await rawRequest(urls.dev, path)).status).toBe(404);
    expect((await fetch(urls.preview + '/scan/hazard-questions.json')).status).toBe(404);
  });

  it('refuses a preview asset copied from an unsafe public symlink', async () => {
    const copied = await fetch(urls.preview + '/assets/copied-private.txt');
    expect(copied.status).toBe(404);
    expect(await copied.text()).not.toContain(nativeBody);
    expect((await fetch(urls.preview + '/assets/synthetic.js')).status).toBe(200);
  });
});
