import { duration, phone, json, sha } from './common.mjs';
import { existsSync } from 'node:fs';

const relative = sidecar => sidecar.events.map(e => ({ ...e, at: Object.hasOwn(e, 'videoTime') ? e.videoTime : e.t - sidecar.recordStart })).filter(e => Number.isFinite(e.at) && e.at >= 0);
const find = (events, re) => events.find(e => re.test(e.label));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function editScene(s, source, sidecar, override = {}) {
  if (override.sourceSha256 && override.sourceSha256 !== sha(source)) throw new Error(`Edit windows belong to a different take: ${source}. Reinspect before editing.`);
  const retimed = source.replace(/\.mp4$/, '.events.retimed.json');
  if (existsSync(retimed)) {
    sidecar = json(retimed);
    if (sidecar.sourceSha256 !== sha(source)) throw new Error(`Retimed events do not match current clip: ${source}`);
  }
  return editTimeline(s, duration(source), sidecar, override);
}

export function editTimeline(s, length, sidecar, override = {}) {
  if (!Number.isFinite(length) || length < .1) throw new Error(`Invalid source duration for ${s.id}`);
  if (!Number.isFinite(sidecar.recordStart) || !Array.isArray(sidecar.events) || sidecar.events.some(e => !Number.isFinite(e.t) || typeof e.label !== 'string')) throw new Error(`Invalid event sidecar for ${s.id}`);
  const events = relative(sidecar).filter(e => e.at < length);
  let windows;
  if (override.windows) windows = override.windows;
  else if (s.id === '04' && find(events, /^Plan$/) && find(events, /Add to my plan/)) {
    const plan = find(events, /^Plan$/).at, confirm = find(events, /Add to my plan/).at;
    windows = [
      { from: .5, to: Math.min(plan - .5, (find(events, /^Yes$/)?.at || 5) + 1.6), duration: 5.2 },
      { from: plan - .6, to: confirm - .5, duration: 3 },
      { from: confirm - .5, to: length - .4, duration: s.duration - 8.2 },
    ];
  } else if (s.id === '01') windows = [{ from: .3, to: Math.min(length - .1, 8), duration: s.duration }];
  else {
    const ranges = [{ from: .3, to: Math.min(1.6, length) }, ...events.map(e => ({ from: Math.max(.2, e.at - .6), to: Math.min(length - .2, e.at + 1.5) })), { from: Math.max(.2, length - 2.8), to: length - .2 }].sort((a, b) => a.from - b.from);
    const merged = [];
    for (const r of ranges) { const last = merged.at(-1); if (last && r.from <= last.to + .25) last.to = Math.max(last.to, r.to); else merged.push({ ...r }); }
    const retained = merged.reduce((sum, r) => sum + r.to - r.from, 0);
    windows = merged.map(r => ({ ...r, duration: (r.to - r.from) / retained * s.duration }));
  }
  if (!windows.length || windows.some(w => !Number.isFinite(w.from) || !Number.isFinite(w.to) || !Number.isFinite(w.duration) || w.duration <= 0 || w.to <= w.from)) throw new Error(`Invalid edit windows for ${s.id}`);
  if (Math.abs(windows.reduce((sum, w) => sum + w.duration, 0) - s.duration) > 1 / 30) throw new Error(`Edit durations must sum to scene ${s.id}'s ${s.duration}s`);
  let at = 0;
  const segments = windows.map((w, i) => {
    const from = clamp(w.from, 0, length - .04), to = clamp(w.to, from + .04, length);
    const frames = i === windows.length - 1 ? Math.round(s.duration * 30) - Math.round(at * 30) : Math.max(1, Math.round(w.duration * 30));
    const d = frames / 30, segment = { index: i, from, to, duration: d, start: at, end: at + d, speed: (to - from) / d };
    at += d; return segment;
  });
  const taps = events.flatMap(e => {
    const seg = segments.find(r => e.at >= r.from && e.at < r.to);
    if (!seg || e.tapIndicator === false || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return [];
    return [{ label: e.label, time: seg.start + (e.at - seg.from) / seg.speed, x: phone.x + e.x / 402 * phone.w, y: phone.y + e.y / 874 * phone.h }];
  });
  return { sourceDuration: length, segments, taps, droppedEvents: sidecar.events.filter(e => e.retimeStatus === 'dropped').map(e => ({ label: e.label, reason: e.method })), zoom: override.zoom || null };
}
