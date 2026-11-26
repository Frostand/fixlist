import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ONDEVICE_MODEL, ONDEVICE_THRESHOLDS } from '../src/lib/ondevice-model';

const root = resolve(import.meta.dirname, '..');
const validator = join(root, 'scripts/verify-ios-model.sh');
const weightPath = 'ios/App/App/HazardModel/HazardImageEncoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin';
const manifest = JSON.parse(readFileSync(join(root, 'ios/App/App/HazardModel/hazard-prompts.json'), 'utf8'));
const pinnedBytes = manifest.weight.bytes;
const pinnedHash = manifest.weight.sha256;
const pointer = { stdout: `version https://git-lfs.github.com/spec/v1\noid sha256:${pinnedHash}\nsize ${pinnedBytes}\n` };
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
  it('keeps native identity, web thresholds, reviewed rules and runtime source pins coherent', () => {
    expect(manifest.model).toEqual(ONDEVICE_MODEL);
    expect(Object.fromEntries(manifest.items.map((i) => [i.checklistItemId, i.threshold]))).toEqual(ONDEVICE_THRESHOLDS);
    expect(manifest.model.engine).toBe('yolo-world-object-rules');
    expect(manifest.model.license).toContain('AGPL-3.0');
    for (const [path, digest] of Object.entries(manifest.runtimeSources)) {
      expect(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), path).toBe(digest);
    }
  });
  it('pins precisely the reviewed detector manifest weight object in the production validator', () => {
    expect(pointer.stdout).toMatch(/^version https:\/\/git-lfs.github.com\/spec\/v1\n/);
    expect(Buffer.byteLength(pointer.stdout)).toBeGreaterThan(100);
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
