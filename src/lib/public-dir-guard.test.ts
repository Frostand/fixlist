import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Dynamic import keeps vite.config.ts in the node tsconfig project (same pattern as the boundary tests).
const configPath = '../../vite.config.ts';
const { assertSafePublicDir } = await import(configPath) as { assertSafePublicDir: (projectRoot: string, publicDir: string) => Promise<void> };

let project = '';
afterEach(async () => { if (project) await rm(project, { recursive: true, force: true }); project = ''; });
async function fixture() {
  project = await realpath(await mkdtemp(join(tmpdir(), 'fixlist-public-guard-')));
  await mkdir(join(project, 'public/demo'), { recursive: true });
  await mkdir(join(project, 'ios/App/App/public/local-scans/room'), { recursive: true });
  await mkdir(join(project, 'private-captures/scans/room'), { recursive: true });
  await writeFile(join(project, 'public/demo/ok.txt'), 'Synthetic public file');
  await writeFile(join(project, 'ios/App/App/public/local-scans/room/scene.json'), 'Synthetic private native asset');
  await writeFile(join(project, 'private-captures/scans/room/scene.json'), 'Synthetic private capture');
  return project;
}

describe('build-time public/ guard', () => {
  it('accepts ordinary files and symlinks that stay inside public/', async () => {
    const root = await fixture();
    await symlink(join(root, 'public/demo/ok.txt'), join(root, 'public/alias.txt'));
    await expect(assertSafePublicDir(root, join(root, 'public'))).resolves.toBeUndefined();
  });

  it.each([
    ['generated iOS assets', 'ios/App/App/public/local-scans/room/scene.json'],
    ['private captures', 'private-captures/scans/room/scene.json'],
    ['a folder outside public/', 'private-captures'],
  ])('refuses a public symlink into %s', async (_label, target) => {
    const root = await fixture();
    await mkdir(join(root, 'public/assets'), { recursive: true });
    await symlink(join(root, target), join(root, 'public/assets/copied'));
    await expect(assertSafePublicDir(root, join(root, 'public'))).rejects.toThrow(/Refusing to build/);
  });

  it('ignores a missing public directory', async () => {
    const root = await fixture();
    await expect(assertSafePublicDir(root, join(root, 'missing-public'))).resolves.toBeUndefined();
  });

  it.each(['private-captures', 'ios/App/App/public'])('rejects a public root linked to %s', async (target) => {
    const root = await fixture();
    await rm(join(root, 'public'), { recursive: true });
    await symlink(join(root, target), join(root, 'public'));
    await expect(assertSafePublicDir(root, join(root, 'public'))).rejects.toThrow(/Refusing to build/);
  });

  it('rejects a symlinked public ancestor', async () => {
    const root = await fixture();
    await symlink(join(root, 'ios/App/App'), join(root, 'assets'));
    await expect(assertSafePublicDir(root, join(root, 'assets/public'))).rejects.toThrow(/Refusing to build/);
  });
});
