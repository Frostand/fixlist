import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO } from '../../community/request-photo.fixture';
import { createSeedState, quickPickAnalysis, signIn, postJob, visibleJob, jobsForElder, saveCommunity, loadCommunity } from '../../community';
import { prepareRequestPhoto } from '../../lib/request-photo';
import { translate, I18nProvider, loadLanguageMessages } from '../../i18n';
import { RequestPhotoEditor, RequestPhotos } from './RequestPhotos';
import { DraftScreen } from './DraftScreen';
import { JobCard } from './JobCard';
import { NearbyList, VolunteerJob } from './Volunteer';
import { Button } from './UI';
import type { Draft } from './Elder';

interface Driver { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as Driver | null }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual,
    useState(initial: unknown) { const d=runtime.active; if(!d)return actual.useState(initial); const i=d.cursor++; if(!(i in d.values))d.values[i]=typeof initial==='function'?initial():initial; return [d.values[i],(v: unknown)=>{ d.values[i]=typeof v==='function'?v(d.values[i]):v; }]; },
    useRef(initial: unknown) { const d=runtime.active;if(!d)return actual.useRef(initial);const i=d.cursor++;if(!(i in d.values))d.values[i]={current:initial};return d.values[i]; },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {const d=runtime.active;if(!d)return actual.useEffect(effect,deps);const i=d.cursor++,prior=d.values[i] as readonly unknown[]|undefined;if(!deps||!prior||deps.some((v,n)=>!Object.is(v,prior[n]))){d.values[i]=deps;d.effects.push(()=>{d.cleanups[i]?.();const cleanup=effect();d.cleanups[i]=typeof cleanup==='function'?cleanup:()=>{};});}},
  };
});
vi.mock('../../i18n', async original => {const actual=await original<typeof import('../../i18n')>();return {...actual,useLanguage:()=> 'en',useT:()=>Object.assign((key: import('../../i18n').MessageKey,values?: import('../../i18n').Values)=>actual.translate('en',key,values),{language:'en'})};});
vi.mock('../../lib/request-photo', () => ({ prepareRequestPhoto: vi.fn() }));
vi.mock('./NearbyMap',()=>({default:()=>null}));
const cleanup: Array<() => void> = [];
function driver<T>(render: () => T) {
 const d: Driver={cursor:0,values:[],effects:[],cleanups:[]};
 const view={render(){d.cursor=0;runtime.active=d;let result:T;try{result=render();}finally{runtime.active=null;}for(const effect of d.effects.splice(0))effect();return result;},unmount(){for(const fn of d.cleanups)fn?.();}};
 cleanup.push(view.unmount);return view;
}
function nodes(node: ReactNode,type: unknown): ReactElement<Record<string,unknown>>[]{if(Array.isArray(node))return node.flatMap(n=>nodes(n,type));if(!isValidElement<{children?:ReactNode}>(node))return [];return [...(node.type===type?[node as ReactElement<Record<string,unknown>>]:[]),...nodes(node.props.children,type)];}
function press(node: ReactElement<Record<string,unknown>>) {(node.props.onClick as () => void)();}
function button(tree: ReactNode,label: string){const found=nodes(tree,Button).find(n=>n.props.children===label);if(!found)throw new Error('Missing '+label);return found;}
function pick(tree: ReactNode,count=1){const input=nodes(tree,'input')[0]!;const target={files:Array.from({length:count},()=>new File(['original'],'photo.heic')),value:'chosen'};(input.props.onChange as (e: unknown)=>void)({currentTarget:target});expect(target.value).toBe('');}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
afterEach(()=>{for(const fn of cleanup.splice(0))fn();vi.resetAllMocks();});
function editor(initial: readonly string[]=[],isCurrent=()=>true){let photos=initial;const changed=vi.fn((next: readonly string[])=>{photos=next;});const busy=vi.fn();const view=driver(()=>RequestPhotoEditor({photos,onChange:changed,onBusyChange:busy,isCurrent}));view.render();return {view,changed,busy,get photos(){return photos;}};}

