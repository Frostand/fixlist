import { createClient, type Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseLiveCommunity } from './supabase';
import type { LiveIdentity, LiveJobDetails, PostLiveRequest } from './ports';

const userId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const jobId='33333333-3333-4333-8333-333333333333';
const key='44444444-4444-4444-8444-444444444444';
const identity={userId,backendId:'closed-pilot'};
const signal=()=>new AbortController().signal;
const input: PostLiveRequest={requestId:jobId,source:'typed',originalText:'Please help with the garden.',address:'Private address',analysis:{
  title:'Garden help',titleEnglish:'Garden help',summary:'Help with plants',summaryEnglish:'Help with plants',category:'yard',skills:['yard'],tools:[],estimatedMinutes:999,
  peopleNeeded:1,urgency:'flexible',safetyNotes:[],language:'en',engine:'rules'}};
const discovery={id:jobId,category:'yard',catalogTitle:'Yard help',coarseArea:'Owner district',neededSkills:['yard'],approvedServiceCreditMinutes:45};
const job={...discovery,elderId:userId,volunteerId:otherId,status:'accepted',createdAt:'2026-10-24T12:00:00.123456+00:00'};
const details: LiveJobDetails={job:job as LiveJobDetails['job'],source:'typed',originalText:input.originalText,analysis:input.analysis,address:input.address,
  elderName:'Elder',volunteerName:'Volunteer',events:[{id:'1',actorId:userId,type:'posted',at:job.createdAt}],rating:null};
const success=(value: unknown)=>({ok:true,value});
const mutation=(status='accepted',messageId: string|null=null)=>success({jobId,status,messageId});

