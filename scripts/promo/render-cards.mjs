import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
export const root = resolve(import.meta.dirname, '../..');
export const assets = resolve(root, 'recordings/promo-assets');
export const chromium = process.env.PROMO_CHROMIUM || resolve(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
export const storyboard = JSON.parse(readFileSync(resolve(import.meta.dirname, 'storyboard.json'), 'utf8'));
const data = (p, mime) => `data:${mime};base64,${readFileSync(resolve(root, p)).toString('base64')}`;
const logo = data('public/favicon.svg', 'image/svg+xml');
const slab = data('node_modules/@fontsource/zilla-slab/files/zilla-slab-latin-700-normal.woff2', 'font/woff2');
const body = data('node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2', 'font/woff2');
const esc = s => String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '<br>');
export function geometry(layout) {
  if (layout === 'triple') return [230, 780, 1330].map(x => ({ x, y:220, w:358, h:780, radius:42 }));
  if (layout === 'double') return [810, 1370].map(x => ({ x, y:180, w:382, h:830, radius:46 }));
  return [{ x:1290, y:70, w:432, h:940, radius:50 }];
}
export function renderHtml(name, html, width=1920, height=1080, transparent=false) {
  mkdirSync(assets, { recursive:true });
  const file = resolve(assets, `${name}.html`), png = resolve(assets, `${name}.png`);
  writeFileSync(file, html);
  const args = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000', `--window-size=${width},${height}`, `--screenshot=${png}`];
  if (transparent) args.push('--default-background-color=00000000');
  args.push(`file://${file}`);
  const r = spawnSync(chromium, args, { encoding:'utf8' });
  if (r.status) throw new Error(r.stderr);
  return png;
}
const css = `@font-face{font-family:Slab;src:url('${slab}');font-weight:700}@font-face{font-family:Body;src:url('${body}');font-weight:100 900}*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#eef1ec;color:#16302b;font:32px Body}h1,h2,p{margin:0}h1,h2{font-family:Slab;font-weight:700}h1{font-size:80px;line-height:1.04;letter-spacing:-1.8px}img{display:block}.brand{position:absolute;left:112px;top:86px;display:flex;align-items:center;gap:20px;font-weight:750;font-size:30px}.brand img{width:64px;height:64px}.brand span{letter-spacing:3px;font-size:21px}.kicker{font-weight:750;font-size:23px;letter-spacing:2.2px;margin-bottom:28px;color:#405c54}.copy{position:absolute;left:128px;top:315px;width:1030px}.copy .subline{margin-top:32px;font-size:34px;line-height:1.35;color:#405c54}.accent{width:86px;height:10px;background:#f4c430;border-radius:9px;margin-bottom:30px}.footer{position:absolute;left:128px;bottom:77px;font-size:20px;letter-spacing:1.1px;color:#52665e}.phone{position:absolute;background:#16302b;box-shadow:0 18px 48px #16302b26,0 3px 8px #16302b1c;border:1px solid #50635c}.role-label{position:absolute;text-align:center;width:470px}.triple .role-label strong{font-size:27px}.triple .role-label span{font-size:23px}.role-label strong{display:block;font-size:29px;font-weight:800;line-height:1.1}.role-label span{display:block;font-size:25px;line-height:1.15;margin-top:5px;color:#405c54}.title{position:absolute;left:128px;right:128px;top:186px;text-align:center}.title img{width:160px;height:160px;margin:0 auto 28px}.title h1{font-size:154px}.title .subline{font-size:51px;line-height:1.3;margin-top:30px}.title .detail{font-size:28px;margin-top:52px;color:#405c54}.tag{display:inline-block;padding:11px 20px;border-radius:100px;background:#f4c430;font-size:21px;font-weight:800;letter-spacing:1.5px;margin-top:35px}.orb{position:absolute;right:-190px;top:-290px;width:740px;height:740px;border:1px solid #cdd9cb;border-radius:50%}.orb:after{content:'';position:absolute;inset:90px;border:1px solid #d6dfd3;border-radius:50%}.problem{position:absolute;left:156px;top:208px;display:flex;gap:110px;align-items:center}.problem h1{font-size:89px;line-height:1.25;max-width:900px}.problem .message{width:520px;font:700 53px/1.15 Slab}.problem .message:before{content:'';display:block;width:96px;height:12px;background:#f4c430;border-radius:9px;margin-bottom:35px}.end .title{top:76px}.end .title img{width:94px;height:94px;margin-bottom:14px}.end .title h1{font-size:102px}.end .title .subline{font-size:50px;margin-top:15px}.end .disclosures{position:absolute;left:170px;right:170px;top:430px;text-align:center;font-size:27px;line-height:1.5;padding:28px;border-top:2px solid #cbd7cb;border-bottom:2px solid #cbd7cb}.end .credits{position:absolute;left:150px;right:150px;top:641px;text-align:center;font-size:23px;line-height:1.55;color:#405c54}.end .credits br{display:block;margin-bottom:6px}.end .bottom{position:absolute;left:128px;bottom:66px;font-size:20px;color:#52665e;letter-spacing:1px}`;
export function cardHtml(shot) {
  const layout=shot.layout, geo=geometry(layout);
  let content = '<div class="orb"></div>';
  if (layout==='title'||layout==='end') {
    content += `<div class="title"><img src="${logo}"><h1>${esc(shot.headline)}</h1><p class="subline">${esc(shot.subline)}</p>${layout==='title'?`<p class="detail">${esc(shot.detail)}</p><div class="tag">iOS DEMO</div>`:''}</div>`;
    if(layout==='end')content+=`<div class="disclosures">${esc(shot.detail)}</div><div class="credits">${esc(shot.credits)}</div><div class="bottom">FICTIONAL DEMO · CAPTURED ON iOS SIMULATOR</div>`;
  } else if (layout==='problem') {
    content+=`<div class="brand"><img src="${logo}"><b>FixList</b></div><div class="problem"><h1>${esc(shot.headline)}</h1><div class="message">${esc(shot.subline)}</div></div><div class="footer">A LITTLE HELP, ONE STEP AT A TIME.</div>`;
  } else {
    for(const g of geo)content+=`<div class="phone" style="left:${g.x-12}px;top:${g.y-12}px;width:${g.w+24}px;height:${g.h+24}px;border-radius:${g.radius+12}px"></div>`;
    if(layout==='triple')content+=`<h1 style="position:absolute;top:60px;left:128px;right:128px;text-align:center;font-size:62px">${esc(shot.headline)}</h1>`;
    else content+=`<div class="brand"><img src="${logo}"><b>FixList</b><span>iOS DEMO</span></div><div class="copy" style="${layout==='double'?'width:610px;top:370px':''}"><div class="accent"></div>${shot.kicker?`<p class="kicker">${esc(shot.kicker)}</p>`:''}<h1 style="${layout==='double'?'font-size:70px':''}">${esc(shot.headline)}</h1>${shot.subline?`<p class="subline">${esc(shot.subline)}</p>`:''}</div><div class="footer">FICTIONAL DEMO · CAPTURED ON iOS SIMULATOR</div>`;
    if(layout==='triple'||layout==='double')for(let i=0;i<geo.length;i++){const g=geo[i],p=shot.phones[i];content+=`<div class="role-label" style="left:${g.x+g.w/2-235}px;top:${layout==='triple'?142:80}px"><strong>${esc(p.label)}</strong><span>${esc(p.description)}</span></div>`;}
  }
  return `<!doctype html><meta charset="utf-8"><style>${css}</style><body class="${['title','problem'].includes(layout)?`scene-${layout}`:layout}">${content}</body>`;
}
export function renderAll() {
  for(const scene of storyboard.scenes)for(const shot of scene.shots){
    renderHtml(shot.id, cardHtml(shot));
    if(shot.phones)for(const g of geometry(shot.layout)){
      renderHtml(`mask-${g.w}-${g.h}`,`<style>*{box-sizing:border-box}body{margin:0;background:black;width:${g.w}px;height:${g.h}px}div{width:100%;height:100%;border-radius:${g.radius}px;background:white}</style><div></div>`,g.w,g.h);
    }
    console.log(`Card ${shot.id}`);
  }
}
if(process.argv[1]===import.meta.filename)renderAll();
