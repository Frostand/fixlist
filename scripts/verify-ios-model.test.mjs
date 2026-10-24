import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const validator = join(root, 'scripts/verify-ios-model.sh');
const weightPath = 'ios/App/App/HazardModel/HazardImageEncoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin';
const pointer = spawnSync('git', ['show', `HEAD:${weightPath}`], { cwd: root, encoding: 'utf8' });
if (pointer.status !== 0) throw new Error(`Cannot read committed LFS pointer: ${pointer.stderr}`);
const pinnedBytes = Number(pointer.stdout.match(/^size (\d+)$/m)?.[1]);
const pinnedHash = pointer.stdout.match(/^oid sha256:([a-f0-9]{64})$/m)?.[1];
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'fixlist model check '));
  roots.push(path);
  return path;
}
function check(args, script = validator, cwd = tmpdir()) {
  return spawnSync('/bin/sh', [script, ...args], { cwd, encoding: 'utf8' });
}
function rejected(result, path, reason) {
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('error:');
  expect(result.stderr).toContain(path);
  expect(result.stderr).toMatch(reason);
  expect(result.stderr).toContain('npm run setup -- --ios');
  expect(result.stderr).toContain('Clean Build Folder');
}

describe('native model integrity', () => {
  it('pins precisely the committed LFS object in the production validator', () => {
    expect(pointer.stdout).toMatch(/^version https:\/\/git-lfs.github.com\/spec\/v1\n/);
    expect(Buffer.byteLength(pointer.stdout)).toBe(134);
    const source = readFileSync(validator, 'utf8');
    expect(source.match(/^expected_bytes=(\d+)$/m)?.[1]).toBe(String(pinnedBytes));
    expect(source.match(/^expected_sha256=([a-f0-9]{64})$/m)?.[1]).toBe(pinnedHash);
  });
  it('rejects a missing file with compiled recovery guidance', () => {
    const path = join(fixture(), 'missing.bin');
    rejected(check([path]), path, /missing|not found/i);
  });
  it('rejects a directory', () => {
    const path = fixture();
    rejected(check([path]), path, /regular file/i);
  });
  it('identifies the exact committed Git LFS pointer', () => {
    const path = join(fixture(), 'weight.bin');
    writeFileSync(path, pointer.stdout);
    rejected(check([path]), path, /Git LFS pointer/i);
  });
  it('rejects truncated bytes, including paths with spaces and other extensions', () => {
    const path = join(fixture(), 'compiled weight.data');
    writeFileSync(path, 'truncated');
    rejected(check([path]), path, /size|bytes/i);
  });
  it('rejects same-size corruption by SHA-256, rather than accepting byte count', () => {
    const path = join(fixture(), 'weight.bin');
    writeFileSync(path, '');
    truncateSync(path, pinnedBytes);
    rejected(check([path]), path, /SHA-256 mismatch/i);
  });
  it('resolves the default source relative to its script, even in a spaced checkout', () => {
    const checkout = fixture();
    const script = join(checkout, 'scripts/verify-ios-model.sh');
    const path = join(checkout, weightPath);
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(validator, script);
    writeFileSync(path, pointer.stdout);
    const result = check([], script);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(path);
    expect(result.stderr).toMatch(/Git LFS pointer/);
    expect(result.stderr).toContain('npm run setup -- --ios');
  });
  it('rejects extra arguments', () => {
    const result = check(['one', 'two']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/error:.*usage/i);
  });
  it('guards ios:sync before any build or Capacitor command on a pointer checkout', () => {
    const checkout = fixture();
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    mkdirSync(join(checkout, 'scripts'), { recursive: true });
    mkdirSync(dirname(join(checkout, weightPath)), { recursive: true });
    copyFileSync(validator, join(checkout, 'scripts/verify-ios-model.sh'));
    writeFileSync(join(checkout, weightPath), pointer.stdout);
    writeFileSync(join(checkout, 'scripts/build-marker.cjs'), "require('node:fs').writeFileSync('build-started', 'unexpected');");
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ private: true, scripts: {
      'ios:model:check': scripts['ios:model:check'], 'ios:sync': scripts['ios:sync'], build: 'node scripts/build-marker.cjs',
    } }));
    const result = spawnSync('npm', ['run', 'ios:sync'], { cwd: checkout, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/error:.*Git LFS pointer/);
    expect(existsSync(join(checkout, 'build-started'))).toBe(false);
    expect(result.stdout).not.toContain('> build');
  });
  it.skipIf(process.env.FIXLIST_REQUIRE_IOS_MODEL !== '1')('validates the required real model (missing/pointer fails)', () => {
    const result = check([]);
    expect(result.status, result.stderr).toBe(0);
  });
});
