// Drives the real FixList web build through the demo story and saves iPhone-sized screenshots
// (full page with the tab bar hidden, the tab bar on its own, and tap-target rectangles).
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173   (in another terminal; the dev
//   server's live-reload client stalls headless Chrome)
//   node scripts/promo/product/capture.mjs [--url http://127.0.0.1:4173] [--only name]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChrome, sleep } from './cdp.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] ?? true]] : acc), []));
const URL = args.url ?? 'http://127.0.0.1:4173';
const OUT = resolve(import.meta.dirname, '../../../recordings/product/shots');
const W = 402, H = 820, SCALE = 3; // iPhone 17 Pro width; height leaves room for the status bar and home indicator
mkdirSync(OUT, { recursive: true });

const helpers = `window.__fl = {
  visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; },
  find(text, within) {
    const root = within ? [...document.querySelectorAll(within)].at(-1) ?? document : document;
    const all = [...root.querySelectorAll('button, a, [role=button], label, summary, li, h1, h2, h3, p, span, div')]
      .filter((el) => this.visible(el) && el.innerText && el.innerText.trim().includes(text));
    all.sort((a, b) => a.innerText.length - b.innerText.length);
    const el = all[0];
    return el ? (el.closest('button, a, [role=button], label, summary') ?? el) : null;
  },
  click(text, within) { const el = this.find(text, within); if (!el) throw new Error('No element with text: ' + text); el.scrollIntoView({ block: 'center' }); el.click(); return true; },
  type(selector, text) {
    const el = [...document.querySelectorAll(selector)].filter((e) => this.visible(e)).at(-1);
    if (!el) throw new Error('No input ' + selector);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  rect(text, within) { const el = this.find(text, within); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; },
};`;

const { send, evaluate, close } = await openChrome({ width: W, height: H, scale: SCALE, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: helpers });
const js = (s) => evaluate(s);
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(700); };
const click = async (text, within, wait = 700) => { await js(`__fl.click(${JSON.stringify(text)}, ${JSON.stringify(within ?? null)})`); await sleep(wait); };
const type = async (sel, text) => { await js(`__fl.type(${JSON.stringify(sel)}, ${JSON.stringify(text)})`); await sleep(300); };
const meta = {};

async function shot(name, { full = true, targets = {} } = {}) {
  if (args.only && args.only !== name) return;
  await js('scrollTo(0, 0)'); await sleep(250);
  const rects = {};
  for (const [key, spec] of Object.entries(targets)) rects[key] = await js(`__fl.rect(${JSON.stringify(spec.text ?? spec)}, ${JSON.stringify(spec.within ?? null)})`);
  const tabs = await js(`(() => { const t = document.querySelector('.c-tabs'); if (!t) return null; const r = t.getBoundingClientRect(); return { y: r.y, h: r.height }; })()`);
  if (tabs) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: tabs.y, width: W, height: tabs.h, scale: 1 } });
    writeFileSync(resolve(OUT, `${name}-tabs.png`), Buffer.from(data, 'base64'));
  }
  let height = H;
  if (full) {
    await js(`document.querySelectorAll('.c-tabs').forEach((t) => t.style.visibility = 'hidden')`);
    height = Math.max(H, await js('document.documentElement.scrollHeight'));
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height, scale: 1 } });
    writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    await js(`document.querySelectorAll('.c-tabs').forEach((t) => t.style.visibility = '')`);
  } else {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }
  meta[name] = { full, height, tabs, rects };
  console.log(`shot ${name} (${height}px)`);
}

async function switchTo(name) {
  await click('Settings'); await click('Switch account'); await click(name, null, 1500);
}

