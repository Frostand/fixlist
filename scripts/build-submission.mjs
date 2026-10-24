import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));

// envDir:false in the submission Vite config also excludes every .env file.
// Use a fresh child environment so this cannot change ordinary builds in-process.
export function submissionEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^VITE_/i.test(key)));
}

function runCommand(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`Submission build step failed (${signal ?? code}).`));
    });
  });
}

export async function buildSubmission({ ios = false, env = process.env, run = runCommand } = {}) {
  const options = { cwd: root, env: submissionEnvironment(env) };
  if (ios) await run('/bin/sh', [resolve(root, 'scripts/verify-ios-model.sh')], options);
  await run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-b'], options);
  await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'submission'], options);
  if (ios) await run(process.execPath, [resolve(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'ios'], {
    ...options, env: { ...options.env, FIXLIST_SUBMISSION: '1' },
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 1 && args[0] === '--ios');
  (valid ? buildSubmission({ ios: args[0] === '--ios' }) : Promise.reject(new Error('Usage: node scripts/build-submission.mjs [--ios]'))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
