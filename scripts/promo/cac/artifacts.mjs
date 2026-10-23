import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, work, base, outBase, json, ff, run } from './common.mjs';
const test = process.argv.includes('--standins');
const renderWork = test ? resolve(base, 'standins/work') : work;
const artifactOutput = test ? resolve(base, 'standins/test-cac') : outBase;
const timing = json(resolve(renderWork, 'timings.json'));
const contact = resolve(renderWork, 'contact'), stills = resolve(renderWork, 'scene-stills');
mkdirSync(contact, { recursive: true }); mkdirSync(stills, { recursive: true });
ff(['-i', timing.output, '-vf', "select='not(mod(n,90))',scale=320:180:flags=lanczos", '-fps_mode', 'vfr', resolve(contact, 'frame-%03d.png')]);
for (const s of timing.scenes) {
  const t = s.id === '06' ? s.end - 3 : s.id === '08' ? s.start + 6 : s.start + Math.min(3, s.duration / 2);
  ff(['-ss', String(t), '-i', timing.output, '-frames:v', '1', resolve(stills, `scene-${s.id}.png`)]);
}
for (const [name, t] of [['scene-08-tools', 134], ['scene-08-test', 142], ['scene-08-hash', 147], ['scene-08-terminal', 152], ['scene-04-final', 54], ['scene-05-final', 94], ['scene-07-spanish', 130]]) ff(['-ss', String(t), '-i', timing.output, '-frames:v', '1', resolve(stills, `${name}.png`)]);
ff(['-ss', '54', '-i', timing.output, '-frames:v', '1', resolve(renderWork, 'thumbnail-source.png')]);
run(resolve(root, 'scan/venv-python'), [resolve(import.meta.dirname, 'artifacts.py'), renderWork, artifactOutput]);
console.log(`Wrote contact sheet, thumbnail and scene stills from ${timing.output}`);
