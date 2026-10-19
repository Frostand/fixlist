// Rebuild from native Simulator recordings + storyboard. No app source edits.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, assets, storyboard as story, geometry, renderAll, renderHtml } from './render-cards.mjs';
const work=resolve(root,'recordings/promo-work'), raw=resolve(root,'recordings/promo-raw');
mkdirSync(work,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.status)throw new Error(`${cmd} failed\n${r.stderr}\n${r.stdout}`);return r.stdout;}
function ff(args){return run('ffmpeg',['-hide_banner','-loglevel','error','-y',...args]);}
function duration(path){return Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',path]).trim());}
const xfade=story.transition, shots=[];let timeline=0;
for(const scene of story.scenes){
  const txt=resolve(work,`${scene.id}-vo.txt`),voice=resolve(work,`${scene.id}-vo.aiff`);
  writeFileSync(txt,scene.vo);
  const cache=resolve(work,`${scene.id}-vo-cache.txt`),voiceKey=JSON.stringify({text:scene.vo,voice:story.voice});
  if(!existsSync(voice)||!existsSync(cache)||readFileSync(cache,'utf8')!==voiceKey){
    run('say',['-v',story.voice.name,'-r',String(story.voice.rate),'-f',txt,'-o',voice]);
    writeFileSync(cache,voiceKey);
  }
  scene.voiceDuration=duration(voice);scene.voiceFile=voice;
  let length=scene.shots.reduce((s,v)=>s+v.duration,0)-(scene.shots.length-1)*xfade;
  const extra=Math.max(0,Math.ceil((scene.voiceDuration+.95-length)*30)/30);
  scene.shots.at(-1).duration+=extra;
  scene.start=timeline;
  for(const shot of scene.shots){shot.start=timeline;shot.scene=scene.id;shots.push(shot);timeline+=shot.duration-xfade;}
  scene.end=timeline+xfade;
  scene.voiceStart=scene.start+.45;
}
const total=timeline+xfade;
writeFileSync(resolve(work,'timings.json'),JSON.stringify({duration:total,scenes:story.scenes.map(({id,name,start,end,voiceStart,voiceDuration,vo,shots})=>({id,name,start,end,voiceStart,voiceDuration,vo,shots})),shots},null,2));
console.log(`Timeline ${total.toFixed(3)}s; voice + scene timing written to recordings/promo-work/timings.json`);
if(total<100||total>125)throw new Error(`Timeline outside acceptance: ${total}s. Tighten storyboard before encoding.`);
if(process.argv.includes('--prepare'))process.exit(0);
renderAll();
// simctl emits frames only when the screen changes. Normalize BEFORE trim:
// a trim inside a static timestamp gap must retain the previous genuine frame.
const normalized=resolve(work,'normalized');mkdirSync(normalized,{recursive:true});
for(const source of new Set(shots.flatMap(s=>(s.phones||[]).map(p=>p.source)))){
  const input=resolve(raw,source),out=resolve(normalized,source);
  ff(['-i',input,'-vf','setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,fps=30,setsar=1','-an','-c:v','libx264','-preset','veryfast','-crf','16','-threads','4','-pix_fmt','yuv420p',out]);
}
for(const shot of shots){
  const out=resolve(work,`${shot.id}.mp4`);
  const args=['-loop','1','-framerate','30','-i',resolve(assets,`${shot.id}.png`)];
  const filters=[];let last='base';
  if(!shot.phones){
    filters.push(`[0:v]zoompan=z='min(1.012,1+on*0.000035)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,trim=duration=${shot.duration},setpts=PTS-STARTPTS,format=yuv420p[v]`);
  }else{
    filters.push(`[0:v]format=rgba,trim=duration=${shot.duration},setpts=PTS-STARTPTS[base]`);
    for(let i=0;i<shot.phones.length;i++){
      const p=shot.phones[i],g=geometry(shot.layout)[i],input=1+i*2,mask=input+1;
      if(!existsSync(resolve(raw,p.source)))throw new Error(`Missing capture ${p.source}`);
      args.push('-i',resolve(normalized,p.source),'-loop','1','-framerate','30','-i',resolve(assets,`mask-${g.w}-${g.h}.png`));
      filters.push(`[${input}:v]trim=start=${p.start||0}${p.end!=null?`:end=${p.end}`:''},setpts=(PTS-STARTPTS)/${p.speed||1},tpad=stop_mode=clone:stop_duration=${shot.duration+1},fps=30,trim=duration=${shot.duration},scale=${g.w}:${g.h}:flags=lanczos,setsar=1,format=rgba[p${i}]`);
      filters.push(`[${mask}:v]format=gray,trim=duration=${shot.duration},setpts=PTS-STARTPTS[m${i}]`);
      filters.push(`[p${i}][m${i}]alphamerge[a${i}]`);
      filters.push(`[${last}][a${i}]overlay=x=${g.x}:y=${g.y}:shortest=1[b${i}]`);last=`b${i}`;
    }
    filters.push(`[${last}]format=yuv420p[v]`);
  }
  args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[v]','-an','-t',String(shot.duration),'-r','30','-c:v','libx264','-preset','veryfast','-crf','18','-threads','4','-pix_fmt','yuv420p',out);
  ff(args);console.log(`Rendered ${shot.id} (${shot.duration.toFixed(2)}s)`);
}
const args=[];for(const shot of shots)args.push('-i',resolve(work,`${shot.id}.mp4`));
const filters=shots.map((_,i)=>`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);let last='v0',offset=shots[0].duration-xfade;
for(let i=1;i<shots.length;i++){filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${xfade}:offset=${offset.toFixed(6)}[f${i}]`);last=`f${i}`;offset+=shots[i].duration-xfade;}
const visual=resolve(work,'visual.mp4');
ff([...args,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${last}]`,'-an','-r','30','-c:v','libx264','-preset','veryfast','-crf','18','-threads','4','-pix_fmt','yuv420p',visual]);
const audioArgs=['-f','lavfi','-t',String(total),'-i','anullsrc=r=48000:cl=stereo'];
const audioFilters=[];for(let i=0;i<story.scenes.length;i++){const s=story.scenes[i];audioArgs.push('-i',s.voiceFile);audioFilters.push(`[${i+1}:a]aresample=48000,loudnorm=I=-17:TP=-1.5:LRA=9,aresample=48000,afade=t=in:d=0.025,afade=t=out:st=${Math.max(0,s.voiceDuration-.12)}:d=0.12,adelay=${Math.round(s.voiceStart*1000)}:all=1[a${i}]`);}
audioFilters.push(`[0:a]${story.scenes.map((_,i)=>`[a${i}]`).join('')}amix=inputs=${story.scenes.length+1}:normalize=0:duration=first,atrim=duration=${total},afade=t=out:st=${total-.4}:d=0.4[a]`);
const mixed=resolve(work,'voiceover.wav');
ff([...audioArgs,'-filter_complex',audioFilters.join(';'),'-map','[a]','-c:a','pcm_s16le',mixed]);
const output=resolve(root,story.output);
ff(['-i',visual,'-i',mixed,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(total),'-movflags','+faststart',output]);
const poster=resolve(root,'recordings/2026-10-18-fixlist-launch-promo-poster.png');
ff(['-ss',String(story.scenes[3].start+2),'-i',output,'-frames:v','1',poster]);
const contactDir=resolve(work,'contact');mkdirSync(contactDir,{recursive:true});const tiles=[];
for(let t=0;t<total;t+=4){const name=`frame-${String(t).padStart(3,'0')}.png`,file=resolve(contactDir,name);ff(['-ss',String(t),'-i',output,'-frames:v','1','-vf','scale=480:270',file]);tiles.push(`<figure><img src="file://${file}"><figcaption>${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}</figcaption></figure>`);}
const rows=Math.ceil(tiles.length/4),contactHtml=`<meta charset="utf-8"><style>body{margin:0;padding:24px;background:#eef1ec;color:#16302b;font:22px sans-serif}h1{font-size:28px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(4,480px);gap:16px}figure{margin:0}img{width:480px;height:270px;display:block}figcaption{padding:6px 0;font-size:24px}</style><h1>FixList · Launch promo · frames every 4 seconds · ${total.toFixed(2)}s</h1><div class="grid">${tiles.join('')}</div>`;
const contact=renderHtml('contact-sheet',contactHtml,2016,84+rows*324);
run('cp',[contact,resolve(root,'recordings/2026-10-18-fixlist-launch-promo-contact.png')]);
const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
writeFileSync(resolve(work,'ffprobe.json'),JSON.stringify(probe,null,2));
console.log(JSON.stringify({output,duration:duration(output),poster,contact:resolve(root,'recordings/2026-10-18-fixlist-launch-promo-contact.png')},null,2));
