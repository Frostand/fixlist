import { describe, expect, it, vi } from 'vitest';
import { checkVersions, main, parseMode, setup } from './setup.mjs';

const weight = 'ios/App/App/HazardModel/HazardImageEncoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin';
const web = [['npm', ['ci']]];
const ios = [
  ['git', ['--version']],
  ['git', ['lfs', 'version']],
  ['xcode-select', ['-p']],
  ['xcodebuild', ['-version']],
  ['git', ['lfs', 'install', '--local']],
  ['git', ['lfs', 'pull', `--include=${weight}`, '--exclude=']],
  ['/bin/sh', ['scripts/verify-ios-model.sh']],
  ...web,
];
const output = (command) => command === 'xcode-select' ? '/Applications/Xcode.app/Contents/Developer\n'
  : command === 'xcodebuild' ? 'Xcode 26.6\nBuild version 17G1\n' : '';

describe('setup configuration', () => {
  it.each(['24.18.0', '24.19.0', '24.99.99'])('accepts Node %s with npm 11', (node) => {
    expect(() => checkVersions(node, '11.16.0')).not.toThrow();
  });
  it.each([
    ['24.17.9', '11.16.0'], ['25.0.0', '11.16.0'], ['23.99.0', '11.16.0'],
    ['24.18.0', '10.9.0'], ['24.18.0', '12.0.0'],
    ['24', '11.16.0'], ['24.18.0-rc.1', '11.16.0'], ['bad', '11.16.0'],
    ['24.18.0', '11'], ['24.18.0', '11.0.0-beta'], ['24.18.0', ''],
  ])('rejects Node %s / npm %s before any subprocess', async (nodeVersion, npmVersion) => {
    const run = vi.fn();
    expect(() => checkVersions(nodeVersion, npmVersion)).toThrow(/Node|npm/);
    await expect(main({ args: [], nodeVersion, npmVersion, run })).rejects.toThrow(/Node|npm/);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([[], ['--web'], ['--ios']])('parses %j', (...args) => {
    expect(parseMode(args)).toBe(args[0] === '--ios' ? 'ios' : 'web');
  });
  it.each([['--unknown'], ['--web', '--ios'], ['--ios', '--ios'], ['web']])('rejects mode arguments %j without subprocesses', async (...args) => {
    const run = vi.fn();
    expect(() => parseMode(args)).toThrow(/usage/i);
    await expect(main({ args, run })).rejects.toThrow(/usage/i);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects unsupported platforms and programmatic modes before any subprocess', async () => {
    const run = vi.fn();
    await expect(main({ args: ['--ios'], platform: 'linux', run })).rejects.toThrow(/macOS/);
    await expect(setup({ mode: 'ios', platform: 'win32', run })).rejects.toThrow(/macOS/);
    await expect(setup({ mode: 'other', run })).rejects.toThrow(/mode/i);
    expect(run).not.toHaveBeenCalled();
  });
  it('checks the actual npm version before starting installation', async () => {
    const run = vi.fn(async () => '12.0.0');
    await expect(main({ args: [], nodeVersion: '24.18.0', run })).rejects.toThrow(/npm/);
    expect(run.mock.calls).toEqual([['npm', ['--version']]]);
  });
  it('stops before npm probing on unsupported Node, and before installing on probe failure', async () => {
    const run = vi.fn(async () => { throw new Error('npm probe failed'); });
    await expect(main({ args: [], nodeVersion: '18.0.0', run })).rejects.toThrow(/Node/);
    expect(run).not.toHaveBeenCalled();
    await expect(main({ args: [], nodeVersion: '24.18.0', run })).rejects.toThrow(/npm probe failed/);
    expect(run.mock.calls).toEqual([['npm', ['--version']]]);
  });
});

describe('ordered setup', () => {
  it('keeps default/web mode free of Git, LFS, Xcode and model validation', async () => {
    const run = vi.fn(async () => '');
    await setup({ run });
    expect(run.mock.calls).toEqual(web);
  });
  it('runs explicit web mode after checking versions', async () => {
    const run = vi.fn(async () => '11.16.0');
    await main({ args: ['--web'], nodeVersion: '24.18.0', run });
    expect(run.mock.calls).toEqual([['npm', ['--version']], ...web]);
  });
  it('checks every prerequisite before local LFS install, narrow pull, validation and npm ci', async () => {
    const run = vi.fn(async (command) => output(command));
    await setup({ mode: 'ios', platform: 'darwin', run });
    expect(run.mock.calls).toEqual(ios);
  });
  it.each(ios.map((step, index) => [index, step[0], step[1].join(' ')]))('stops at subprocess %i (%s %s), retaining its cause', async (index) => {
    const cause = new Error('controlled subprocess failure');
    const run = vi.fn(async (command) => {
      if (run.mock.calls.length === index + 1) throw cause;
      return output(command);
    });
    const result = setup({ mode: 'ios', platform: 'darwin', run });
    await expect(result).rejects.toThrow(/controlled subprocess failure/);
    await expect(result).rejects.toHaveProperty('cause', cause);
    expect(run.mock.calls).toEqual(ios.slice(0, index + 1));
  });
  it('stops web setup when npm ci fails', async () => {
    const run = vi.fn(async () => { throw new Error('npm install failed'); });
    await expect(setup({ run })).rejects.toThrow(/npm install failed/);
    expect(run.mock.calls).toEqual(web);
  });
  it('explains web fallback after an LFS download failure', async () => {
    const run = vi.fn(async (command, args) => {
      if (args[1] === 'pull') throw new Error('LFS quota exceeded');
      return output(command);
    });
    await expect(setup({ mode: 'ios', platform: 'darwin', run })).rejects.toThrow(/LFS quota exceeded[\s\S]*--web/);
    expect(run.mock.calls).toHaveLength(6);
  });
  it.each([
    ['xcode-select', '/Library/Developer/CommandLineTools'],
    ['xcodebuild', 'Command Line Tools'],
  ])('rejects incomplete Xcode from %s before mutation', async (badCommand, badOutput) => {
    const run = vi.fn(async (command) => command === badCommand ? badOutput : output(command));
    await expect(setup({ mode: 'ios', platform: 'darwin', run })).rejects.toThrow(/full Xcode/);
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