function harness(response: unknown=mutation()) {
  let current: LiveIdentity|null=identity;
  let pendingResponse=response;
  let whileFetching: (()=>void)|undefined;
  const fetch=vi.fn(async (_url: RequestInfo|URL,_init?: RequestInit)=>{
    whileFetching?.();
    return new Response(JSON.stringify(pendingResponse),{status:200,headers:{'Content-Type':'application/json'}});
  });
  // Real installed SDK builds/executes PostgREST requests; no live network or AUTH.
  const client=createClient('https://closed-pilot.invalid','synthetic-public-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const getSession=vi.spyOn(client.auth,'getSession').mockResolvedValue({data:{session:{user:{id:userId},access_token:'synthetic-session-token'} as Session},error:null});
  const currentIdentity=vi.fn(async()=>current);
  const port=new SupabaseLiveCommunity({backendId:identity.backendId,client,currentIdentity},identity);
  return {port,fetch,getSession,client,currentIdentity,setIdentity:(v: LiveIdentity|null)=>{current=v;},respond:(v: unknown)=>{pendingResponse=v;},onFetch:(v: ()=>void)=>{whileFetching=v;}};
}
function sent(h: ReturnType<typeof harness>) {
  const call=h.fetch.mock.calls.at(-1)!;
  return {url:String(call[0]),body:JSON.parse(String(call[1]?.body)),headers:new Headers(call[1]?.headers)};
}

describe('live community adapter through the installed official SDK',()=>{
  it('posts a bounded DTO with stable key, pinned session token and no actor or demo state',async()=>{
    const h=harness(mutation('open'));
    expect(await h.port.postRequest(input,key,signal())).toEqual(mutation('open'));
    const request=sent(h);
    expect(request.url).toBe('https://closed-pilot.invalid/rest/v1/rpc/community_post_request');
    expect(request.body).toEqual({p_key:key,p_payload:input});
    expect(request.headers.get('Authorization')).toBe('Bearer synthetic-session-token');
    expect(h.getSession).toHaveBeenCalled();
  });
  it('retries the same uncertain request with exactly the original key and payload',async()=>{
    const h=harness(mutation('open'));
    h.fetch.mockRejectedValueOnce(new TypeError('lost response'));
    expect(await h.port.postRequest(input,key,signal())).toEqual({ok:false,code:'retry'});
    expect(await h.port.postRequest(input,key,signal())).toEqual(mutation('open'));
    expect(h.fetch.mock.calls.map(c=>JSON.parse(String(c[1]?.body)))).toEqual([{p_key:key,p_payload:input},{p_key:key,p_payload:input}]);
  });
  it('snapshots a draft before asynchronous session lookup',async()=>{
    const h=harness(mutation('open'));const draft=structuredClone(input);
    const request=h.port.postRequest(draft,key,signal());draft.analysis.title='Edited in flight';
    await request;expect(sent(h).body.p_payload.analysis.title).toBe('Garden help');
  });
  it.each([
    ['acceptJob','community_accept_job','accepted'],['confirmDone','community_confirm_done','completed'],['cancelJob','community_cancel_job','cancelled'],
  ] as const)('%s sends only a job binding',async(method,rpc,status)=>{
    const h=harness(mutation(status));expect(await h.port[method](jobId,key,signal())).toEqual(mutation(status));
    expect(sent(h).url).toContain(`/rpc/${rpc}`);expect(sent(h).body).toEqual({p_key:key,p_payload:{jobId}});
  });
  it('sends ordered advance, message and rating fields without authority values',async()=>{
    const h=harness(mutation('arrived'));expect((await h.port.advanceJob(jobId,'arrived',key,signal())).ok).toBe(true);
    expect(sent(h).body.p_payload).toEqual({jobId,step:'arrived'});
    h.respond(mutation('arrived','12'));expect((await h.port.sendMessage(jobId,'Hello','es',key,signal())).ok).toBe(true);
    expect(sent(h).body.p_payload).toEqual({jobId,text:'Hello',language:'es'});
    h.respond(mutation('completed'));await h.port.rateJob(jobId,4,'Thanks',key,signal());
    expect(sent(h).body.p_payload).toEqual({jobId,stars:4,note:'Thanks'});
  });
  it.each(['invalid_input','invalid_state','permission_denied','pending_access','not_found','conflict','unsupported_team','idempotency_conflict'])('preserves business failure %s',async code=>{
    const h=harness({ok:false,code});expect(await h.port.acceptJob(jobId,key,signal())).toEqual({ok:false,code});
  });
  it('rejects mismatched backend binding',()=>{
    const h=harness();expect(()=>new SupabaseLiveCommunity({backendId:'another',client:h.client,currentIdentity:async()=>identity},identity)).toThrow('binding');
  });
  it.each([null,{...identity,userId:otherId},{...identity,backendId:'another'}])('fails closed before RPC after session change',async current=>{
    const h=harness();h.setIdentity(current);
    expect(await h.port.access(signal())).toEqual({ok:false,code:'session_changed'});expect(h.fetch).not.toHaveBeenCalled();
  });
  it('checks SDK session user before dispatch',async()=>{
    const h=harness();h.getSession.mockResolvedValue({data:{session:{user:{id:otherId},access_token:'different-token'} as Session},error:null});
    expect(await h.port.acceptJob(jobId,key,signal())).toEqual({ok:false,code:'session_changed'});expect(h.fetch).not.toHaveBeenCalled();
  });
  it('pins the preflight token even if the SDK reads a newer session at fetch time',async()=>{
    const h=harness();
    h.getSession.mockResolvedValueOnce({data:{session:{user:{id:userId},access_token:'original-token'} as Session},error:null})
      .mockResolvedValue({data:{session:{user:{id:otherId},access_token:'later-token'} as Session},error:null});
    expect((await h.port.acceptJob(jobId,key,signal())).ok).toBe(true);
    expect(sent(h).headers.get('Authorization')).toBe('Bearer original-token');
  });
  it('discards an in-flight response after logout',async()=>{
    const h=harness();h.onFetch(()=>h.setIdentity(null));
    expect(await h.port.acceptJob(jobId,key,signal())).toEqual({ok:false,code:'session_changed'});
  });
  it('honors preflight and in-flight AbortSignal without retrying mutations',async()=>{
    const h=harness();const c=new AbortController();c.abort();
    expect(await h.port.acceptJob(jobId,key,c.signal)).toEqual({ok:false,code:'aborted'});expect(h.fetch).not.toHaveBeenCalled();
    const active=new AbortController();h.onFetch(()=>active.abort());
    expect(await h.port.acceptJob(jobId,key,active.signal)).toEqual({ok:false,code:'aborted'});expect(h.fetch).toHaveBeenCalledOnce();
  });
  it('discards success when cancelled during final identity verification',async()=>{
    const h=harness(), active=new AbortController();
    let entered!:()=>void, finish!:(value: LiveIdentity|null)=>void;
    const verifying=new Promise<void>(resolve=>{entered=resolve;});
    const verified=new Promise<LiveIdentity|null>(resolve=>{finish=resolve;});
    h.currentIdentity.mockResolvedValueOnce(identity).mockResolvedValueOnce(identity)
      .mockImplementationOnce(()=>{entered();return verified;});
    const request=h.port.acceptJob(jobId,key,active.signal);
    await verifying;active.abort();finish(identity);
    expect(await request).toEqual({ok:false,code:'aborted'});
    expect(h.fetch).toHaveBeenCalledOnce();
  });
  it.each([
    {...input,actorId:otherId},{...input,evidence:[]},{...input,analysis:{...input.analysis,hours:100}},
    {...input,originalText:'x'.repeat(4001)},{...input,analysis:{...input.analysis,estimatedMinutes:0}},
    {...input,analysis:{...input.analysis,safetyNotes:['x'.repeat(1001)]}},
    {...input,analysis:{...input.analysis,title:'file:///private/native-capture'}},{...input,address:'data:image/jpeg;base64,abc'},
  ])('rejects unsafe/extra input before any RPC %#',async value=>{
    const h=harness();expect(await h.port.postRequest(value as PostLiveRequest,key,signal())).toEqual({ok:false,code:'invalid_input'});expect(h.fetch).not.toHaveBeenCalled();
  });
  it('allows natural-language labels and multiline user provenance',async()=>{
    const h=harness(mutation('open'));
    expect((await h.port.postRequest({...input,originalText:'Photograph: please help\nMy data: stays local'},key,signal())).ok).toBe(true);
  });
  it('explicitly rejects team tasks and bad pagination/keys',async()=>{
    const h=harness();expect(await h.port.postRequest({...input,analysis:{...input.analysis,peopleNeeded:2}},key,signal())).toEqual({ok:false,code:'unsupported_team'});
    expect(await h.port.acceptJob(jobId,'not-key',signal())).toEqual({ok:false,code:'invalid_input'});
    for (const page of [{limit:101},{cursor:'0'},{cursor:'9223372036854775808'},{limit:2,actorId:otherId}]) expect(await h.port.discover(page,signal())).toEqual({ok:false,code:'invalid_input'});
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('loads access, bounded discovery and own jobs without reading tables',async()=>{
    const h=harness(success({state:'pending',role:null,community:null}));expect((await h.port.access(signal())).ok).toBe(true);
    h.respond(success({items:[discovery],nextCursor:'20'}));expect((await h.port.discover({cursor:'30',limit:10},signal())).ok).toBe(true);
    expect(sent(h).body).toEqual({p_before:'30',p_limit:10});
    h.respond(success({items:[job],nextCursor:null}));expect((await h.port.ownJobs({},signal())).ok).toBe(true);
    expect(sent(h).url).toContain('community_own_jobs');
  });
  it('validates participant details, messages and approved service-credit DTOs',async()=>{
    const h=harness(success(details));expect((await h.port.details(jobId,signal())).ok).toBe(true);
    h.respond(success({items:[{id:'1',jobId,fromId:otherId,at:job.createdAt,text:'Hello',language:'en'}],nextCursor:null}));
    expect((await h.port.messages(jobId,{},signal())).ok).toBe(true);
    expect(sent(h).body).toEqual({p_job_id:jobId,p_before:null,p_limit:50});
    h.respond(success({items:[{jobId,volunteerId:userId,approvedServiceCreditMinutes:45,confirmedAt:job.createdAt}],nextCursor:null}));
    expect((await h.port.serviceHours({},signal())).ok).toBe(true);
  });
  it.each([
    success({jobId,status:'open',messageId:null}),success({jobId:otherId,status:'accepted',messageId:null}),success({jobId,status:'accepted',messageId:null,actorId:userId}),
    success({jobId,status:'made-up',messageId:null}),{ok:false,code:'raw-server-error'},success(null),
  ])('rejects unbound or malformed mutation results %#',async response=>{
    const h=harness(response);expect(await h.port.acceptJob(jobId,key,signal())).toEqual({ok:false,code:'retry'});
  });
  it('rejects private discovery fields and wrong request/participant bindings',async()=>{
    const h=harness(success({items:[{...discovery,address:'private leak'}],nextCursor:null}));
    expect(await h.port.discover({},signal())).toEqual({ok:false,code:'retry'});
    h.respond(success({items:[],nextCursor:'2'}));expect(await h.port.discover({},signal())).toEqual({ok:false,code:'retry'});
    h.respond(success({...details,job:{...job,id:otherId}}));expect(await h.port.details(jobId,signal())).toEqual({ok:false,code:'retry'});
    h.respond(success({items:[{...job,elderId:otherId,volunteerId:null,status:'open'}],nextCursor:null}));expect(await h.port.ownJobs({},signal())).toEqual({ok:false,code:'retry'});
    h.respond(success({items:[{id:'1',jobId:otherId,fromId:otherId,at:job.createdAt,text:'Wrong job',language:'en'}],nextCursor:null}));expect(await h.port.messages(jobId,{},signal())).toEqual({ok:false,code:'retry'});
    h.respond(success({items:[{jobId,volunteerId:otherId,approvedServiceCreditMinutes:45,confirmedAt:job.createdAt}],nextCursor:null}));expect(await h.port.serviceHours({},signal())).toEqual({ok:false,code:'retry'});
  });
});