try {
  await send('Page.navigate', { url: `${URL}/#/c/intro` }); await sleep(1500);
  await js('localStorage.clear(); location.reload()');
  for (let i = 0; i < 40 && !(await js(`!!document.querySelector('.community') && document.fonts.status === 'loaded'`).catch(() => false)); i++) await sleep(250);
  await sleep(500);

  await shot('intro', { targets: { start: 'Get started' } });
  await click('Get started');
  await shot('signin', { targets: { apple: 'Continue with Apple' } });
  await click('Continue with Apple');
  await shot('accounts', { full: false, targets: { margaret: 'Margaret Lee' } });
  await click('Margaret Lee', null, 1200);
  await shot('home', { targets: { mic: 'Talk to FixList', bulb: 'Replace a light bulb', room: 'Check a room' } });

  // Talk: the web build has no speech input, so the request is typed into the same conversation.
  await click('Talk to FixList', null, 1000);
  await shot('talk', { full: false });
  if (await js(`!!__fl.find('Type instead')`)) await click('Type instead');
  await type('textarea, input[type=text]', "The light in my hallway is out and I can't reach it.");
  await shot('talk-typed', { full: false });
  await js(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => __fl.visible(e) && /Send|Make my request/.test(e.innerText)).at(-1); b.click(); })()`); await sleep(2500);
  await shot('talk-reply', { targets: { post: 'Post this request' } });
  await click('Post this request', null, 1200);
  await shot('myhelp');

  // Check a room with the practice photos, then turn the flag into a request (not posted).
  await go('#/c/home'); await click('Check a room', null, 2500);
  await shot('rooms', { targets: { hallway: 'Hallway' } });
  await click('Hallway', null, 1200);
  if (await js(`!!__fl.find('Use the sample room photos')`)) await click('Use the sample room photos', null, 2500);
  await shot('room-flags', { targets: { ask: 'Ask for help with this' } });
  await click('Ask for help with this', null, 1500);
  await shot('room-draft');

  // Volunteer side.
  await go('#/c/home'); await switchTo('Jordan Kim'); await sleep(3500); // map tiles
  await shot('nearby', { targets: { see: { text: 'See request' } } });
  await js(`(() => { const card = [...document.querySelectorAll('article, section, li, div')].filter((e) => __fl.visible(e) && /Margaret/.test(e.innerText) && /See request/.test(e.innerText)).sort((a, b) => a.innerText.length - b.innerText.length)[0]; [...card.querySelectorAll('button, a')].find((b) => /See request/.test(b.innerText)).click(); })()`); await sleep(1500);
  await shot('job', { targets: { volunteer: 'Volunteer for this', why: 'Why this fits' } });
  await click('Volunteer for this', null, 1000);
  await js(`(() => { const s = [...document.querySelectorAll('[role=dialog] button, dialog button, .c-sheet button')].find((b) => __fl.visible(b) && /Sat/.test(b.innerText)); s?.click(); })()`); await sleep(500);
  await shot('accept', { full: false, targets: { slot: 'Sat,', accept: 'Accept this request' } });
  await click('Accept this request', null, 2500);
  await shot('trip', { targets: { way: 'on my way', directions: 'Directions' } });
  await click('on my way', null, 3000);
  await shot('trip-way', { targets: { arrived: 'arrived' } });
  await click('arrived', null, 1200);
  await click('Mark done', null, 1200);
  if (await js(`!!__fl.find('Mark done', '[role=dialog], dialog')`)) await click('Mark done', '[role=dialog], dialog', 1200);
  await shot('trip-done');

  // Back to Margaret: confirm and rate.
  await switchTo('Margaret Lee');
  await shot('home-confirm', { targets: { confirm: 'Confirm' } });
  await click('Confirm', null, 1200);
  await shot('confirm', { targets: { yes: 'Yes' } });
  if (await js(`!!__fl.find('Yes')`)) await click('Yes', null, 1000);
  await js(`(() => { const s = [...document.querySelectorAll('button, label, input')].filter((e) => __fl.visible(e) && /5/.test(e.getAttribute('aria-label') ?? e.innerText ?? '')).at(-1); s?.click(); })()`); await sleep(500);
  if (await js(`!!document.querySelector('textarea')`)) await type('textarea', 'Jordan was so kind and quick. Thank you!');
  await shot('rate', { targets: { send: 'Send' } });
  await js(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => __fl.visible(e) && /Send|Save|Done|Submit/.test(e.innerText)).at(-1); b?.click(); })()`); await sleep(1200);
  await shot('rated');

  await switchTo('Jordan Kim'); await go('#/c/profile'); await sleep(800);
  await shot('profile');

  await switchTo('Soon-ja Park'); await sleep(800);
  await shot('soonja-home');
  await go('#/c/help'); await sleep(800);
  await shot('soonja-help');
} finally {
  writeFileSync(resolve(OUT, 'shots.json'), JSON.stringify({ width: W, height: H, scale: SCALE, shots: meta }, null, 2));
  close();
}
