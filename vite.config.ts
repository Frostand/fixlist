import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

const allowedFiles = ['scene.splat', 'scene.json', 'suggestions.json'] as const;
type LocalScanFile = (typeof allowedFiles)[number];
const validName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name);
export function parseLocalScanRequest(url: string): { kind: 'index' } | { kind: 'file'; name: string; file: LocalScanFile } | { kind: 'invalid' } | null {
  // Never use URL pathname normalization: it can erase traversal before validation.
  const rawPath = url.split('?')[0] ?? '';
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return rawPath.startsWith('/local-scans') ? { kind: 'invalid' } : null; }
  if (path !== '/local-scans' && !path.startsWith('/local-scans/')) return null;
  if (path === '/local-scans/index.json') return { kind: 'index' };
  const parts = path.split('/');
  const name = parts[2], file = parts[3];
  if (parts.length !== 4 || !name || !validName(name) || !allowedFiles.includes(file as LocalScanFile)) return { kind: 'invalid' };
  return { kind: 'file', name, file: file as LocalScanFile };
}
/** Decode repeatedly so encoded separators, names and /@fs forms cannot bypass the boundary. */
export function isPrivateCaptureRequest(url: string): boolean {
  let path = url.split('?')[0] ?? '';
  for (let attempt = 0; attempt < 12; attempt++) {
    if (path.toLowerCase().includes('private-captures')) return true;
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    } catch {
      const decoded = path.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (decoded === path) return false;
      path = decoded;
    }
  }
  // Reject excessive nesting rather than passing it to another URL decoder.
  return true;
}
async function safeRoot(root: string) {
  // Do not follow symlinked private-captures/scans directories outside the project.
  if ((await lstat(root)).isSymbolicLink() || (await lstat(dirname(root))).isSymbolicLink()) throw new Error('Symlinked capture root.');
  return realpath(root);
}
async function safeFile(root: string, name: string, file: LocalScanFile) {
  const folder = join(root, name), path = join(folder, file);
  if ((await lstat(folder)).isSymbolicLink() || (await lstat(path)).isSymbolicLink()) throw new Error('Symlinked scan.');
  if (await realpath(path) !== path) throw new Error('File outside scan root.');
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > (file === 'scene.splat' ? 300 * 1024 * 1024 : file === 'scene.json' ? 64 * 1024 : 4 * 1024 * 1024)) throw new Error('Unsupported file size.');
  return { path, size: info.size };
}
export function createLocalScansHandler(capturesRoot: string) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    // Runs before Vite's static and /@fs handlers in both dev and preview.
    if (isPrivateCaptureRequest(request.url ?? '')) {
      response.statusCode = 404;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Not found.');
      return;
    }
    const route = parseLocalScanRequest(request.url ?? '');
    if (!route) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const finish = (status: number, message: string) => { response.statusCode = status; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(message); };
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); finish(405, 'GET only.'); return; }
    if (route.kind === 'invalid') { finish(400, 'Invalid local scan path.'); return; }
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)) { finish(403, 'Local same-origin requests only.'); return; }
    try {
      const root = await safeRoot(resolve(capturesRoot));
      if (route.kind === 'index') {
        const entries = await readdir(root, { withFileTypes: true });
        const scans = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory() || !validName(entry.name) || scans.length >= 100) continue;
          try {
            const splat = await safeFile(root, entry.name, 'scene.splat');
            const optionalSize = async (file: LocalScanFile) => { try { return (await safeFile(root, entry.name, file)).size; } catch { return null; } };
            const [metadata, suggestions] = await Promise.all([optionalSize('scene.json'), optionalSize('suggestions.json')]);
            scans.push({ name: entry.name, sizes: { 'scene.splat': splat.size, 'scene.json': metadata, 'suggestions.json': suggestions } });
          } catch { /* Missing, oversized or symlinked scan folders are not exposed. */ }
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(scans));
      } else {
        const file = await safeFile(root, route.name, route.file);
        response.setHeader('Content-Type', route.file === 'scene.splat' ? 'application/octet-stream' : 'application/json; charset=utf-8');
        response.setHeader('Content-Length', file.size);
        const stream = createReadStream(file.path);
        stream.on('error', () => { if (!response.headersSent) finish(404, 'Local scan unavailable.'); else response.destroy(); });
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      }
    } catch { finish(404, 'Local scan unavailable.'); }
  };
}
export function localScansPlugin(): Plugin {
  let root = '';
  return {
    name: 'fixlist-local-scans',
    configResolved(config) { root = join(config.root, 'private-captures', 'scans'); },
    // There is deliberately no generateBundle, copy or production-build asset hook.
    configureServer(server) { server.middlewares.use(createLocalScansHandler(root)); },
    configurePreviewServer(server) { server.middlewares.use(createLocalScansHandler(root)); },
  };
}

export default defineConfig({
  plugins: [react(), localScansPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/private-captures/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