describe('request photo controls',()=>{
 it('adds three images from the native-compatible picker, renders localized previews and removes one',async()=>{
  vi.mocked(prepareRequestPhoto).mockResolvedValue(PHOTO);const h=editor();const tree=h.view.render(),input=nodes(tree,'input')[0]!;
  expect(input.props.type).toBe('file');expect(input.props.accept).toBe('image/*');expect(input.props.capture).toBeUndefined();
  const click=vi.fn();(input.props.ref as {current:unknown}).current={click};press(button(tree,'Add a photo'));expect(click).toHaveBeenCalledOnce();
  pick(tree,3);expect(button(h.view.render(),'Add a photo').props.disabled).toBe(true);await flush();
  const added=h.view.render();expect(h.photos).toHaveLength(3);expect(nodes(added,'img').map(n=>n.props.alt)).toEqual(['Request photo 1','Request photo 2','Request photo 3']);
  expect(button(added,'Add a photo').props.disabled).toBe(true);press(nodes(added,Button).find(n=>n.props['aria-label']==='Remove photo 2')!);
  expect(h.photos).toHaveLength(2);expect(button(h.view.render(),'Add a photo').props.disabled).toBe(false);expect(h.busy.mock.calls.map(c=>c[0])).toEqual([true,false]);
 });
 it('enforces the three-photo limit even if a file event bypasses the disabled picker',async()=>{
  const h=editor([PHOTO,PHOTO]);pick(h.view.render(),2);await flush();expect(prepareRequestPhoto).not.toHaveBeenCalled();expect(h.changed).not.toHaveBeenCalled();
  expect(nodes(h.view.render(),'p').some(n=>n.props.role==='alert'&&String(n.props.children).includes('up to 3'))).toBe(true);
 });
 it('shows a friendly error on decode failure and allows retry without losing existing photos',async()=>{
  vi.mocked(prepareRequestPhoto).mockRejectedValueOnce(new Error('decode failed')).mockResolvedValue(PHOTO);const h=editor([PHOTO]);pick(h.view.render());await flush();
  expect(h.photos).toEqual([PHOTO]);expect(nodes(h.view.render(),'p').find(n=>n.props.role==='alert')?.props.children).toBe('We couldn’t open that photo. Please try another photo.');
  pick(h.view.render());await flush();expect(h.photos).toEqual([PHOTO,PHOTO]);
 });
 it.each(['revoked','unmounted'])('discards asynchronous photo results when the editor is %s',async reason=>{
  let finish!:(v:string)=>void,current=true;vi.mocked(prepareRequestPhoto).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const h=editor([],()=>current);
  pick(h.view.render());if(reason==='revoked')current=false;else h.view.unmount();finish(PHOTO);await flush();expect(h.changed).not.toHaveBeenCalled();
 });
 it('guards duplicate picker callbacks while a photo is processing',async()=>{
  let finish!:(v:string)=>void;vi.mocked(prepareRequestPhoto).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const h=editor(),tree=h.view.render();pick(tree);pick(tree);expect(prepareRequestPhoto).toHaveBeenCalledOnce();finish(PHOTO);await flush();expect(h.photos).toHaveLength(1);
 });
 it('places the editor above Post, retains photos through manual editing and blocks posting during preparation',async()=>{
  let draft:Draft={analysis:quickPickAnalysis('light-bulb','en'),source:'typed',text:'Help with a light',evidence:[]};const post=vi.fn(()=>false);
  const h=driver(()=>DraftScreen({draft,onChange:next=>{draft=next;},onPost:post}));let tree=h.render();const control=nodes(tree,RequestPhotoEditor)[0]!;
  (control.props.onBusyChange as (v:boolean)=>void)(true);press(button(tree,'Post this request'));expect(post).not.toHaveBeenCalled();expect(button(h.render(),'Post this request').props.disabled).toBe(true);
  (control.props.onChange as (v:string[])=>void)([PHOTO]);(control.props.onBusyChange as (v:boolean)=>void)(false);tree=h.render();
  expect(nodes(tree,RequestPhotoEditor)[0]!.props.photos).toEqual([PHOTO]);press(button(tree,'Change something'));expect(nodes(h.render(),RequestPhotoEditor)[0]!.props.photos).toEqual([PHOTO]);
  press(button(h.render(),'Post this request'));await flush();expect(post).toHaveBeenCalledOnce();
 });
 it('posts the draft after adding/removing photos and keeps exactly those photos after a local reload',async()=>{
  vi.mocked(prepareRequestPhoto).mockResolvedValue(PHOTO);
  let draft:Draft={analysis:quickPickAnalysis('light-bulb','en'),source:'typed',text:'Help with a light',evidence:[]};
  const signed=signIn(createSeedState('2026-10-25T12:00:00.000Z'),'elder-margaret');if(!signed.ok)throw new Error('sign in');
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}} as Storage;
  let postedId='';
  const review=driver(()=>DraftScreen({draft,onChange:next=>{draft=next;},onPost:(preferredSlots,analysis)=>{
   const result=postJob(signed.state,{actorId:'elder-margaret',elderId:'elder-margaret',source:draft.source,originalText:draft.text,analysis,preferredSlots,photos:draft.photos??[]},'2026-10-25T12:00:00.000Z');
   if(!result.ok)return false;postedId=result.jobId;return saveCommunity(storage,result.state);
  }}));
  let props=nodes(review.render(),RequestPhotoEditor)[0]!.props as unknown as Parameters<typeof RequestPhotoEditor>[0];
  const edit=driver(()=>RequestPhotoEditor(props));pick(edit.render(),3);await flush();
  props=nodes(review.render(),RequestPhotoEditor)[0]!.props as unknown as Parameters<typeof RequestPhotoEditor>[0];
  press(nodes(edit.render(),Button).find(n=>n.props['aria-label']==='Remove photo 2')!);
  press(button(review.render(),'Post this request'));await flush();
  expect(postedId).not.toBe('');
  expect(loadCommunity(storage,'2026-10-25T12:00:00.000Z').state.jobs.find(j=>j.id===postedId)?.photos).toEqual([PHOTO,PHOTO]);
 });
 it('uses the conversation photo callback without forcing manual conversation editing',()=>{
  const draft:Draft={analysis:quickPickAnalysis('light-bulb','en'),source:'voice',text:'Help',evidence:[]};const onChange=vi.fn(),onPhotosChange=vi.fn();
  const h=driver(()=>DraftScreen({draft,embedded:true,onChange,onPhotosChange,onPost:()=>false}));const control=nodes(h.render(),RequestPhotoEditor)[0]!;
  (control.props.onChange as (v:string[])=>void)([PHOTO]);expect(onPhotosChange).toHaveBeenCalledWith([PHOTO]);expect(onChange).not.toHaveBeenCalled();
 });
 it('renders photos on JobCard, volunteer discovery and volunteer detail',()=>{
  const initial=createSeedState('2026-10-25T12:00:00.000Z'), signed=signIn(initial,'elder-margaret');if(!signed.ok)throw new Error('sign in');
  const posted=postJob(signed.state,{actorId:'elder-margaret',elderId:'elder-margaret',source:'typed',originalText:'Light',analysis:quickPickAnalysis('light-bulb','en'),photos:[PHOTO]},'2026-10-25T12:00:00.000Z');if(!posted.ok)throw new Error(posted.message);
  const job=posted.state.jobs.find(j=>j.id===posted.jobId)!, volunteer=posted.state.accounts.find(a=>a.id==='volunteer-jordan')!;
  const signedVolunteer=signIn(posted.state,volunteer.id);if(!signedVolunteer.ok)throw new Error('volunteer');
  const match={jobId:job.id,volunteerId:volunteer.id,score:80,distanceMiles:1,reasons:[],gaps:[],sharedSlots:[]};
  for(const node of [<JobCard analysis={job.analysis} photos={job.photos}/>,<NearbyList state={signedVolunteer.state} matches={[match]} onOpen={()=>{}}/>,<VolunteerJob job={job} elder={posted.state.accounts.find(a=>a.id===job.elderId)!} address={null} profile={posted.state.volunteers.find(v=>v.accountId===volunteer.id)!} match={match} onAccept={()=>false} onStep={()=>false} onMessages={()=>{}}/>]){
   const html = renderToStaticMarkup(<I18nProvider language="en">{node}</I18nProvider>);
   expect(html.match(/alt="Request photo 1"/g)).toHaveLength(1);
  }
  expect(jobsForElder(posted.state,'elder-margaret').find(j=>j.id===job.id)?.photos).toEqual([PHOTO]);
  expect(visibleJob(posted.state,job.id,'elder-margaret')?.job.photos).toEqual([PHOTO]);
 });
 it('has translated attachment strings and matching alt tokens for all nine locales',async()=>{
  for(const lang of ['en','es','zh','vi','ko','tl','ru','fr','ar'] as const){await loadLanguageMessages(lang);expect(translate(lang,'c.photos.alt',{number:2})).not.toContain('{number}');expect(translate(lang,'c.photos.add')).toBeTruthy();}
  expect(renderToStaticMarkup(<RequestPhotos photos={[]}/>)).toBe('');
 });
});
