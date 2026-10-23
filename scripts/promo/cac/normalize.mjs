import { resolve, basename } from 'node:path';
import { raw, work, probe, sha, cached, ff } from './common.mjs';

export function normalizeClip(input, id, folder = work) {
  const inputSha256 = sha(input), normal = resolve(folder, `${id}-normalized.mp4`);
  const v = probe(input).streams.find(v => v.codec_type === 'video');
  const alreadyCfr = v.r_frame_rate === '30/1' && v.avg_frame_rate === '30/1' && Math.abs(Number(v.nb_frames) / 30 - Number(v.duration)) < 1 / 30;
  cached(normal, { inputSha256, transform: 'fps-before-trim-v2', alreadyCfr }, () => ff(alreadyCfr ? ['-i', input, '-map', '0:v', '-an', '-c:v', 'copy', normal] : ['-i', input, '-vf', 'setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.1,fps=30,setsar=1', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-threads', '4', '-pix_fmt', 'yuv420p', normal]));
  return { inputSha256, normal, normalization: alreadyCfr ? 'Verified existing 30 fps CFR, copied without re-encoding before trim.' : 'Normalized VFR to 30 fps CFR before trim.' };
}
if (process.argv[1] === import.meta.filename) {
  const sources = { '01': 's01-hook.mp4', '04': 's04-check.mp4', '05': 's05-help.mp4', '06': 's06-scan.mp4', '07': 's07-report.mp4' };
  for (const id of process.argv.slice(2)) { if (!sources[id]) throw new Error(`Unknown scene ${id}`); console.log(JSON.stringify(normalizeClip(resolve(raw, sources[id]), id))); }
}
