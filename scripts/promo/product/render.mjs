// Renders product.html frame by frame (renderAt(t)) into stills or an MP4.
//   node scripts/promo/product/render.mjs --stills 2,10,15 --out recordings/product/stills
//   node scripts/promo/product/render.mjs --video recordings/fixlist-product-video.mp4 --audio recordings/product/music.wav
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from './cdp.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const FPS = Number(args.fps ?? 30), DURATION = Number(args.duration ?? 45);
const meta = readFileSync(resolve(import.meta.dirname, '../../../recordings/product/shots/shots.json'), 'utf8');

const { send, evaluate, close } = await openChrome({ width: 1920, height: 1080 });
await send('Page.navigate', { url: pathToFileURL(resolve(import.meta.dirname, 'product.html')).href });
for (let i = 0; i < 100; i++) { try { if (await evaluate('typeof window.init === "function"')) break; } catch { /* still loading */ } await sleep(100); }
await evaluate(`window.init(${meta})`);

async function frameAt(t) {
  await evaluate(`window.renderAt(${t.toFixed(5)})`);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
  return Buffer.from(data, 'base64');
}

try {
  if (args.stills) {
    const out = resolve(args.out ?? 'recordings/product/stills'); mkdirSync(out, { recursive: true });
    for (const s of String(args.stills).split(',')) writeFileSync(join(out, `t${Number(s).toFixed(2)}.jpg`), await frameAt(Number(s)));
    console.log(`Wrote stills to ${out}`);
  } else {
    const output = resolve(args.video ?? 'recordings/fixlist-product-video.mp4');
    const ff = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
    if (args.audio) ff.push('-i', resolve(args.audio));
    ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS));
    if (args.audio) ff.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
    ff.push('-movflags', '+faststart', output);
    const proc = spawn(process.env.FFMPEG ?? 'ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = Math.round(DURATION * FPS);
    for (let f = 0; f < total; f++) {
      const buf = await frameAt(f / FPS);
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r));
      if (f % 150 === 0) console.log(`frame ${f}/${total}`);
    }
    proc.stdin.end();
    await new Promise((r) => proc.on('close', r));
    console.log(`Wrote ${output}`);
  }
} finally {
  close();
}
