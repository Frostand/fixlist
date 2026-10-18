// Copies one private local scan into the iOS app's gitignored web assets so the
// native demo build can load it offline, mirroring the dev server's /local-scans
// route. Run after `npx cap sync ios`; never copies into dist/, public/ or Git.
import { copyFile, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const files = ['scene.splat', 'scene.json', 'suggestions.json'];
const root = resolve(import.meta.dirname, '..');
const target = join(root, 'ios/App/App/public/local-scans');
const names = process.argv.slice(2);
if (!names.length) throw new Error('Usage: node scripts/ios-demo-scan.mjs <scan-name> [...]');

await rm(target, { recursive: true, force: true });
const index = [];
for (const name of names) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name)) throw new Error(`Invalid scan name: ${name}`);
  const source = join(root, 'private-captures/scans', name);
  const sizes = {};
  for (const file of files) {
    const path = join(source, file);
    const info = await lstat(path).catch(() => null);
    if (!info) { if (file === 'scene.splat') throw new Error(`Missing ${path}`); sizes[file] = null; continue; }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing non-regular file: ${path}`);
    await mkdir(join(target, name), { recursive: true });
    await copyFile(path, join(target, name, file));
    sizes[file] = info.size;
  }
  index.push({ name, sizes });
}
await writeFile(join(target, 'index.json'), JSON.stringify(index));
console.log(`Bundled ${index.map((entry) => entry.name).join(', ')} into ios/App/App/public/local-scans (gitignored).`);
