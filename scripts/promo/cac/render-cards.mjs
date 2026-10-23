import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, base, assets, phone, esc, chromium, run, save, sha } from './common.mjs';
import { scenes, captions, excerpts } from './scenes.mjs';

const data = (p, mime) => `data:${mime};base64,${readFileSync(resolve(root, p)).toString('base64')}`;
const logo = data('public/favicon.svg', 'image/svg+xml');
const slab = data('node_modules/@fontsource/zilla-slab/files/zilla-slab-latin-700-normal.woff2', 'font/woff2');
const body = data('node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2', 'font/woff2');
const fonts = `@font-face{font-family:Slab;src:url('${slab}');font-weight:700}@font-face{font-family:Body;src:url('${body}');font-weight:100 900}`;
const css = `${fonts}*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#eef1ec;color:#16302b;font:34px Body}h1,h2,p{margin:0}h1,h2{font:700 82px/1.05 Slab;letter-spacing:-1.5px}.brand{position:absolute;left:112px;top:72px;display:flex;gap:18px;align-items:center;font-weight:800;font-size:34px}.brand img{width:66px;height:66px}.eyebrow{font-size:24px;letter-spacing:3px;font-weight:750;color:#4c6660}.copy{position:absolute;left:112px;top:275px;width:1080px}.copy h1{max-width:1040px}.copy p{font:500 40px/1.4 Body;margin-top:34px;color:#405c54}.note{position:absolute;left:112px;top:730px;width:1070px;font:650 26px/1.4 Body;color:#405c54}.accent{width:90px;height:11px;background:#f4c430;border-radius:10px;margin:0 0 30px}.rail{position:absolute;left:112px;right:112px;top:174px;height:2px;background:#d3dfd5}.device{position:absolute;left:${phone.x - 14}px;top:${phone.y - 14}px;width:${phone.w + 28}px;height:${phone.h + 28}px;background:#102722;border:2px solid #40564f;border-radius:68px;box-shadow:0 20px 55px #16302b35}.purpose{font:500 43px/1.3 Body;width:1450px;max-width:1450px}.tools{font:700 28px/1.4 Body;color:#405c54}.source{font:500 26px/1.45 Body;color:#405c54}.code{position:absolute;left:112px;right:112px;top:310px;background:#16302b;border-radius:26px;padding:35px 42px;color:#eef1ec;box-shadow:0 20px 50px #16302b18}.code .path{font:700 27px Body;color:#f4c430;margin-bottom:25px}.code pre{font:27px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.code-foot{position:absolute;left:112px;top:810px;color:#405c54;font-size:28px}.endtitle{position:absolute;left:112px;top:194px;font:700 68px Slab}.disclosures{position:absolute;left:112px;right:112px;top:285px;font:500 30px/1.5 Body}.credits{position:absolute;left:112px;right:112px;top:483px;border-top:2px solid #cbd8cd;padding-top:26px;font:500 28px/1.55 Body;color:#405c54}.credits strong{color:#16302b}.license{margin-top:14px;font-weight:800;color:#16302b}`;
const brand = `<div class="brand"><img src="${logo}"><span>FixList</span></div>`;
const html = (content, extra = '') => `<!doctype html><meta charset="utf-8"><style>${css}${extra}</style><body>${content}</body>`;
export const jobs = [];
function add(name, body, width = 1920, height = 1080, transparent = false) {
  const file = resolve(assets, `${name}.html`), png = resolve(assets, `${name}.png`);
  writeFileSync(file, body);
  jobs.push({ name, file, png, width, height, transparent, htmlSha256: sha(file) });
}
export function prepare() {
  jobs.length = 0;
  for (const s of scenes.filter(s => s.source)) add(`scene-${s.id}`, html(`${brand}<div class="device"></div><div class="copy"><div class="accent"></div><h1>${esc(s.title)}</h1><p>${esc(s.body).replaceAll('\n', '<br>')}</p></div><div class="note">${esc(s.note).replaceAll('\n', '<br>')}</div>`));
  add('scene-06-zoom', html(`${brand}<div class="device"></div><div style="position:absolute;left:112px;top:205px;width:1090px"><h1 style="font-size:58px">A photo question.<br>A person decides.</h1></div><div class="note" style="top:812px">Unverified model output · may be wrong · not a finding</div>`));
  add('scene-02', html(`${brand}<div class="rail"></div><div style="position:absolute;left:112px;top:225px"><div class="eyebrow">CREATED BY ANDREW LIEU</div><h1 style="font-size:130px;margin-top:18px">FixList</h1><p class="purpose" style="margin-top:24px">FixList helps a family check an older relative’s home for fall risks, agree on what to fix, and get the fixes done with people they trust.</p><p style="font-size:34px;margin-top:34px">For older adults, their families, and the volunteers who help.</p><p class="tools" style="margin-top:32px">TypeScript · React · Swift (ARKit) · Python · Capacitor · three.js</p></div>`));
  add('scene-03', html(`${brand}<div class="copy" style="top:238px;width:1600px"><div class="eyebrow">WHY FOLLOW-THROUGH MATTERS</div><h1 style="font-size:140px;margin-top:28px">About 1 in 4</h1><p style="font-size:48px">adults 65+ falls each year — CDC</p><p style="font-size:42px;margin-top:55px">After a fall: a paper checklist,<br>and nobody tracking who fixes what.</p></div><div class="source" style="position:absolute;left:112px;top:820px">CDC · Older Adult Fall Prevention · cdc.gov/falls</div>`));
  add('scene-08-tools', html(`${brand}<div class="copy" style="top:245px;width:1600px"><div class="eyebrow">UNDER THE HOOD</div><h1>Built around explicit rules.</h1><p style="font-size:44px">TypeScript + React<br>Capacitor + Swift / ARKit<br>Python · ffmpeg · COLMAP · Brush<br>three.js + Spark</p></div>`));
  const code = (name, title, path, excerpt, foot, size = 27) => add(name, html(`${brand}<h1 style="position:absolute;left:112px;top:195px;font-size:64px">${esc(title)}</h1><div class="code"><div class="path">${esc(path)}</div><pre style="font-size:${size}px">${esc(excerpt)}</pre></div><p class="code-foot">${esc(foot)}</p>`));
  code('scene-08-role', 'Sharing is a rule in the app’s core.', 'src/domain/role-views.ts · visibleRequestsFor', excerpts.role, 'Optional fields appear only when the resident shares them.', 26);
  code('scene-08-test', 'The permission boundary has a test.', 'src/domain/roles.test.ts', excerpts.test, 'Real source excerpt · wrapping adjusted for this card.', 25);
  code('scene-08-hash', 'Results belong to the exact photos.', 'src/lib/capture-suggestions.ts', excerpts.hash, 'SHA-256 photo identity · mismatched bundles are rejected.', 29);
  add('scene-08-terminal', html(`${brand}<div class="copy" style="top:210px;width:1600px"><h1>Rules, checked automatically.</h1></div><div class="code" style="top:355px;padding:46px"><div class="path">$ npx vitest run</div><pre style="font-size:50px;line-height:1.8">Test Files  58 passed (58)\n     Tests  1547 passed (1547)</pre><p style="font-size:27px;margin-top:32px;color:#b9d2c5">Current build · parent-run result</p></div>`));
  add('scene-09', html(`${brand}<div class="endtitle">Created by Andrew Lieu</div><div class="disclosures">Demo: fictional household, demo profiles on one phone, no real accounts.<br>AI coding tools helped build FixList; see the submission’s AI disclosure.<br>Narration: synthesized voice (Kokoro-82M).</div><div class="credits"><strong>Sources & credits</strong><br>CDC “Check for Safety” (paraphrased) · Eldercare Locator (ACL)<br>Sample: “UE4Arch.com – Viennese apartment” by UE4Arch.com<br>Wikimedia Commons · CC BY-SA 4.0 · trimmed/reconstructed, changes made<br>Local model: StartLux-Decision · weights CC BY-NC 4.0<br>Fonts: Atkinson Hyperlegible, Zilla Slab · SIL OFL<br><div class="license">This video: CC BY-SA 4.0</div></div>`));
  for (const c of captions) add(c.id, `<!doctype html><meta charset="utf-8"><style>${fonts}*{box-sizing:border-box}body{margin:0;background:transparent;width:${c.besidePhone ? 1100 : 1680}px;height:150px;display:flex;align-items:flex-end;justify-content:center;font:650 44px/1.2 Body;color:white}.cap{background:#102722f5;text-align:center;border-radius:14px;padding:13px 20px 16px;width:max-content;max-width:100%;margin-bottom:0}.line{display:block;white-space:nowrap}</style><body><div class="cap">${c.lines.map(l => `<span class="line">${esc(l)}</span>`).join('')}</div></body>`, c.besidePhone ? 1100 : 1680, 150, true);
  for (const w of [1100, 1680]) add(`blank-${w}`, `<style>body{margin:0;background:transparent}</style>`, w, 150, true);
  add('mask', `<style>*{box-sizing:border-box}body{margin:0;background:black}div{width:${phone.w}px;height:${phone.h}px;border-radius:${phone.radius}px;background:white}</style><div></div>`, phone.w, phone.h);
  add('tap', '<style>body{margin:0;background:transparent}div{box-sizing:border-box;margin:3px;width:54px;height:54px;border-radius:50%;border:3px solid #e4ad18;background:#f4c43040;box-shadow:0 0 0 2px #ffffffb0}</style><div></div>', 60, 60, true);
  add('zoom-label', `<!doctype html><meta charset="utf-8"><style>${fonts}body{margin:0;background:#16302b;color:white;font:700 28px Body;padding:12px 20px}</style>model's photo (zoomed)`, 550, 64);
  save(resolve(assets, 'render-jobs.json'), jobs);
  save(resolve(base, 'card-copy.json'), { titles: scenes.map(s => ({ id: s.id, title: s.title, body: s.body, note: s.note })), excerpts, captions });
  return jobs;
}
export function render() {
  for (const j of prepare()) {
    const cache = `${j.png}.html-sha256`;
    if (existsSync(j.png) && existsSync(cache) && readFileSync(cache, 'utf8') === j.htmlSha256) continue;
    const args = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000', `--window-size=${j.width},${j.height}`, `--screenshot=${j.png}`];
    if (j.transparent) args.push('--default-background-color=00000000');
    run(chromium, [...args, `file://${j.file}`]);
    writeFileSync(cache, j.htmlSha256); console.log(`HTML rendered: ${j.name}`);
  }
}
if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--prepare')) { prepare(); console.log(`Prepared ${jobs.length} HTML cards/sprites; render with node scripts/promo/cac/render-cards.mjs`); }
  else render();
}
