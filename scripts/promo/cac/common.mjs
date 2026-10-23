import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const root = resolve(import.meta.dirname, '../../..');
export const base = resolve(root, 'recordings/cac-video');
export const work = resolve(base, 'work');
export const assets = resolve(base, 'assets');
export const raw = resolve(base, 'raw');
export const outBase = resolve(root, 'recordings/2026-10-25-fixlist-cac');
export const chromium = process.env.PROMO_CHROMIUM || resolve(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
export const phone = { x: 1320, y: 54, w: 448, h: 974, radius: 52 };
for (const p of [base, work, assets]) mkdirSync(p, { recursive: true });
export const json = p => JSON.parse(readFileSync(p, 'utf8'));
export const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
export const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${cmd}: ${r.error?.message || r.stderr || r.stdout || `exit ${r.status}`}`);
  return r;
}
export const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
export const probe = p => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p]).stdout);
export const duration = p => Number(probe(p).format.duration);
export const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export function srtTime(t) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function cached(output, key, fn) {
  const keyFile = `${output}.cache.json`;
  if (existsSync(output) && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === JSON.stringify(key)) return;
  fn(); writeFileSync(keyFile, JSON.stringify(key));
}
