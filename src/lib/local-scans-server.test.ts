/// <reference types="node" />
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Dynamic path avoids adding the Node-only Vite config to the browser tsconfig project.
const configPath = '../../vite.config.ts';
const config = await import(configPath) as {
  default: (env: { command: string; mode: string }) => { server: { fs: { strict: boolean; deny: string[] } } };
  parseLocalScanRequest: (path: string) => { kind: string; name?: string; file?: string } | null;
  createLocalScansHandler: (root: string) => (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
  localScansPlugin: () => Record<string, unknown>;
};

class ResponseCapture extends Writable {
  statusCode = 200;
  headersSent = false;
  headers = new Map<string, string>();
  chunks: Buffer[] = [];
  setHeader(name: string, value: string | number) { this.headers.set(name.toLowerCase(), String(value)); }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); callback(); }
}
let temporary = '', root = '';
beforeEach(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), 'fixlist-local-scans-')));
  root = join(temporary, 'scans');
  await mkdir(join(root, 'room-1'), { recursive: true });
  await writeFile(join(root, 'room-1', 'scene.splat'), new Uint8Array(32));
  await writeFile(join(root, 'room-1', 'scene.json'), '{}');
  await writeFile(join(root, 'room-1', 'suggestions.json'), '{}');
  await writeFile(join(root, 'room-1', 'private.txt'), 'Synthetic forbidden file');
});
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function request(url: string, method = 'GET', headers: Record<string, string> = {}) {
  const response = new ResponseCapture();
  const done = new Promise<void>((resolve, reject) => { response.on('finish', resolve); response.on('error', reject); });
  let passed = false;
  await config.createLocalScansHandler(root)({ url, method, headers: { host: '127.0.0.1:5173', ...headers } } as IncomingMessage, response as unknown as ServerResponse, () => { passed = true; response.end(); });
  await done;
  return { status: response.statusCode, headers: response.headers, body: Buffer.concat(response.chunks), passed };
}

describe('dev/preview local scans middleware path boundary', () => {
  it.each([
    '/local-scans/../scene.splat', '/local-scans/room-1/../../secret', '/local-scans/%2e%2e/scene.splat',
    '/local-scans/room%2f1/scene.splat', '/local-scans/room%5c1/scene.splat', '/local-scans/%252e%252e/scene.splat',
    '/local-scans/room-1/private.txt', '/local-scans/room-1/scene.splat/extra', '/local-scans/room-1/%00scene.splat',
    '/local-scans//scene.splat', '/local-scans/room-1/scene.splat%3Ffoo', '/local-scans/%E0%A4%A/scene.splat',
  ])('rejects traversal, nonallowlisted files and malformed paths: %s', async (url) => {
    expect(config.parseLocalScanRequest(url)?.kind).toBe('invalid');
    const response = await request(url);
    expect(response.status).toBe(400);
    expect(response.body.toString()).toBe('Invalid local scan path.');
  });
  it('passes unrelated URLs on and allows only exact local scan paths', async () => {
    expect(config.parseLocalScanRequest('/assets/index.js')).toBeNull();
    expect((await request('/assets/index.js')).passed).toBe(true);
    expect(config.parseLocalScanRequest('/local-scans/room-1/scene.json?cache=1')).toEqual({ kind: 'file', name: 'room-1', file: 'scene.json' });
  });
  it('lists bounded file sizes and which optional files exist, without file contents', async () => {
    await mkdir(join(root, 'empty-room'));
    await mkdir(join(root, 'room-2'));
    await writeFile(join(root, 'room-2', 'scene.splat'), new Uint8Array(64));
    const response = await request('/local-scans/index.json');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.toString())).toEqual([
      { name: 'room-1', sizes: { 'scene.splat': 32, 'scene.json': 2, 'suggestions.json': 2 } },
      { name: 'room-2', sizes: { 'scene.splat': 64, 'scene.json': null, 'suggestions.json': null } },
    ]);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('serves exactly the three allowlisted files with correct types', async () => {
    for (const file of ['scene.splat', 'scene.json', 'suggestions.json']) {
      const response = await request(`/local-scans/room-1/${file}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(await readFile(join(root, 'room-1', file)));
      expect(response.headers.get('content-type')).toBe(file === 'scene.splat' ? 'application/octet-stream' : 'application/json; charset=utf-8');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
  it('rejects writes, cross-origin requests and missing scans without falling through to the SPA', async () => {
    expect((await request('/local-scans/index.json', 'POST')).status).toBe(405);
    expect((await request('/local-scans/index.json', 'GET', { origin: 'https://external.example' })).status).toBe(403);
    expect((await request('/local-scans/index.json', 'GET', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await request('/local-scans/missing/scene.splat')).status).toBe(404);
    expect((await request('/local-scans/index.json', 'GET', { origin: 'http://127.0.0.1:5173' })).status).toBe(200);
  });
  it('does not expose symlinked folders, files, or capture roots', async () => {
    await symlink(join(root, 'room-1'), join(root, 'linked-room'));
    expect((await request('/local-scans/linked-room/scene.splat')).status).toBe(404);
    await mkdir(join(root, 'linked-file'));
    await symlink(join(root, 'room-1', 'scene.splat'), join(root, 'linked-file', 'scene.splat'));
    expect((await request('/local-scans/linked-file/scene.splat')).status).toBe(404);
    expect(JSON.parse((await request('/local-scans/index.json')).body.toString())).toHaveLength(1);
    const original = root;
    root = join(temporary, 'symlinked-scans'); await symlink(original, root);
    expect((await request('/local-scans/index.json')).status).toBe(404);
  });
  it('registers server and preview hooks and a validation-only build hook, never an asset-emitting one', () => {
    const plugin = config.localScansPlugin();
    expect(typeof plugin.configureServer).toBe('function'); expect(typeof plugin.configurePreviewServer).toBe('function');
    // buildStart only refuses unsafe public/ symlinks; nothing may emit or copy scan files into a build.
    expect(typeof plugin.buildStart).toBe('function');
    expect(plugin.generateBundle).toBeUndefined(); expect(plugin.writeBundle).toBeUndefined(); expect(plugin.renderChunk).toBeUndefined(); expect(plugin.resolveId).toBeUndefined(); expect(plugin.load).toBeUndefined();
  });
});

describe('ordinary Vite file serving cannot bypass the local-scans allowlist', () => {
  it('retains all installed Vite defaults and denies capture files', () => {
    const { server } = config.default({ command: 'serve', mode: 'development' });
    expect(server.fs.strict).toBe(true);
    expect(server.fs.deny).toEqual(expect.arrayContaining([
      '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/private-captures/**', '**/ios/**',
    ]));
  });
});
