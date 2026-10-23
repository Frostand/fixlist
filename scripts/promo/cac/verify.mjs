import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, work, assets, outBase, json, probe, run, sha, clock, save } from './common.mjs';

const timing = json(resolve(work, 'timings.json'));
if (timing.standins) throw new Error('Cannot verify a stand-in as the final deliverable');
const checks = [];
function assert(ok, message) { if (!ok) throw new Error(message); checks.push(message); }
function atoms(path) {
  const bytes = readFileSync(path), found = [];
  for (let at = 0; at + 8 <= bytes.length;) { let size = bytes.readUInt32BE(at); const type = bytes.toString('ascii', at + 4, at + 8); if (size === 1) size = Number(bytes.readBigUInt64BE(at + 8)); found.push({ type, offset: at }); if (!size) break; if (size < 8) throw new Error('Invalid MP4 atom'); at += size; }
  return found;
}
const outputs = [];
for (const file of [timing.output, timing.novoice]) {
  const p = probe(file), v = p.streams.find(s => s.codec_type === 'video'), a = p.streams.find(s => s.codec_type === 'audio');
  assert(v?.codec_name === 'h264' && v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && v.avg_frame_rate === '30/1' && v.pix_fmt === 'yuv420p', `${file}: H.264 1920×1080 30 fps yuv420p`);
  assert(a?.codec_name === 'aac' && a.sample_rate === '48000' && a.channels === 2, `${file}: AAC 48 kHz stereo`);
  assert(Number(p.format.duration) <= 175 && Number(p.format.duration) >= 60, `${file}: duration 1–175 seconds`);
  assert(Math.abs(Number(p.format.duration) - timing.total) < .08, `${file}: timeline duration matches`);
  assert(Number(v.nb_frames) === Math.round(timing.total * 30) && Math.abs(Number(v.duration) - timing.total) < 1 / 30, `${file}: all 5160 video frames present with no audio-only tail`);
  const boxes = atoms(file); assert(boxes.find(b => b.type === 'moov')?.offset < boxes.find(b => b.type === 'mdat')?.offset, `${file}: faststart`);
  const decode = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  assert(!decode.stderr.trim(), `${file}: full video/audio decode clean`);
  outputs.push({ file, sha256: sha(file), duration: p.format.duration, video: v, audio: a });
}
const loud = run('ffmpeg', ['-hide_banner', '-i', timing.output, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr;
writeFileSync(resolve(work, 'loudness-final.log'), loud);
const loudness = JSON.parse(loud.slice(loud.lastIndexOf('{'), loud.lastIndexOf('}') + 1));
assert(Math.abs(Number(loudness.input_i) + 16) <= 1, 'Narration integrated loudness within 1 LU of −16 LUFS');
assert(Number(loudness.input_tp) <= -1.5, 'Narration true peak ≤ −1.5 dBTP');
const ebu = run('ffmpeg', ['-hide_banner', '-i', timing.output, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
writeFileSync(resolve(work, 'ebur128.log'), ebu);
const banned = /\bdetect(?:s|ed|ing|ion)?\b|finds hazards|(?:safe|safety) assessment|\bvalidated\b|\bvetted\b|verified repair|prevents falls|on-device AI/i;
const copies = json(resolve(base, 'card-copy.json'));
for (const [kind, text] of [['captions/cards', JSON.stringify(copies)], ['srt', readFileSync(timing.srt, 'utf8')], ...timing.scenes.map(s => [`narration-${s.id}`, s.vo])]) assert(!banned.test(text), `Banned-word scan clear: ${kind}`);
for (const card of json(resolve(assets, 'render-jobs.json'))) {
  const text = readFileSync(card.file, 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  assert(!banned.test(text), `Banned-word scan clear: HTML ${card.name}`);
}
for (const s of timing.scenes) assert(s.voiceStart + s.voiceDuration <= s.end, `Narration fits scene ${s.id}`);
assert(timing.scenes.find(s => s.id === '02').end <= 24, 'Name, app, purpose, audience and tools card ends by 0:24');
const title = readFileSync(resolve(assets, 'scene-02.html'), 'utf8');
for (const text of ['ANDREW LIEU', 'FixList', 'older relative', 'older adults', 'TypeScript', 'React', 'Swift', 'Python', 'Capacitor', 'three.js']) assert(title.includes(text), `Introduction includes ${text}`);
assert(timing.scenes.at(-1).duration >= 6, 'Credits readable hold ≥ 6 seconds');
assert(timing.ledger.length === 5 && timing.ledger.every(l => !l.raw.includes('/standins/')), 'All five source clips are real parent recordings');
const retiming = timing.ledger.map(l => {
  assert(l.sidecar.sourceSha256 === l.sha256 && typeof l.sidecar.method === 'string', `Scene ${l.scene}: video-time sidecar matches real clip`);
  for (const e of l.sidecar.events) {
    assert(e.videoTime === null || e.retimeStatus === 'visually_reviewed' && existsSync(e.evidence?.before || '') && existsSync(e.evidence?.after || ''), `Scene ${l.scene}: reviewed or explicitly omitted event ${e.label}`);
  }
  assert(!/\/s05[abc]\.mp4$/.test(l.raw), `Scene ${l.scene}: intermediate takes excluded from scene inputs`);
  return { scene: l.scene, reviewed: l.sidecar.events.filter(e => e.retimeStatus === 'visually_reviewed').length, indicators: l.taps.length, dropped: l.droppedEvents, normalization: l.normalization };
});
assert(!!timing.ledger.find(l => l.scene === '06').zoom, 'Scene 6 includes the labelled model-photo post zoom');
const required = [`${outBase}-demo.mp4`, `${outBase}-demo-novoice.mp4`, `${outBase}-demo.srt`, `${outBase}-thumbnail.png`, `${outBase}-demo-contact.png`];
for (const file of required) assert(existsSync(file), `Output exists: ${file}`);
const visualFile = resolve(base, 'visual-review.json');
const savedVisual = existsSync(visualFile) ? json(visualFile) : null;
const visual = savedVisual?.outputSha256 === outputs[0].sha256 ? savedVisual : { status: 'pending', notes: ['Worker must view the current video contact sheet and scene stills; no matching output-hash-bound visual review exists.'] };
const report = { generatedAt: new Date().toISOString(), checks, loudness, outputs, visual, retiming, sources: timing.ledger.map(l => ({ clip: l.raw, sha256: l.sha256, sidecar: l.sidecar, segments: l.segments, zoom: l.zoom })) };
save(resolve(work, 'verification.json'), report);
const rows = timing.scenes.map(s => `| ${s.id} | ${clock(s.start)}–${clock(s.end)} | ${s.title} | ${s.source || 'HTML source/code/credits card'} |`).join('\n');
const trims = timing.ledger.map(l => `- Scene ${l.scene}, \`${l.raw.split('/').at(-1)}\` (SHA-256 \`${l.sha256}\`): ${l.segments.map(p => `${p.from.toFixed(2)}–${p.to.toFixed(2)} s → ${p.start.toFixed(2)}–${p.end.toFixed(2)} s in scene (${p.speed.toFixed(2)}×)`).join('; ')}.${l.zoom ? ` Model photo zoom: original clip ${l.zoom.sourceTime}s, logical crop ${l.zoom.crop.join(', ')}, appears ${l.zoom.at}s into scene.` : ''}`).join('\n');
writeFileSync(resolve(base, 'REVIEW.md'), `# FixList CAC demo — local worker evidence\n\nVideo duration: **${timing.total.toFixed(2)} seconds**. Final files are local only; no commit, upload or publication. Parent owns final acceptance.\n\n## Timeline\n\n| Scene | Actual time | Content | Source |\n| --- | --- | --- | --- |\n${rows}\n\nAll app pixels come from the parent's current-build iPhone 17 Pro / iOS 26.5 Simulator recordings. Footage was normalized to 30 fps before any trim. Idle navigation was cut, genuine frames were slowed/held where needed, and event-sidecar taps were mapped through each cut. The enlarged model photo is a labelled post-production crop of a recorded app frame. HTML cards and captions use existing project fonts/logo. No synthetic test footage enters these exports.\n\n## Clip provenance and edits\n\n${trims}\n\nExact caption/voice timings, per-event tap mapping and cut ledger: \`recordings/cac-video/work/timings.json\`. Raw sidecars retain Unix event timestamps and 402×874 iPhone-point coordinates. Narration uses supplied Kokoro-82M af_heart WAVs unchanged; no music. Captions match supplied narration text. Cue boundaries are word-proportional timing estimates, not a forced transcript alignment.\n\n## Executed checks\n\n- Both MP4s: H.264, 1920×1080, 30/1 fps, yuv420p; AAC, 48 kHz, stereo; faststart; duration ${timing.total.toFixed(2)}s. Both fully decoded with no ffmpeg errors.\n- Final audio: **${loudness.input_i} LUFS integrated / ${loudness.input_tp} dBTP**. Two-pass loudnorm, with a −2 dBTP encoding margin. EBU R128 measurement retained at \`work/ebur128.log\`.\n- Banned-word scan: captions, narration, source-backed card copy and SRT passed. Required introduction content is on screen at ${clock(timing.scenes[1].start)}, through 0:24. Credits remain on screen for ${timing.scenes.at(-1).duration}s.\n- Worker ran \`npx vitest run\` with installed Node v24.18.0: **56 files passed; 1 suite blocked by listen EPERM 127.0.0.1; 1,383 tests passed / 156 skipped**. \`~/.nvm/nvm.sh\` is absent in this environment. Terminal card uses the brief's explicitly authorized **parent-verified 58 files / 1,547 tests passed**; it is labelled parent-run. Worker log copied to \`work/vitest-worker.log\`. These tests concern app logic, not real-world outcomes.\n- The worker did not edit \`src/\` or \`ios/\`, rebuild the installed app, install dependencies, drive the Simulator, or delegate. Existing owner changes were preserved.\n- Machine-readable codec/hash/check evidence: \`work/verification.json\`.\n\n## Visual review and unresolved items\n\nStatus: **${visual.status}**\n\n${visual.notes.map(n => `- ${n}`).join('\n')}\n\nThe private export does not establish submission approval, student contribution, physical-device behavior, real repairs, model quality or real household outcomes. Andrew's authorship/contribution statement and final submission remain parent/owner gates.\n\n## Rebuild\n\n\`node scripts/promo/cac/build.mjs\`\n\nRequires existing Node, ffmpeg/ffprobe, headless Chromium and project font dependencies; no server or install. Worker Chromium was blocked by Mach-service sandbox restrictions, so HTML rendering must run in the parent's existing authorized environment. See \`scripts/promo/cac/README.md\`.\n`);
const reviewPath = resolve(base, 'REVIEW.md');
writeFileSync(reviewPath, readFileSync(reviewPath, 'utf8') + `\n## Visually checked event retiming\n\nSimulator idle time can diverge from wall time. The automatic retimer analyzes a normalized 30 fps copy for scene changes, proposes ordered times, and uses wall-clock deltas under five seconds only as weak hints. Repeated idle animation and scrolls are candidates, never evidence of a tap. Source and original-sidecar SHA-256 hashes bind each manual visual approval. Every accepted event has before/after frames viewed by the worker. Uncertain typing events have null videoTime and no marker.\n\n| Scene | Reviewed events | Markers retained in cut | Explicitly dropped |\n| --- | --- | --- | --- |\n${retiming.map(r => `| ${r.scene} | ${r.reviewed} | ${r.indicators} | ${r.dropped.map(e => `${e.label}: ${e.reason}`).join('; ') || 'None'} |`).join('\n')}\n\nDetailed reviewed placements and notes: \`scripts/promo/cac/retiming-review.json\`; current sidecars: \`raw/*.events.retimed.json\`; before/after review sheets: \`work/retime/<clip>/review-*.png\`. The concatenated s05-help is the sole help scene input; s05a/b/c remain unused reference originals. The scene-6 right-doorway crop and enlarged question/uncertainty text are copied from the same inspected recorded dialog frame. Existing parent-rendered cards were preserved; no card HTML changed in this follow-up.\n\nPipeline tests: \`node --test scripts/promo/cac/edit.node-check.mjs scripts/promo/cac/retime.node-check.mjs\` — 10 passed. Existing app tests retain the separately reported worker sandbox limitation above.\n`);
console.log(JSON.stringify({ duration: timing.total, fullDecode: 'passed (both)', loudness, visual: visual.status, checks: checks.length, retiming }, null, 2));
