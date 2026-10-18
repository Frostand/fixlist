// Validate private scans before native sync, then install only the staged snapshot.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const files = ['scene.splat', 'scene.json', 'suggestions.json'];
const defaultRoot = resolve(import.meta.dirname, '..');
const inside = (path, root) => { const r = relative(root, path); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
const validName = (name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const privateStageBase = (root) => join(root, 'ios/DerivedData');
const defaultStage = (root) => join(privateStageBase(root), 'fixlist-demo-scan-stage');
const capFor = (v, file) => file === 'scene.splat' ? v.MAX_SCAN_BYTES : file === 'scene.json' ? v.MAX_METADATA_BYTES : v.MAX_SUGGESTIONS_BYTES;

async function ordinaryPath(root, path, optional = false) {
  if (!inside(path, root)) throw new Error('Path escapes allowed root.');
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (optional && current === path && error.code === 'ENOENT') return null;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Refusing symlinked path component: ${current}`);
    if (await realpath(current) !== current) throw new Error('Path ancestor redirects outside allowed root.');
    if (current === path) return info;
    if (!info.isDirectory()) throw new Error('Non-directory path ancestor.');
  }
}
async function ordinaryDirectory(root, path) {
  if (!inside(path, root)) throw new Error('Directory escapes allowed root.');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await ordinaryPath(root, current);
    if (!info.isDirectory()) throw new Error('Non-directory staging ancestor.');
  }
}
function stagePath(root, directory) {
  const path = directory ? resolve(root, directory) : defaultStage(root);
  if (path === privateStageBase(root) || !inside(path, privateStageBase(root))) throw new Error('Stage directories must be beneath the ignored ios/DerivedData/ cache.');
  return path;
}
async function validators() {
  // Transform only: middleware mode opens no network listener or model service.
  const vite = await createServer({ root: defaultRoot, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom' });
  try {
    const [model, suggestions, loader, scenario] = await Promise.all([
      vite.ssrLoadModule('/src/lib/scan-model.ts'), vite.ssrLoadModule('/src/lib/scan-suggestions.ts'),
      vite.ssrLoadModule('/src/lib/local-scan-loader.ts'), vite.ssrLoadModule('/src/data/demo-scenario.ts'),
    ]);
    return { ...model, ...suggestions, ...loader, catalog: suggestions.createSuggestionCatalog(scenario.demoScenario) };
  } finally { await vite.close(); }
}
async function readArtifact(root, path, cap, size) {
  const info = await ordinaryPath(root, path);
  if (!info.isFile() || info.size <= 0 || info.size > cap || (size !== undefined && info.size !== size)) throw new Error('Invalid or changed artifact size/type.');
  const { stdout } = await promisify(execFile)(join(defaultRoot, 'scan/venv-python'),
    [join(defaultRoot, 'scan/read_local_artifact.py'), root, relative(root, path), String(cap)],
    { encoding: 'buffer', maxBuffer: cap + 1, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (stdout.length !== info.size) throw new Error('Source changed during packaging.');
  await ordinaryPath(root, path);
  return stdout;
}
function checkSplat(bytes) {
  if (!bytes?.length || bytes.length % 32) throw new Error('Invalid .splat length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 32) {
    for (let i = 0; i < 6; i++) {
      const n = view.getFloat32(offset + i * 4, true);
      if (!Number.isFinite(n) || (i < 3 ? Math.abs(n) > 1e8 : n <= 0)) throw new Error('Invalid .splat positions/scales.');
    }
    if (bytes.subarray(offset + 28, offset + 32).every((v) => v === 128)) throw new Error('Invalid .splat quaternion.');
  }
}
async function validateContents(contents, v) {
  checkSplat(contents['scene.splat']);
  let metadata = null;
  if (contents['scene.json']) {
    const parsed = v.parseScanMetadata(contents['scene.json'].toString('utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    metadata = parsed.value;
  }
  const result = v.validateScanAsset({ name: 'scene.splat', blob: new Blob([contents['scene.splat']]), metadata, kind: 'generated' });
  if (!result.ok) throw new Error(result.error);
  const prepared = await v.prepareScanAsset(result.value);
  if (!prepared.ok) throw new Error(prepared.error);
  if (contents['suggestions.json']) {
    const parsed = v.parseScanSuggestions(contents['suggestions.json'].toString('utf8'), v.catalog, result.value);
    if (!parsed.ok) throw new Error(parsed.error);
  }
}
async function exchange(source, target) {
  await promisify(execFile)(join(defaultRoot, 'scan/venv-python'), [join(defaultRoot, 'scan/atomic_directory.py'), source, target],
    { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
}
async function listFiles(root, directory = root, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await ordinaryPath(root, path);
    if (info.isDirectory()) found.push(...await listFiles(root, path, name));
    else if (info.isFile()) found.push(name);
    else throw new Error('Unexpected staged artifact type.');
  }
  return found.sort();
}

/** Durable staging is separate from native web assets and survives cap sync. */
export async function stageScans(names, { projectRoot = defaultRoot, stageDir } = {}) {
  if (!names.length || names.length > 100 || names.some((name) => !validName(name)) || new Set(names).size !== names.length) throw new Error('Use 1–100 unique valid scan names.');
  const root = await realpath(projectRoot), destination = stagePath(root, stageDir);
  const sourceRoot = join(root, 'private-captures/scans');
  await ordinaryPath(root, sourceRoot);
  const v = await validators(), plan = [];
  // Validate every ancestor/leaf before reading any selected private bytes.
  for (const name of names) {
    const entries = [];
    for (const file of files) {
      const path = join(sourceRoot, name, file), info = await ordinaryPath(sourceRoot, path, file !== 'scene.splat');
      if (info && (!info.isFile() || info.size <= 0 || info.size > capFor(v, file))) throw new Error(`Unsupported file size/type: ${file}`);
      entries.push({ file, path, info });
    }
    plan.push({ name, entries });
  }
  await ordinaryDirectory(root, dirname(destination));
  const existing = await ordinaryPath(root, destination, true);
  if (existing) {
    // Never remove an unrelated directory merely because it occupies a stage path.
    await readStage(destination, root, v);
  }
  const temporary = await mkdtemp(join(dirname(destination), '.fixlist-scan-stage-'));
  let published = false;
  try {
    const bundle = join(temporary, 'bundle'); await mkdir(bundle, { mode: 0o700 });
    const index = [], manifestFiles = [];
    const put = async (name, bytes) => {
      await writeFile(join(bundle, name), bytes, { flag: 'wx', mode: 0o600 });
      manifestFiles.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    };
    for (const { name, entries } of plan) {
      const contents = {}, sizes = {};
      for (const { file, path, info } of entries) {
        sizes[file] = info?.size ?? null;
        if (info) contents[file] = await readArtifact(sourceRoot, path, capFor(v, file), info.size);
      }
      await validateContents(contents, v);
      await mkdir(join(bundle, name), { mode: 0o700 });
      for (const [file, bytes] of Object.entries(contents)) await put(`${name}/${file}`, bytes);
      index.push({ name, sizes });
    }
    if (v.validateLocalScanIndex(index).length !== index.length) throw new Error('App rejected the complete scan index.');
    await put('index.json', Buffer.from(JSON.stringify(index)));
    const manifest = { format: 'fixlist-ios-scan-stage', version: 1, projectRoot: root, createdAt: new Date().toISOString(), files: manifestFiles.sort((a,b) => a.path.localeCompare(b.path)) };
    await writeFile(join(temporary, 'stage.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    await ordinaryPath(root, dirname(destination));
    if (existing) await exchange(temporary, destination);
    else await rename(temporary, destination);
    published = true;
    return { directory: destination, index };
  } finally {
    // Successful exchange moves the previous known stage to temporary.
    try { await rm(temporary, { recursive: true, force: true }); } catch (error) { if (!published) throw error; }
  }
}

async function readStage(directory, root, v) {
  await ordinaryPath(root, directory);
  const manifest = JSON.parse((await readArtifact(directory, join(directory, 'stage.json'), 256*1024)).toString('utf8'));
  if (manifest?.format !== 'fixlist-ios-scan-stage' || manifest.version !== 1 || manifest.projectRoot !== root || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 301) throw new Error('Invalid staged manifest.');
  const bundle = join(directory, 'bundle'); await ordinaryPath(directory, bundle);
  const paths = manifest.files.map((entry) => entry.path);
  if (paths.some((path) => typeof path !== 'string' || !/^(?:index\.json|[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/(?:scene\.splat|scene\.json|suggestions\.json))$/.test(path)) || new Set(paths).size !== paths.length) throw new Error('Invalid staged manifest paths.');
  if ((await listFiles(directory)).join('\n') !== ['stage.json', ...paths.map((path) => `bundle/${path}`)].sort().join('\n')) throw new Error('Unexpected or missing staged file.');
  const contents = new Map();
  for (const entry of manifest.files) {
    const file = entry.path.split('/').at(-1), cap = file === 'index.json' ? 64*1024 : capFor(v, file);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > cap || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid staged content identity.');
    const bytes = await readArtifact(directory, join(bundle, entry.path), cap, entry.bytes);
    if (hash(bytes) !== entry.sha256) throw new Error('Staged artifact content hash changed.');
    contents.set(entry.path, bytes);
  }
  if (!contents.has('index.json')) throw new Error('Missing staged index.');
  const rawIndex = JSON.parse(contents.get('index.json').toString('utf8')), index = v.validateLocalScanIndex(rawIndex);
  if (!Array.isArray(rawIndex) || !index.length || index.length !== rawIndex.length) throw new Error('Invalid staged app index.');
  const expected = ['index.json'];
  for (const entry of index) {
    const scan = {};
    for (const file of files) {
      const bytes = contents.get(`${entry.name}/${file}`);
      if (entry.sizes[file] === null) { if (bytes) throw new Error('Staged optional file contradicts the index.'); }
      else {
        if (!bytes || bytes.length !== entry.sizes[file]) throw new Error('Staged index disagrees with file bytes.');
        expected.push(`${entry.name}/${file}`); scan[file] = bytes;
      }
    }
    await validateContents(scan, v);
  }
  if (paths.slice().sort().join('\n') !== expected.sort().join('\n')) throw new Error('Stage contains a file the app index does not declare.');
  return { index, contents };
}

/** Install verified staged bytes; original captures need not still exist. */
export async function installStaged(stageDir, { projectRoot = defaultRoot, beforeInstall } = {}) {
  const root = await realpath(projectRoot), directory = stagePath(root, stageDir), v = await validators();
  const { index, contents } = await readStage(directory, root, v);
  const target = join(root, 'ios/App/App/public/local-scans');
  await ordinaryPath(root, dirname(target));
  const existing = await ordinaryPath(root, target, true);
  if (existing && !existing.isDirectory()) throw new Error('Bundle target is not an ordinary directory.');
  const temporary = await mkdtemp(join(dirname(target), '.local-scans-stage-'));
  let installed = false;
  try {
    const next = join(temporary, 'next'); await mkdir(next, { mode: 0o700 });
    for (const entry of index) await mkdir(join(next, entry.name), { mode: 0o700 });
    for (const [name, bytes] of contents) await writeFile(join(next, name), bytes, { flag: 'wx', mode: 0o600 });
    await ordinaryPath(root, dirname(target)); await ordinaryPath(root, target, true);
    if (beforeInstall) await beforeInstall();
    if (existing) await exchange(next, target);
    else await rename(next, target);
    installed = true;
    return index;
  } finally {
    try { await rm(temporary, { recursive: true, force: true }); } catch (error) { if (!installed) throw error; }
  }
}

/** Compatibility path: one invocation still stages then atomically installs. */
export async function bundleScans(names, { projectRoot = defaultRoot, beforeInstall } = {}) {
  const root = await realpath(projectRoot), directory = join(privateStageBase(root), `fixlist-bundle-${randomUUID()}`);
  let staged = false;
  try {
    await stageScans(names, { projectRoot: root, stageDir: directory }); staged = true;
    return await installStaged(directory, { projectRoot: root, beforeInstall });
  } finally { if (staged) await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] === '--stage') {
    if (!args[1] || args.length < 3) throw new Error('Usage: --stage <ios/DerivedData/directory> <scan-name> [...]');
    const staged = await stageScans(args.slice(2), { stageDir: args[1] });
    console.log(`Validated and staged ${staged.index.map((entry) => entry.name).join(', ')} at ${relative(defaultRoot, staged.directory)}; native web assets untouched.`);
  } else if (args[0] === '--install-staged') {
    if (args.length !== 2 || !args[1]) throw new Error('Usage: --install-staged <ios/DerivedData/directory>');
    const index = await installStaged(args[1]);
    console.log(`Installed staged ${index.map((entry) => entry.name).join(', ')} into ignored native web assets.`);
  } else {
    const index = await bundleScans(args);
    console.log(`Bundled ${index.map((entry) => entry.name).join(', ')} into ios/App/App/public/local-scans (gitignored).`);
  }
}
