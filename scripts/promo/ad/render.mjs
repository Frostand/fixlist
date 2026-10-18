// Deterministic frame renderer for ad.html: seeks the timeline with renderAt(t)
// for every frame and pipes JPEG frames into ffmpeg (or writes test stills).
//   node scripts/promo/ad/render.mjs --stills 2,9.9,18 --out /tmp/stills
//   node scripts/promo/ad/render.mjs --video recordings/x.mp4 [--audio music.wav]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_HEADLESS ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const FPS = Number(args.fps ?? 30), DURATION = Number(args.duration ?? 45);
const port = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', '--window-size=1920,1080', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 100 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
if (!version) throw new Error('Chrome did not start.');
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(join(here, 'ad.html')).href });
for (let i = 0; i < 100; i++) { try { if (await evaluate('typeof window.ready !== "undefined"')) break; } catch { /* page still loading */ } await sleep(100); }
await evaluate('window.ready');

async function frameAt(t) {
  await evaluate(`window.renderAt(${t.toFixed(5)})`);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95, captureBeyondViewport: false });
  return Buffer.from(data, 'base64');
}

try {
  if (args.stills) {
    const out = resolve(args.out ?? '/tmp/fixlist-ad-stills'); mkdirSync(out, { recursive: true });
    for (const s of String(args.stills).split(',')) { writeFileSync(join(out, `t${Number(s).toFixed(2)}.jpg`), await frameAt(Number(s))); }
    console.log(`Wrote stills to ${out}`);
  } else {
    const output = resolve(args.video ?? 'recordings/fixlist-ad.mp4');
    const ffArgs = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
    if (args.audio) ffArgs.push('-i', resolve(args.audio));
    ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS));
    if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
    ffArgs.push('-movflags', '+faststart', output);
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = Math.round(DURATION * FPS);
    for (let f = 0; f < total; f++) {
      const buf = await frameAt(f / FPS);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 150 === 0) console.log(`frame ${f}/${total}`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`Wrote ${output}`);
  }
} finally {
  ws.close(); chrome.kill('SIGKILL');
}
