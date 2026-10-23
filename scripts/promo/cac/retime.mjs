// Visual timing proposals are never trusted as tap evidence without frame review.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { root, raw, work, ff, run, cached, sha, json, save, duration } from './common.mjs';

export const reviewFile = resolve(import.meta.dirname, 'retiming-review.json');
export function changePoints(metadata, threshold = .012) {
  const frames = [...metadata.matchAll(/pts_time:([\d.]+)\s+lavfi.scene_score=([\d.]+)/g)].map(m => ({ time: +m[1], score: +m[2] })).filter(f => f.score >= threshold);
  const clusters = [];
  for (const f of frames) {
    const last = clusters.at(-1);
    if (last && f.time - last.end <= .45) { last.end = f.time; if (f.score > last.score) { last.time = f.time; last.score = f.score; } }
    else clusters.push({ ...f, start: f.time, end: f.time });
  }
  return clusters;
}
export function proposeEvents(sidecar, points, length) {
  let previous = 0, previousWall = 0;
  return sidecar.events.map(e => {
    const wall = e.t - sidecar.recordStart, delta = wall - previousWall;
    // Long idle intervals have no usable wall-to-video conversion. Short deltas
    // offer only a soft prior; scrolls/animations still require visual review.
    const hint = previous ? previous + (delta > 0 && delta < 5 ? delta : 3) : Math.min(Math.max(wall, .3), 5);
    const candidates = points.filter(p => p.time > previous + .45 && p.time < length - .1);
    const selected = candidates.sort((a, b) => Math.abs(a.time - hint) - Math.abs(b.time - hint) || b.score - a.score)[0];
    if (selected) previous = selected.time;
    previousWall = wall;
    return { candidateVideoTime: selected ? Math.max(0, selected.time - .25) : null, candidateChangeTime: selected?.time ?? null, wallDeltaHintUsed: delta > 0 && delta < 5 };
  });
}
export function applyReview(sidecar, proposals, review, sourceSha256, sidecarSha256, length) {
  const trusted = review?.sourceSha256 === sourceSha256 && review?.sidecarSha256 === sidecarSha256;
  let previous = -Infinity;
  return sidecar.events.map((e, index) => {
    const r = trusted ? review.events?.find(r => r.index === index) : null;
    const evidence = r?.evidence;
    const hasProof = evidence && typeof evidence.before === 'string' && typeof evidence.after === 'string' && evidence.beforeTime < r.videoTime && evidence.afterTime > r.videoTime;
    if (!r || r.status !== 'reviewed' || !hasProof || !Number.isFinite(r.videoTime) || r.videoTime < 0 || r.videoTime >= length) return { ...e, ...proposals[index], ...(r?.status === 'proposed' ? { candidateVideoTime: r.videoTime, candidateChangeTime: r.changeTime ?? r.videoTime + .25 } : {}), videoTime: null, tapIndicator: false, retimeStatus: 'dropped', method: r?.note || 'No visually reviewed placement for the current source/sidecar hashes; omit indicator.' };
    if (r.videoTime <= previous) throw new Error(`Reviewed event order is not increasing at ${index}`);
    previous = r.videoTime;
    return { ...e, videoTime: r.videoTime, changeTime: r.changeTime ?? r.videoTime + .25, tapIndicator: r.tapIndicator !== false && !e.label.startsWith('type:'), retimeStatus: 'visually_reviewed', method: r.note, evidence: r.evidence };
  });
}

export function retimeClip(input, { extract = false } = {}) {
  const stem = basename(input, '.mp4'), folder = resolve(work, 'retime', stem);
  mkdirSync(folder, { recursive: true });
  const sidecarPath = resolve(raw, `${stem}.events.json`), sidecar = json(sidecarPath);
  const sourceSha256 = sha(input), sidecarSha256 = sha(sidecarPath), length = duration(input);
  const analysis = resolve(folder, 'normalized-30fps.mp4');
  cached(analysis, { sourceSha256, transform: 'retime-cfr30-402-v1' }, () => ff(['-i', input, '-vf', 'setpts=PTS-STARTPTS,fps=30,scale=402:874:flags=lanczos,setsar=1', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '4', '-pix_fmt', 'yuv420p', analysis]));
  const scores = resolve(folder, 'scene-scores.txt');
  cached(scores, { sourceSha256, transform: 'scene-201-threshold-012-v1' }, () => ff(['-i', analysis, '-vf', `scale=201:437,select='gte(scene,0)',metadata=print:file=${scores}`, '-an', '-f', 'null', '-']));
  const points = changePoints(readFileSync(scores, 'utf8'));
  const proposals = proposeEvents(sidecar, points, length);
  const reviews = existsSync(reviewFile) ? json(reviewFile) : {};
  const reviewed = applyReview(sidecar, proposals, reviews[stem], sourceSha256, sidecarSha256, length).map(e => e.retimeStatus === 'visually_reviewed' && (!existsSync(e.evidence.before) || !existsSync(e.evidence.after)) ? { ...e, videoTime: null, tapIndicator: false, retimeStatus: 'dropped', method: 'Visual evidence files are missing; omit indicator.' } : e);
  const events = reviewed.map((e, i) => {
    const at = Number.isFinite(e.videoTime) ? e.videoTime : e.candidateVideoTime;
    const change = e.changeTime ?? e.candidateChangeTime;
    if (!extract || !Number.isFinite(at)) return e;
    const before = resolve(folder, `${String(i).padStart(2, '0')}-before.png`), after = resolve(folder, `${String(i).padStart(2, '0')}-after.png`);
    const beforeTime = Math.max(0, at - .15), afterTime = Math.min(length - .05, change + .25);
    ff(['-ss', String(beforeTime), '-i', analysis, '-frames:v', '1', before]);
    ff(['-ss', String(afterTime), '-i', analysis, '-frames:v', '1', after]);
    return { ...e, evidence: { before, after, beforeTime, afterTime } };
  });
  const result = { ...sidecar, method: '30 fps visual scene-change candidates; events assigned in order; wall deltas under 5 s are weak hints only. Only source-hash-bound, visually reviewed placements receive tap indicators. Uncertain events are explicitly dropped.', sourceSha256, sidecarSha256, videoDuration: length, events };
  const output = resolve(raw, `${stem}.events.retimed.json`);
  save(output, result); save(resolve(folder, 'candidates.json'), { points, proposals, sourceSha256, sidecarSha256, videoDuration: length });
  if (extract) run(resolve(root, 'scan/venv-python'), [resolve(import.meta.dirname, 'retime-sheets.py'), output, folder]);
  console.log(`Retimed ${stem}: ${events.filter(e => e.retimeStatus === 'visually_reviewed').length} reviewed / ${events.filter(e => e.retimeStatus === 'dropped').length} omitted`);
  return result;
}
if (process.argv[1] === import.meta.filename) {
  const names = process.argv.slice(2).filter(s => !s.startsWith('--'));
  for (const name of names) retimeClip(resolve(raw, name.endsWith('.mp4') ? name : `${name}.mp4`), { extract: process.argv.includes('--inspect') });
}
