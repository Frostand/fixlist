import { execFile } from 'node:child_process';
import { verifyVoicePack } from './voice-pack/verify.mjs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const weight = 'ios/App/App/HazardModel/HazardImageEncoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin';
const execute = promisify(execFile);
const usage = 'Usage: npm run setup [-- --web | -- --ios]';

function version(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Cannot parse ${name} version ${JSON.stringify(value)}. Use Node 24.18.0 or newer within 24.x and npm 11.x.`);
  }
  return value.split('.').map(Number);
}
function checkNode(nodeVersion) {
  const [major, minor] = version(nodeVersion, 'Node');
  if (major !== 24 || minor < 18) throw new Error(`Node ${nodeVersion} is unsupported. Install Node >=24.18.0 <25 (see .nvmrc), with npm 11.x, then retry.`);
}
export function checkVersions(nodeVersion, npmVersion) {
  checkNode(nodeVersion);
  if (version(npmVersion, 'npm')[0] !== 11) throw new Error(`npm ${npmVersion} is unsupported. Use npm >=11 <12 with Node 24.x, then retry.`);
}
export function parseMode(args) {
  if (args.length === 0) return 'web';
  if (args.length === 1 && (args[0] === '--web' || args[0] === '--ios')) return args[0].slice(2);
  throw new Error(usage);
}
function checkMode(mode, platform) {
  if (mode !== 'web' && mode !== 'ios') throw new Error(`Unknown setup mode: ${mode}. ${usage}`);
  if (mode === 'ios' && platform !== 'darwin') throw new Error('iOS setup requires macOS and full Xcode. Use npm run setup -- --web on this platform.');
}

async function runCommand(command, args) {
  let executable = command, commandArgs = args;
  if (command === 'npm') {
    if (!process.env.npm_execpath) throw new Error('npm CLI path is unavailable. Launch with npm run setup.');
    executable = process.execPath;
    commandArgs = [process.env.npm_execpath, ...args];
  }
  const { stdout, stderr } = await execute(executable, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return stdout.trim();
}

export async function setup({ mode = 'web', platform = process.platform, run = runCommand } = {}) {
  checkMode(mode, platform);
  await verifyVoicePack();
  const step = async (command, args, guidance) => {
    try { return await run(command, args); }
    catch (cause) { throw new Error(`${command} ${args.join(' ')} failed: ${cause.message}\n${guidance}`, { cause }); }
  };
  if (mode === 'ios') {
    await step('git', ['--version'], 'Install Git, then retry npm run setup -- --ios.');
    await step('git', ['lfs', 'version'], 'Install Git LFS (https://git-lfs.com), then retry npm run setup -- --ios.');
    const developer = await step('xcode-select', ['-p'], 'Install full Xcode and select its developer directory with xcode-select, then retry.');
    if (!developer.trim().endsWith('/Contents/Developer')) throw new Error('iOS setup requires full Xcode, not Command Line Tools. Select Xcode.app/Contents/Developer using xcode-select, then retry.');
    const xcode = await step('xcodebuild', ['-version'], 'Open full Xcode, finish its first-launch setup and license agreement, then retry.');
    if (!/^Xcode \d/m.test(xcode)) throw new Error('iOS setup requires full Xcode. Open Xcode and complete its first-launch setup, then retry.');
    await step('git', ['lfs', 'install', '--local'], 'Resolve the reported local LFS/hook conflict without overwriting existing hooks, then retry. Web setup remains available: npm run setup -- --web.');
    await step('git', ['lfs', 'pull', `--include=${weight}`, '--exclude='], 'Check Git LFS remote access/quota, then retry npm run setup -- --ios. Web setup remains available: npm run setup -- --web.');
    await step('/bin/sh', ['scripts/verify-ios-model.sh'], 'Model validation must pass before installing dependencies. Retry npm run setup -- --ios after resolving the reported error.');
  }
  await step('npm', ['ci'], 'Resolve the npm error, then retry the same setup command.');
}

export async function main({ args = process.argv.slice(2), nodeVersion = process.versions.node, npmVersion, platform = process.platform, run = runCommand } = {}) {
  const mode = parseMode(args);
  checkMode(mode, platform);
  checkNode(nodeVersion);
  checkVersions(nodeVersion, npmVersion ?? (await run('npm', ['--version'])).trim());
  await setup({ mode, platform, run });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(() => console.log('Setup complete. See README.md for web and optional iOS next steps.')).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
