import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, base, assets, raw, work, outBase, phone, ff, run, probe, duration, json, save, sha, srtTime, cached } from './common.mjs';
import { scenes, total, captions } from './scenes.mjs';
import { prepare } from './render-cards.mjs';
import { editScene } from './edit.mjs';
import { retimeClip } from './retime.mjs';
import { normalizeClip } from './normalize.mjs';

const standins = process.argv.includes('--standins');
const buildWork = standins ? resolve(base, 'standins/work') : work;
const imageDir = standins ? resolve(base, 'standins/assets') : assets;
mkdirSync(buildWork, { recursive: true });
const jobs = prepare();
if (process.argv.includes('--prepare')) process.exit(0);
if (standins) run(resolve(root, 'scan/venv-python'), [resolve(import.meta.dirname, 'standins.py'), imageDir, resolve(assets, 'render-jobs.json')]);
else {
  for (const s of scenes.filter(s => s.source)) {
    if (!existsSync(resolve(raw, s.source)) || !existsSync(resolve(raw, s.source.replace('.mp4', '.events.json')))) throw new Error(`Waiting for real clip + events: ${s.source}. Use --standins for isolated testing.`);
  }
  if (!existsSync(resolve(raw, 'READY'))) throw new Error('Waiting for parent raw/READY completion marker; final exports cannot use in-progress captures.');
  // A real build may only use cards rendered from the current HTML.
  if (jobs.some(j => !existsSync(j.png) || !existsSync(`${j.png}.html-sha256`) || readFileSync(`${j.png}.html-sha256`, 'utf8') !== j.htmlSha256)) throw new Error('Current HTML cards require the parent to run: node scripts/promo/cac/render-cards.mjs. This worker will not re-render cards.');
}
const output = standins ? resolve(buildWork, 'test-demo.mp4') : `${outBase}-demo.mp4`;
const novoice = standins ? resolve(buildWork, 'test-novoice.mp4') : `${outBase}-demo-novoice.mp4`;
const srt = standins ? resolve(buildWork, 'test.srt') : `${outBase}-demo.srt`;
writeFileSync(srt, captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}\n`).join('\n'));
const overrideFile = resolve(import.meta.dirname, 'edits.json');
const overrides = existsSync(overrideFile) ? json(overrideFile) : {};
const ledger = [];
const image = name => resolve(imageDir, `${name}.png`);
const videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '4', '-pix_fmt', 'yuv420p', '-r', '30'];

for (const s of scenes.filter(s => s.source)) {
  let input = resolve(raw, s.source), sidecar;
  if (standins) {
    input = resolve(buildWork, s.source);
    cached(input, 'stand-in-testsrc-v1', () => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1206x2622:rate=15:duration=4', '-an', ...videoArgs, input]));
    sidecar = { recordStart: 0, events: [{ t: 1.2, label: 'stand-in tap', x: 200, y: 450 }] };
  } else sidecar = json(resolve(raw, s.source.replace('.mp4', '.events.json')));
  const { inputSha256, normal, normalization } = normalizeClip(input, s.id, buildWork);
  if (!standins) sidecar = retimeClip(input);
  const edit = editScene(s, input, sidecar, standins ? {} : overrides[s.id]);
  const segmentFiles = [];
  for (const seg of edit.segments) {
    const f = resolve(buildWork, `${s.id}-part-${seg.index}.mp4`);
    cached(f, { inputSha256, seg, phone }, () => ff(['-ss', String(seg.from), '-i', normal, '-t', String(seg.to - seg.from), '-vf', `setpts=(PTS-STARTPTS)/${seg.speed},fps=30,scale=${phone.w}:${phone.h}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${seg.duration},trim=duration=${seg.duration}`, '-an', ...videoArgs, '-t', String(seg.duration), f]));
    segmentFiles.push(f);
  }
  const list = resolve(buildWork, `${s.id}-parts.txt`);
  writeFileSync(list, segmentFiles.map(f => `file '${f}'`).join('\n'));
  const phoneFile = resolve(buildWork, `${s.id}-phone.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-an', '-c:v', 'copy', phoneFile]);
  ledger.push({ scene: s.id, raw: input, sha256: inputSha256, sidecar, normal, normalization, phoneFile, ...edit });
  console.log(`Normalized and edited real=${!standins}: scene ${s.id} (${edit.segments.length} cuts)`);
}

