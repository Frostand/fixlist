import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
/** Retain every decoding stage so later URL decoders cannot bypass the boundary. */
function decodedRequestPaths(url: string): string[] | null {
  let path = url.split('?')[0] ?? '';
  const paths: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    paths.push(path);
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return paths;
      path = decoded;
    } catch {
      const decoded = path.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (decoded === path) return paths;
      path = decoded;
    }
  }
  // Reject excessive nesting rather than passing it to another URL decoder.
  return null;
}
export function isPrivateCaptureRequest(url: string): boolean {
  const paths = decodedRequestPaths(url);
  // Offline iOS builds also contain private generated web assets.
  return !paths || paths.some((path) => path.toLowerCase().includes('private-captures') || /(?:^|[\\/])ios(?:[\\/]|$)/i.test(path));
}
function notFound(response: ServerResponse) {
  response.statusCode = 404;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Not found.');
}
function isInside(path: string, root: string) {
  const suffix = relative(root, path);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}
async function canonicalFilePath(path: string) {
  let current = resolve(path), target: string | undefined;
  const suffix: string[] = [], ancestors: string[] = [];
  for (;;) {
    try {
      const canonical = await realpath(current);
      target ??= resolve(canonical, ...suffix);
      ancestors.push(canonical);
    } catch (error) {
      // A missing leaf must still be checked against its existing symlinked
      // ancestors, rather than falling through to Vite's SPA fallback.
      if (!(error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(basename(current));
    current = parent;
  }
  if (!target) throw new Error('Unresolvable file path.');
  return { target, ancestors };
}
function createPrivateFilesGuard(projectRoot: string, servingRoots: string[], allowedRoots: string[]) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    try {
      const paths = decodedRequestPaths(request.url ?? '');
      if (!paths) { notFound(response); return; }
      const canonicalRoots = async (roots: string[]) => Promise.all(roots.map(async (root) => (await canonicalFilePath(root)).target));
      const privateRoots = await canonicalRoots([join(projectRoot, 'private-captures'), join(projectRoot, 'ios')]);
      let allowed: string[] | undefined;
      for (const path of paths) {
        // Mirror root/publicDir static serving in dev and dist serving in preview.
        const candidates = servingRoots.map((root) => ({ path: resolve(root, path.replace(/^\/+/, '')), rawFs: false }));
        if (path.startsWith('/@fs/')) candidates.push({ path: resolve('/', path.slice('/@fs/'.length)), rawFs: true });
        for (const candidate of candidates) {
          const { target, ancestors } = await canonicalFilePath(candidate.path);
          // Check ancestors too: an alias may enter a private directory and
          // leave it through another symlink, or end at a nonexistent file.
          if ([target, ...ancestors].some((entry) => privateRoots.some((root) => isInside(entry, root)))) { notFound(response); return; }
          if (candidate.rawFs) {
            allowed ??= await canonicalRoots(allowedRoots);
            if (!allowed.some((root) => isInside(target, root))) { notFound(response); return; }
          }
        }
      }
    } catch { notFound(response); return; }
    next();
  };
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
    // The dedicated route validates its own names/files, origin and symlinks.
    // Dispatch it first so valid scan names such as "ios" remain loadable.
    const route = parseLocalScanRequest(request.url ?? '');
    if (!route) {
      if (isPrivateCaptureRequest(request.url ?? '')) notFound(response);
      else next();
      return;
    }
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
    configureServer(server) {
      server.middlewares.use(createLocalScansHandler(root));
      server.middlewares.use(createPrivateFilesGuard(server.config.root, [server.config.root, server.config.publicDir].filter(Boolean), server.config.server.fs.allow));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createLocalScansHandler(root));
      server.middlewares.use(createPrivateFilesGuard(server.config.root, [resolve(server.config.root, server.config.build.outDir)], server.config.server.fs.allow));
    },
  };
}

export default defineConfig({
  plugins: [react(), localScansPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/private-captures/**', '**/ios/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
