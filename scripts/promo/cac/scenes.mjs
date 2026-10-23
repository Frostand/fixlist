import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, base, duration } from './common.mjs';

const lines = new Map(readFileSync(resolve(base, 'vo/lines.tsv'), 'utf8').trim().split('\n').map(l => l.split('\t')));
const specs = [
  [1, 'A room rebuilt in 3D', 7.5, 's01-hook.mp4', 'A walk-through becomes a room you can revisit.', 'Sample architectural render · CC BY-SA 4.0\nReconstructed, not a real home'],
  [2, 'Meet FixList', 16.5],
  [3, 'Why follow-through matters', 12],
  [4, 'A Yes is only the first step.', 22, 's04-check.mp4', 'Margaret answers.\nMargaret confirms.\nThen it enters the plan.', 'Next steps based on the CDC checklist'],
  [5, 'Margaret stays in control.', 39, 's05-help.mp4', 'She chooses what to share.\nAlex sees that view.\nMargaret confirms completion.', 'Fictional demo profiles · local records on one phone'],
  [6, 'A photo question. A person decides.', 24.5, 's06-scan.mp4', 'Mac-local processing.\nExperimental model output.\nAn area to review.', 'ffmpeg → COLMAP → Brush\nthree.js + Spark in the app'],
  [7, 'Take the next step together.', 10.5, 's07-report.mp4', 'Print a report.\nRead it in Spanish.', 'Spanish text is machine-translated'],
  [8, 'The rules live in the core.', 23],
  [9, 'Fix what matters at home, together.', 17],
];
let start = 0;
export const scenes = specs.map(([number, title, length, source, body, note]) => {
  const id = String(number).padStart(2, '0');
  const voice = resolve(base, `vo/vo-${id}_000.wav`);
  const s = { id, number, title, duration: length, start, end: start + length, source, body, note, vo: lines.get(id), voice, voiceDuration: duration(voice), voiceStart: start + .1 };
  if (s.voiceDuration + .1 > length) throw new Error(`Voice does not fit scene ${id}`);
  start += length; return s;
});
export const total = start;

// Select actual source text, changing only indentation and line wrapping.
const role = readFileSync(resolve(root, 'src/domain/role-views.ts'), 'utf8').split('\n');
const tests = readFileSync(resolve(root, 'src/domain/roles.test.ts'), 'utf8').split('\n');
const capture = readFileSync(resolve(root, 'src/lib/capture-suggestions.ts'), 'utf8').split('\n');
const pick = (rows, pattern) => { const s = rows.find(x => x.includes(pattern)); if (!s) throw new Error(`Source excerpt missing: ${pattern}`); return s.trim(); };
export const excerpts = {
  role: [pick(role, 'Never spread a request'), pick(role, 'if (liveAssignment(r) && r.sharing.photos)'), pick(role, 'if (liveAssignment(r) && r.sharing.visitTimes)'), pick(role, 'if (liveAssignment(r) && r.sharing.areaLabel)')].join('\n\n'),
  test: [pick(tests, "it('volunteer projections omit every"), '  ' + pick(tests, 'expect(Object.keys(views[0]!).sort())')].join('\n'),
  hash: capture.slice(capture.findIndex(l => l.includes('if (binding.captureId')), capture.findIndex(l => l.includes('const model = value.model'))).join('\n').trim(),
};

// Word-proportional cue timing is deterministic; audio is the supplied WAV, unmodified.
// Keep the text identical to lines.tsv; split only at word boundaries.
export const captions = scenes.flatMap(s => {
  const words = s.vo.split(/\s+/), chunks = []; let chunk = [];
  for (const word of words) {
    if ([...chunk, word].join(' ').length > (s.source ? 79 : 114) && chunk.length) { chunks.push(chunk); chunk = []; }
    chunk.push(word);
  }
  if (chunk.length) chunks.push(chunk);
  let consumed = 0;
  return chunks.map((wordsInCue, i) => {
    const from = s.voiceStart + consumed / words.length * s.voiceDuration;
    consumed += wordsInCue.length;
    const to = s.voiceStart + consumed / words.length * s.voiceDuration;
    const text = wordsInCue.join(' '), ws = text.split(' '); let best = 1, score = Infinity;
    for (let j = 1; j < ws.length; j++) { const d = Math.abs(ws.slice(0, j).join(' ').length - ws.slice(j).join(' ').length); if (d < score) { score = d; best = j; } }
    return { id: `cap-${s.id}-${i}`, scene: s.id, start: from, end: to, text, lines: text.length > (s.source ? 41 : 65) ? [ws.slice(0, best).join(' '), ws.slice(best).join(' ')] : [text], besidePhone: !!s.source };
  });
});
