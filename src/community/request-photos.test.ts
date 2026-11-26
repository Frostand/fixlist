import { describe, expect, it } from 'vitest';
import { PHOTO } from './request-photo.fixture';
import { requestPhoto, requestPhotos } from './request-photos';
import { postJob, signIn } from './commands';
import { createSeedState } from './seed';
import { visibleJob } from './queries';
import { revokeFamilyGrant } from './family';
import { quickPickAnalysis } from './task-rules';
import { loadCommunity, saveCommunity, validateCommunityState } from './storage';
import { job } from './validation';
import { details, postInput } from './live-validation';
const NOW = '2026-10-25T12:00:00.000Z', ELDER = 'elder-margaret';
function posted(photos: readonly string[] = [PHOTO,PHOTO,PHOTO]) {
  const signed = signIn(createSeedState(NOW), ELDER); if (!signed.ok) throw new Error(signed.message);
  const result = postJob(signed.state, { actorId: ELDER, elderId: ELDER, source: 'typed', originalText: 'Help with a light', analysis: quickPickAnalysis('light-bulb','en'), photos }, NOW);
  if (!result.ok) throw new Error(result.message);
  return { ...result, job: result.state.jobs.find(j => j.id === result.jobId)! };
}
function jpegWith(transform: (bytes: number[]) => number[]) { return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...transform([...atob(PHOTO.slice(23))].map(c => c.charCodeAt(0))))); }
describe('stored request photos', () => {
  it('accepts zero to three structurally valid JPEGs and rejects a fourth or sparse array', () => {
    expect(requestPhoto(PHOTO)).toBe(true); expect(requestPhotos([])).toBe(true); expect(requestPhotos([PHOTO,PHOTO,PHOTO])).toBe(true);
    expect(requestPhotos([PHOTO,PHOTO,PHOTO,PHOTO])).toBe(false); expect(requestPhotos(new Array(1))).toBe(false);
  });
  it.each([null,42,'data:image/png;base64,AAAA','data:image/jpeg;base64,','data:image/jpeg;base64,AAAA','data:image/jpeg;base64,/9j/2Q==',PHOTO+'x',PHOTO.replace('base64,','base64,\n'),`data:image/jpeg;base64,${'A'.repeat(500000)}`])('rejects non-JPEG, oversize or malformed attachment %#', value => expect(requestPhoto(value)).toBe(false));
  it('rejects truncated JPEGs, EXIF/GPS segments, oversized frames and noncanonical base64', () => {
    expect(requestPhoto(jpegWith(bytes => bytes.slice(0,-1)))).toBe(false);
    expect(requestPhoto(jpegWith(bytes => [...bytes.slice(0,2),255,225,0,4,0,0,...bytes.slice(2)]))).toBe(false);
    expect(requestPhoto(jpegWith(bytes => { const frame = bytes.findIndex((v,i) => v===255 && bytes[i+1]===192); bytes[frame+7]=4; bytes[frame+8]=1; return bytes; }))).toBe(false);
    expect(requestPhoto(PHOTO + '=')).toBe(false);
  });
  it('posts a cloned photo list and round-trips it through durable local storage', () => {
    const photos = [PHOTO,PHOTO,PHOTO], result = posted(photos);
    expect(result.job.photos).not.toBe(photos); photos.pop(); expect(result.job.photos).toHaveLength(3);
    expect(job(result.job)).toBe(true); expect(validateCommunityState(result.state)).toBe(true);
    const values = new Map<string,string>(); const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => { values.set(k,v); } } as Storage;
    expect(saveCommunity(storage,result.state)).toBe(true);
    expect(loadCommunity(storage,NOW).state.jobs.find(j => j.id===result.jobId)?.photos).toEqual([PHOTO,PHOTO,PHOTO]);
    expect(result.job.photos).not.toBeUndefined();
  });
  it('continues to load old saved jobs with no photos and rejects tampered photos', () => {
    const { job: original } = posted(); const legacy = { ...original }; delete legacy.photos;
    const result = posted();
    const values = new Map<string,string>(); const storage = { getItem:(k:string)=>values.get(k)??null, setItem:(k:string,v:string)=>{values.set(k,v);} } as Storage;
    const oldState = { ...result.state,jobs:result.state.jobs.map(j=>j.id===result.jobId?legacy:j) };
    expect(saveCommunity(storage,oldState)).toBe(true);
    const loaded = loadCommunity(storage,NOW);
    expect(loaded.state.jobs.find(j=>j.id===result.jobId)?.photos).toBeUndefined();
    expect(job(legacy)).toBe(true); expect(job({ ...legacy, photos: ['data:image/svg+xml;base64,AAAA'] })).toBe(false);
    const state = createSeedState(NOW); expect(validateCommunityState(state)).toBe(true);
  });
  it('lets a permitted family member post and view photos, then loses access after consent is revoked', () => {
    const initial = posted(), signed = signIn(initial.state,'family-alex'); if (!signed.ok) throw new Error(signed.message);
    expect(visibleJob(signed.state,initial.jobId,'family-alex')?.job.photos).toEqual([PHOTO,PHOTO,PHOTO]);
    const familyPost = postJob(signed.state,{ actorId:'family-alex',elderId:ELDER,familyRevision:1,source:'typed',originalText:'Help',analysis:initial.job.analysis,photos:[PHOTO] },NOW);
    expect(familyPost.ok).toBe(true);
    const revoked = revokeFamilyGrant(signed.state,{ actorId:'family-alex',elderId:ELDER,familyId:'family-alex',revision:1 },NOW);
    if (!revoked.ok) throw new Error(revoked.message);
    expect(visibleJob(revoked.state,initial.jobId,'family-alex')).toBeNull();
    expect(postJob(revoked.state,{ actorId:'family-alex',elderId:ELDER,familyRevision:1,source:'typed',originalText:'Help',analysis:initial.job.analysis,photos:[PHOTO] },NOW).ok).toBe(false);
  });
  it('allows photos only in the explicit live post/private-details fields', () => {
    const { job: j } = posted(), id = '11111111-1111-4111-8111-111111111111';
    const input = { requestId:id, source:'typed', originalText:j.originalText, analysis:j.analysis, address:'Private address', photos:[PHOTO] };
    expect(postInput(input)).toBe(true); expect(postInput({ ...input, photos:[PHOTO,PHOTO,PHOTO,PHOTO] })).toBe(false);
    expect(postInput({ ...input, analysis:{ ...j.analysis, summary:PHOTO } })).toBe(false);
    const d = { job:{ id, category:j.analysis.category, catalogTitle:'Repair help', coarseArea:'District', neededSkills:[], approvedServiceCreditMinutes:null, elderId:id, volunteerId:null, status:'open', createdAt:NOW }, source:'typed',originalText:j.originalText,analysis:j.analysis,address:'Private address',elderName:'Elder',volunteerName:null,events:[{ id:'1', actorId:id, type:'posted', at:NOW }],rating:null, photos:[PHOTO] };
    expect(details(d)).toBe(true); expect(details({ ...d, photos:['malformed'] })).toBe(false);
  });
});
