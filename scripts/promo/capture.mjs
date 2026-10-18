// Native Simulator recording only. Assets remain under ignored recordings/.
import { spawn } from 'node:child_process';
import { openSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const udid = process.env.PROMO_UDID || '133B41A2-044F-479A-AFC6-B6E3865F056C';
const pidFile = resolve(root, 'recordings/promo-raw/recording.pid');
const [action, name] = process.argv.slice(2);
if (action === 'start') {
  if (existsSync(pidFile)) throw new Error('Recording already active');
  if (!/^[a-z0-9-]+$/.test(name || '')) throw new Error('Use a simple clip name');
  const file = resolve(root, `recordings/promo-raw/${name}.mp4`);
  const fd = openSync(resolve(root, `recordings/promo-raw/${name}.log`), 'w');
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file], { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`Recording ${name}`);
} else if (action === 'stop') {
  const pid = Number(readFileSync(pidFile, 'utf8'));
  process.kill(pid, 'SIGINT');
  await new Promise(r => setTimeout(r, 1000));
  unlinkSync(pidFile);
  console.log('Recording stopped');
} else throw new Error('Usage: node scripts/promo/capture.mjs start NAME | stop');