function captionTrack(s) {
  const cues = captions.filter(c => c.scene === s.id), track = []; let at = 0;
  const add = (file, seconds) => { if (seconds > .0001) track.push(`file '${file}'\noption framerate 30\nduration ${seconds.toFixed(7)}`); };
  for (const c of cues) { const start = Math.round((c.start - s.start) * 30) / 30, end = Math.round((c.end - s.start) * 30) / 30; add(image(`blank-${s.source ? 1100 : 1680}`), start - at); add(image(c.id), end - start); at = end; }
  add(image(`blank-${s.source ? 1100 : 1680}`), s.duration - at + .1);
  track.push(`file '${image(`blank-${s.source ? 1100 : 1680}`)}'\noption framerate 30`);
  const list = resolve(buildWork, `${s.id}-captions.txt`); writeFileSync(list, track.join('\n')); return list;
}
const sceneFiles = [];
for (const s of scenes) {
  const f = resolve(buildWork, `scene-${s.id}.mp4`), entry = ledger.find(l => l.scene === s.id);
  const args = [], filters = []; let nextInput = 0, last;
  const input = (path, loop = false) => { const n = nextInput++; if (loop) args.push('-loop', '1', '-framerate', '30'); args.push('-i', path); return n; };
  const overlay = (stream, x, y, enable) => { const out = `o${filters.length}`; filters.push(`[${last}][${stream}]overlay=x=${x}:y=${y}:shortest=1${enable ? `:enable='${enable}'` : ''}[${out}]`); last = out; };
  if (entry) {
    input(image(`scene-${s.id}`), true); last = '0:v';
    const p = input(entry.phoneFile), m = input(image('mask'), true);
    filters.push(`[${p}:v]format=rgba[p]`, `[${m}:v]format=gray[m]`, '[p][m]alphamerge[screen]');
    overlay('screen', phone.x, phone.y);
    if (s.id === '06' && entry.zoom) {
      const z = entry.zoom, still = resolve(buildWork, 'model-photo-zoom.png');
      const zoomWidth = z.questionCrop ? 350 : 1000;
      ff(['-ss', String(z.sourceTime), '-i', entry.normal, '-frames:v', '1', '-vf', `crop=${z.crop[2] * 3}:${z.crop[3] * 3}:${z.crop[0] * 3}:${z.crop[1] * 3},scale=${zoomWidth}:400:force_original_aspect_ratio=decrease,pad=${zoomWidth}:400:(ow-iw)/2:(oh-ih)/2:color=0x16302b`, still]);
      const bg = input(image('scene-06-zoom'), true), zoom = input(still, true), label = input(image('zoom-label'), true);
      // Cover only the left text area; retain the live phone at full size.
      filters.push(`[${bg}:v]crop=1240:1080:0:0[zoom-bg]`); overlay('zoom-bg', 0, 0, `gte(t,${z.at})`);
      overlay(`${zoom}:v`, 155, 397, `gte(t,${z.at})`); overlay(`${label}:v`, 155, 331, `gte(t,${z.at})`);
      if (z.questionCrop) {
        const q = z.questionCrop, questionFile = resolve(buildWork, 'model-photo-question.png');
        ff(['-ss', String(z.sourceTime), '-i', entry.normal, '-frames:v', '1', '-vf', `crop=${q[2] * 3}:${q[3] * 3}:${q[0] * 3}:${q[1] * 3},scale=660:-2:flags=lanczos`, questionFile]);
        const question = input(questionFile, true); overlay(`${question}:v`, 535, 430, `gte(t,${z.at})`);
      }
    }
    if (entry.taps.length) {
      const tap = input(image('tap'), true);
      for (const e of entry.taps) overlay(`${tap}:v`, (e.x - 30).toFixed(2), (e.y - 30).toFixed(2), `between(t,${e.time.toFixed(4)},${(e.time + .34).toFixed(4)})`);
    }
  } else {
    const variants = s.id === '08' ? [
      ['scene-08-tools', 5], ['scene-08-role', 4.2], ['scene-08-test', 3.7], ['scene-08-hash', 5], ['scene-08-terminal', 5.1],
    ] : [[`scene-${s.id}`, s.duration]];
    const labels = [];
    variants.forEach(([name, d], i) => { const n = input(image(name), true); filters.push(`[${n}:v]trim=duration=${d},setpts=PTS-STARTPTS,format=rgba[c${i}]`); labels.push(`[c${i}]`); });
    filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[cards]`); last = 'cards';
  }
  const cap = nextInput++; args.push('-f', 'concat', '-safe', '0', '-i', captionTrack(s));
  filters.push(`[${cap}:v]fps=30,format=rgba[captions]`); overlay('captions', s.source ? 112 : 120, 876);
  filters.push(`[${last}]trim=duration=${s.duration},format=yuv420p[v]`);
  ff([...args, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[v]', '-an', ...videoArgs, '-t', String(s.duration), f]);
  sceneFiles.push(f); console.log(`Rendered scene ${s.id}: ${s.start}–${s.end}`);
  const actualScene = probe(f).streams.find(v => v.codec_type === 'video');
  if (Number(actualScene.nb_frames) !== Math.round(s.duration * 30) || Math.abs(Number(actualScene.duration) - s.duration) > 1 / 30) throw new Error(`Scene ${s.id} lost frames: ${actualScene.nb_frames} / ${s.duration}s`);
}
const concat = resolve(buildWork, 'scenes.txt'), visual = resolve(buildWork, 'visual.mp4');
writeFileSync(concat, sceneFiles.map(f => `file '${f}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', concat, '-an', '-c:v', 'copy', visual]);
const voiceArgs = [], voiceFilters = [];
scenes.forEach((s, i) => { voiceArgs.push('-i', s.voice); voiceFilters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(s.voiceStart * 1000)}:all=1[a${i}]`); });
voiceFilters.push(`${scenes.map((s, i) => `[a${i}]`).join('')}amix=inputs=9:normalize=0:duration=longest,apad,atrim=duration=${total}[a]`);
const voiceRaw = resolve(buildWork, 'voice-raw.wav');
ff([...voiceArgs, '-filter_complex', voiceFilters.join(';'), '-map', '[a]', '-c:a', 'pcm_s24le', voiceRaw]);
const measure = run('ffmpeg', ['-hide_banner', '-i', voiceRaw, '-af', 'loudnorm=I=-16:TP=-2.0:LRA=11:print_format=json', '-f', 'null', '-']).stderr;
writeFileSync(resolve(buildWork, 'normalization-pass1.log'), measure);
const m = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1));
const voice = resolve(buildWork, 'voice-normalized.wav');
ff(['-i', voiceRaw, '-af', `loudnorm=I=-16:TP=-2.0:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', voice]);
ff(['-i', visual, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(total), '-movflags', '+faststart', output]);
ff(['-i', visual, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', novoice]);
const timing = { standins, total, output, novoice, srt, scenes, captions, ledger, editOverrides: overrides };
save(resolve(buildWork, 'timings.json'), timing);
if (!standins) {
  run(process.execPath, [resolve(import.meta.dirname, 'artifacts.mjs')]);
  run(process.execPath, [resolve(import.meta.dirname, 'verify.mjs')]);
}
console.log(JSON.stringify({ output, novoice, duration: duration(output), realFootage: !standins }, null, 2));
