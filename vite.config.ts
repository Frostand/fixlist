import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
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
async function createRouteAllowlist(projectRoot: string, publicDir: string, distRoot?: string, hmrPath = '/') {
  const development = distRoot === undefined;
  const servingRoots = development ? [projectRoot, publicDir].filter(Boolean) : [distRoot];
  const canonicalRoots = async (roots: string[]) => Promise.all(roots.map(async (root) => (await canonicalFilePath(root)).target));
  const privateRoots = await canonicalRoots([join(projectRoot, 'private-captures'), join(projectRoot, 'ios')]);
  const safeTarget = async (path: string) => {
    const { target, ancestors } = await canonicalFilePath(path);
    // Retain the ancestor check even if a symlink enters and then leaves a private root.
    if ([target, ...ancestors].some((entry) => privateRoots.some((root) => isInside(entry, root)))) throw new Error('Private file.');
    return target;
  };
  const publicFiles = new Set<string>();
  const publicRoot = publicDir ? (await canonicalFilePath(publicDir)).target : '';
  const listPublicFiles = async (directory: string, prefix: string) => {
    await safeTarget(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await listPublicFiles(join(directory, entry.name), path);
      else if (entry.isFile()) publicFiles.add(path);
      else if (entry.isSymbolicLink()) {
        // Never traverse symlinked directories or admit private/outside sources,
        // even if a build has already copied that source to a regular dist file.
        try {
          const target = await safeTarget(join(directory, entry.name));
          if (isInside(target, publicRoot) && (await stat(target)).isFile()) publicFiles.add(path);
        } catch { /* Unsafe or broken public symlinks are not published routes. */ }
      }
    }
  };
  if (publicDir) {
    try { await listPublicFiles(publicDir, ''); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const htmlRequests = new WeakMap<IncomingMessage, string>();
  const before = async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    try {
      const url = request.url ?? '';
      if (/[#\\\0]/.test(url)) { notFound(response); return; }
      const paths = decodedRequestPaths(url);
      if (!paths || paths.some((path) => /[#?\\\0]/.test(path) || path.split('/').some((part) => part === '.' || part === '..'))) { notFound(response); return; }
      const path = paths.at(-1) ?? '';
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('%')) { notFound(response); return; }
      // Give downstream decoders the same path we validated, retaining the query.
      const query = url.indexOf('?');
      request.url = encodeURI(path) + (query === -1 ? '' : url.slice(query));
      if (path === '/local-scans' || path.startsWith('/local-scans/')) { next(); return; }

      let file: string | undefined, roots: string[] = [];
      if (path === '/' || path === '/index.html') {
        const root = distRoot ?? projectRoot;
        file = join(root, 'index.html'); roots = [root];
      } else if (publicFiles.has(path)) {
        const root = distRoot ?? publicDir;
        file = join(root, path); roots = [root];
      } else if (development && path === '/scan/hazard-questions.json') {
        // The app imports the trusted photo-question catalog directly (single source of truth).
        file = join(projectRoot, 'scan', 'hazard-questions.json'); roots = [join(projectRoot, 'scan')];
      } else if (development && path.startsWith('/src/')) {
        file = join(projectRoot, path); roots = [join(projectRoot, 'src')];
      } else if (development && path.startsWith('/node_modules/')) {
        file = join(projectRoot, path); roots = [join(projectRoot, 'node_modules')];
      } else if (development && path.startsWith('/@fs/')) {
        file = resolve('/', path.slice('/@fs/'.length)); roots = [join(projectRoot, 'src'), join(projectRoot, 'node_modules')];
      } else if (distRoot && path.startsWith('/assets/')) {
        // A build copies public/ symlink targets into dist as regular files; refuse
        // an asset whose public source resolves somewhere unsafe.
        if (publicDir) {
          const source = await safeTarget(join(publicDir, path));
          if (existsSync(join(publicDir, path)) && !isInside(source, publicRoot)) { notFound(response); return; }
        }
        file = join(distRoot, path); roots = [join(distRoot, 'assets')];
      } else if (!(development && (path.startsWith('/@vite/') || path.startsWith('/@id/') || path === '/@react-refresh' || (path === hmrPath && request.headers.upgrade?.toLowerCase() === 'websocket')))) {
        notFound(response); return;
      }

      // Second layer: check every static location Vite could serve for an allowed
      // path, including public files shadowing a development source/module URL.
      for (const root of servingRoots) {
        const target = await safeTarget(join(root, path === '/' ? 'index.html' : path));
        if (!isInside(target, (await canonicalFilePath(root)).target)) { notFound(response); return; }
      }
      if (file) {
        const target = await safeTarget(file);
        const allowed = await canonicalRoots(roots);
        if (!allowed.some((root) => isInside(target, root)) || !(await stat(target)).isFile()) { notFound(response); return; }
        // Require an actual file, never an implicit directory or extension alias.
        if (path === '/' || path.endsWith('.html')) htmlRequests.set(request, path === '/' ? '/index.html' : encodeURI(path));
      }
    } catch { notFound(response); return; }
    next();
  };
  // Virtual Vite routes must be handled by Vite's module middleware. If they fall
  // through, stop before indexHtmlMiddleware can read an implicit HTML alias.
  const after = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (htmlRequests.get(request) === request.url?.split('?')[0]) next();
    else notFound(response);
  };
  return { before, after };
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
/** Refuse to build when public/ links outside itself or into private folders; a build would copy the target into dist. */
export async function assertSafePublicDir(projectRoot: string, publicDir: string): Promise<void> {
  if (!publicDir || !existsSync(publicDir)) return;
  const project = (await canonicalFilePath(projectRoot)).target;
  const lexicalRoot = resolve(publicDir);
  const { target: publicRoot, ancestors: publicAncestors } = await canonicalFilePath(lexicalRoot);
  const privateRoots = await Promise.all([join(projectRoot, 'private-captures'), join(projectRoot, 'ios')].map(async (path) => (await canonicalFilePath(path)).target));
  // The root itself is an input to copying. Never derive the allowed boundary
  // from an already redirected root, including a redirected ancestor.
  if (!isInside(lexicalRoot, resolve(projectRoot)) || !isInside(publicRoot, project)
    || publicRoot !== resolve(project, relative(resolve(projectRoot), lexicalRoot))
    || [publicRoot, ...publicAncestors].some((item) => privateRoots.some((root) => isInside(item, root)))) {
    throw new Error('Refusing to build: public/ root or ancestor redirects outside its allowed public path or into a private folder.');
  }
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const { target, ancestors } = await canonicalFilePath(path);
        if (!isInside(target, publicRoot) || [target, ...ancestors].some((item) => privateRoots.some((root) => isInside(item, root)))) {
          throw new Error(`Refusing to build: ${path} links outside public/ or into a private folder.`);
        }
      } else if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(publicDir);
}
export function localScansPlugin(): Plugin {
  let root = '', projectRoot = '', publicDir = '', command = '';
  return {
    name: 'fixlist-local-scans',
    enforce: 'pre',
    configResolved(config) { root = join(config.root, 'private-captures', 'scans'); projectRoot = config.root; publicDir = config.publicDir; command = config.command; },
    async buildStart() { if (command === 'build') await assertSafePublicDir(projectRoot, publicDir); },
    // There is deliberately no generateBundle or copy hook; buildStart only refuses unsafe public/ links.
    async configureServer(server) {
      const ws = server.config.server.ws;
      const boundary = await createRouteAllowlist(server.config.root, server.config.publicDir, undefined, join(server.config.base, typeof ws === 'object' ? ws.path ?? '' : ''));
      // Vite installs its raw-# rejection before configureServer hooks. Prepend
      // our allowlist so all rejected wire targets consistently receive our 404.
      server.middlewares.stack.unshift({ route: '', handle: boundary.before });
      server.middlewares.use(createLocalScansHandler(root));
      return () => { server.middlewares.use(boundary.after); };
    },
    async configurePreviewServer(server) {
      const boundary = await createRouteAllowlist(server.config.root, server.config.publicDir, resolve(server.config.root, server.config.build.outDir));
      server.middlewares.stack.unshift({ route: '', handle: boundary.before });
      server.middlewares.use(createLocalScansHandler(root));
      return () => { server.middlewares.use(boundary.after); };
    },
  };
}

export default defineConfig({
  plugins: [react(), localScansPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/private-captures/**', '**/ios/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
