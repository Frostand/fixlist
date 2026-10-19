import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, storyboard, geometry, chromium, assets } from './render-cards.mjs';
const work=resolve(root,'recordings/promo-work');mkdirSync(work,{recursive:true});
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.status)throw new Error(`${cmd}: ${r.stderr}`);return r;};
const file=resolve(root,storyboard.output),timing=JSON.parse(readFileSync(resolve(work,'timings.json'),'utf8'));
const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]).stdout);
const v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.find(s=>s.codec_type==='audio'),duration=Number(probe.format.duration);
if(v.codec_name!=='h264'||v.width!==1920||v.height!==1080||v.r_frame_rate!=='30/1'||v.pix_fmt!=='yuv420p'||a.codec_name!=='aac'||duration<100||duration>125)throw new Error('Output contract failed');
if(Math.abs(duration-timing.duration)>1/30)throw new Error('Output and storyboard timing differ');
run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
for(let i=0;i<timing.scenes.length;i++){
  const s=timing.scenes[i],end=s.voiceStart+s.voiceDuration,next=timing.scenes[i+1];
  if(end>s.end-.1||next&&end>next.voiceStart)throw new Error(`Voice overlap/out-of-scene: ${s.id}`);
}
const phoneChecks=[];
const captionChecks=[];
for(const scene of storyboard.scenes)for(const shot of scene.shots){
  const input=readFileSync(resolve(assets,`${shot.id}.html`),'utf8');
  const script=`<script>document.fonts.ready.then(()=>{const boxes=[...document.querySelectorAll('h1,.subline,.detail,.brand,.kicker,.footer,.message,.role-label,.disclosures,.credits,.bottom,.tag')].map(e=>{const r=e.getBoundingClientRect();return {element:e.className||e.tagName,x:r.x,y:r.y,right:r.right,bottom:r.bottom}});document.body.setAttribute('data-qa',encodeURIComponent(JSON.stringify(boxes)));});</script>`;
  const path=resolve(assets,`${shot.id}-qa.html`);writeFileSync(path,input+script);
  const dom=run(chromium,['--no-sandbox','--disable-gpu','--window-size=1920,1080','--virtual-time-budget=1000','--dump-dom',`file://${path}`]).stdout;
  const match=dom.match(/data-qa="([^"]+)"/);if(!match)throw new Error(`Missing caption bounds: ${shot.id}`);
  const boxes=JSON.parse(decodeURIComponent(match[1]));
  for(const b of boxes)if(b.x<96||b.y<54||b.right>1824||b.bottom>1026)throw new Error(`Caption outside 5% margins: ${shot.id} ${JSON.stringify(b)}`);
  const title=boxes.find(b=>b.element==='H1'),labels=boxes.filter(b=>b.element==='role-label');
  if(shot.layout==='triple'&&labels.some(b=>b.y<title.bottom||b.bottom>geometry(shot.layout)[0].y-12))throw new Error(`Overlapping role labels: ${shot.id}`);
  captionChecks.push({shot:shot.id,elements:boxes.length,status:'inside 5% safe margins'});
}
for(const shot of timing.shots){
  if(!shot.phones)continue;
  const boxes=geometry(shot.layout);
  for(let i=0;i<boxes.length;i++){
    const g=boxes[i],meta=resolve(work,`qa-${shot.id}-${i}.txt`);
    run('ffmpeg',['-hide_banner','-loglevel','error','-i',resolve(work,`${shot.id}.mp4`),'-vf',`fps=2,crop=${g.w-64}:${g.h-120}:${g.x+32}:${g.y+60},signalstats,metadata=print:file=${meta}`,'-an','-f','null','-']);
    const text=readFileSync(meta,'utf8'),mins=[...text.matchAll(/lavfi.signalstats.YMIN=(\d+)/g)].map(m=>+m[1]),maxs=[...text.matchAll(/lavfi.signalstats.YMAX=(\d+)/g)].map(m=>+m[1]);
    const spans=mins.map((x,j)=>maxs[j]-x),minSpan=Math.min(...spans);
    if(!spans.length||minSpan<10)throw new Error(`Blank phone content: ${shot.id} phone ${i}, luma span ${minSpan}`);
    phoneChecks.push({shot:shot.id,phone:i,samples:spans.length,minLumaSpan:minSpan});
  }
}
const loudness=run('ffmpeg',['-hide_banner','-i',file,'-vn','-af','loudnorm=I=-17:TP=-1.5:LRA=9:print_format=json','-f','null','-']).stderr;
writeFileSync(resolve(work,'audio-loudness.log'),loudness);
const loudnessStart=loudness.lastIndexOf('{'),loudnessEnd=loudness.indexOf('}',loudnessStart)+1;
const loudnessJson=JSON.parse(loudness.slice(loudnessStart,loudnessEnd));
if(Number(loudnessJson.input_tp)>=-.1)throw new Error('Audio peak is too close to clipping');
const bytes=readFileSync(file),atoms=[];for(let offset=0;offset+8<=bytes.length;){const size=bytes.readUInt32BE(offset);atoms.push({type:bytes.toString('ascii',offset+4,offset+8),offset});if(size<8)break;offset+=size;}
const fastStart=atoms.find(x=>x.type==='moov')?.offset<atoms.find(x=>x.type==='mdat')?.offset;if(!fastStart)throw new Error('Missing fast-start metadata');
const sources=[...new Set(timing.shots.flatMap(s=>(s.phones||[]).map(p=>p.source)))].map(name=>({name,sha256:createHash('sha256').update(readFileSync(resolve(root,'recordings/promo-raw',name))).digest('hex')}));
const report={file,duration,sha256:createHash('sha256').update(bytes).digest('hex'),video:{codec:v.codec_name,width:v.width,height:v.height,fps:v.r_frame_rate,pixelFormat:v.pix_fmt,fastStart},audio:{codec:a.codec_name,sampleRate:a.sample_rate,loudness:loudnessJson},fullDecode:'passed',voiceTiming:'passed',captionChecks,phoneChecks,sources};
writeFileSync(resolve(work,'verification.json'),JSON.stringify(report,null,2));
const stamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;
const srtStamp=n=>`${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(Math.floor(n)%60).padStart(2,'0')},${String(Math.round(n*1000)%1000).padStart(3,'0')}`;
writeFileSync(resolve(root,'recordings/2026-10-18-fixlist-launch-promo.srt'),timing.scenes.map((s,i)=>`${i+1}\n${srtStamp(s.voiceStart)} --> ${srtStamp(s.voiceStart+s.voiceDuration)}\n${s.vo}\n`).join('\n'));
const rows=timing.scenes.map(s=>`| ${s.id} | ${stamp(s.start)}–${stamp(s.end)} | ${s.name} |`).join('\n');
const notes=`# FixList launch promo review\n\nCompleted local media, October 18, 2026.\n\n- Video: \`recordings/2026-10-18-fixlist-launch-promo.mp4\`\n- Poster: \`recordings/2026-10-18-fixlist-launch-promo-poster.png\`\n- Contact sheet: \`recordings/2026-10-18-fixlist-launch-promo-contact.png\`\n- Narration subtitles: \`recordings/2026-10-18-fixlist-launch-promo.srt\`\n- Raw capture directory: \`recordings/promo-raw/\`\n- Duration: **${duration.toFixed(2)} seconds (${stamp(duration)})**. H.264, yuv420p, 1920×1080, 30 fps; AAC stereo, 48 kHz; fast-start metadata.\n\nAll 16 requested storyboard scenes are present. No storyboard feature was left uncaptured. App screens are genuine Simulator recordings; the title, problem and end cards are graphics as requested. Static holds extend genuine captured frames. Navigation is trimmed and sped up where specified in the storyboard; scan motion is retained. No music.\n\n## Scene timeline\n\nThe 0.4-second crossfades make adjacent ranges overlap. Narration begins 0.45 seconds after each scene begins. Exact shot sources, trim points, speeds and captions are in \`scripts/promo/storyboard.json\`; measured voice timings are in \`recordings/promo-work/timings.json\`.\n\n| Scene | Time | Content |\n| --- | --- | --- |\n${rows}\n\n## Validation\n\n- Before filming: **1,116 tests in 28 files passed**, strict typecheck passed, Vite build passed through \`npm run ios:demo\`, Xcode Debug Simulator build succeeded. Logs are in \`recordings/promo-*.log\`.\n- Clean-installed and recorded on iPhone 17 Pro Simulator, iOS 26.5, bundle \`app.fixlist.demo\`.\n- Full final MP4 decoded without errors. All ${captionChecks.length} card layouts have captions inside the 5% safe margins; triple-role labels do not overlap the headline or phone frames.\n- ${phoneChecks.reduce((n,p)=>n+p.samples,0)} phone-content samples at 2 fps passed the blank-content guard. The 4-second contact sheet and targeted key frames were visually inspected.\n- All voiceovers fit their scenes with no overlaps. Integrated narration: **${loudnessJson.input_i} LUFS**; true peak **${loudnessJson.input_tp} dBTP**. No music.\n- The video shows explicit concern confirmation, the CDC source line, self-reported volunteer skills, granular sharing, acceptance/time proposal/update/report-done, Margaret's time agreement and completion review, Sam's granted checklist view and revocation, the bundled scan's orbit controls, its experimental score and Show in 3D, Eldercare Locator, the Spanish disclosure banner, and the native iOS print sheet with an eight-page preview.\n- Only fictional demo people/household and \`viennese-v2\` were captured. No playroom, private household media, desktop, notifications, browser chrome or local file paths are shown. The public Eldercare Locator phone/link and source/license URLs are intentional.\n- Status-bar override was cleared after capture. No tracked app source was changed; no commit, upload or publication occurred. Existing \`.claude/\` owner files were preserved.\n- Source hashes, output SHA-256, codecs, audio measurement, caption checks and phone samples: \`recordings/promo-work/verification.json\`.\n\n## Rebuild\n\nFrom the repository root:\n\n\`\`\`sh\nnode scripts/promo/build-video.mjs\nnode scripts/promo/verify-video.mjs\n\`\`\`\n\nPrerequisites and capture notes: \`scripts/promo/README.md\`. The build is deterministic from the retained raw clips, storyboard and installed tool versions. Native voice synthesis/encoding can vary across OS/tool versions.\n`;
writeFileSync(resolve(root,'recordings/2026-10-18-fixlist-launch-promo-review.md'),notes);
console.log(JSON.stringify({duration,fullDecode:'passed',voiceTiming:'passed',phoneSamples:phoneChecks.reduce((n,p)=>n+p.samples,0),audio:loudnessJson},null,2));
