import { isLanguage } from '../domain/roles';
import { analysis, finite, list, oneOf, shape, text, unique } from './validation';
import { SKILLS, TASK_CATEGORIES } from './types';
import type { LiveAccess, LiveDiscoveryJob, LiveJob, LiveJobDetails, LiveMessage, LiveMutation, LivePage, LiveServiceCredit, PostLiveRequest } from './ports';

export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export const cursor = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
export const liveText = (v: unknown, max: number, empty = false): v is string => text(v,max,empty) && !/(?:^|[^\p{L}\p{N}_-])(?:data|blob|file|capacitor|ph|assets-library):\S/iu.test(v);
function safeStrings(v: unknown): boolean {
  if (typeof v === 'string') return liveText(v,4000,true);
  if (Array.isArray(v)) return v.every(safeStrings);
  if (v && typeof v === 'object') return Object.values(v).every(safeStrings);
  return true;
}
export function postInput(v: unknown): v is PostLiveRequest {
  return shape(v,['requestId','source','originalText','analysis','address']) && uuid(v.requestId)
    && oneOf(v.source,['voice','typed','scan','quick-pick']) && liveText(v.originalText,4000) && liveText(v.address,500)
    && analysis(v.analysis) && safeStrings(v.analysis);
}
export const status = (v: unknown): v is LiveJob['status'] => oneOf(v,['open','accepted','on-the-way','arrived','reported-done','completed','cancelled']);
const titles = { repair:'Repair help', safety:'Safety installation help', yard:'Yard help', household:'Household help', errand:'Errand help', tech:'Technology help', companionship:'Companionship', moving:'Moving help' };
const discoveryKeys = ['id','category','catalogTitle','coarseArea','neededSkills','approvedServiceCreditMinutes'];
function discoveryFields(v: Record<string, unknown>): boolean {
  return uuid(v.id) && oneOf(v.category,TASK_CATEGORIES) && v.catalogTitle === titles[v.category]
    && text(v.coarseArea,100) && list(v.neededSkills,(s): s is typeof SKILLS[number] => oneOf(s,SKILLS),11) && unique(v.neededSkills)
    && (v.approvedServiceCreditMinutes === null || (finite(v.approvedServiceCreditMinutes,1,480) && Number.isInteger(v.approvedServiceCreditMinutes)));
}
export function discovery(v: unknown): v is LiveDiscoveryJob { return shape(v,discoveryKeys) && discoveryFields(v); }
export function liveJob(v: unknown): v is LiveJob {
  return shape(v,[...discoveryKeys,'elderId','volunteerId','status','createdAt']) && discoveryFields(v)
    && uuid(v.elderId) && (v.volunteerId===null || uuid(v.volunteerId)) && v.elderId!==v.volunteerId && status(v.status) && timestamp(v.createdAt)
    && (['open','cancelled'].includes(v.status) || v.volunteerId!==null);
}
export function access(v: unknown): v is LiveAccess {
  return shape(v,['state','role','community']) && oneOf(v.state,['approved','pending','revoked'])
    && (v.role===null || oneOf(v.role,['elder','volunteer']))
    && (v.state==='approved' ? v.role!==null && shape(v.community,['id','label','coarseArea']) && uuid(v.community.id)
      && text(v.community.label,100) && text(v.community.coarseArea,100) : v.community===null);
}
export function details(v: unknown): v is LiveJobDetails {
  if (!shape(v,['job','source','originalText','analysis','address','elderName','volunteerName','events','rating']) || !liveJob(v.job)) return false;
  const job=v.job;
  return oneOf(v.source,['voice','typed','scan','quick-pick']) && liveText(v.originalText,4000) && analysis(v.analysis) && safeStrings(v.analysis)
    && v.analysis.peopleNeeded===1 && v.analysis.category===v.job.category && liveText(v.address,500)
    && text(v.elderName,80) && (v.job.volunteerId===null ? v.volunteerName===null : text(v.volunteerName,80))
    && list(v.events,(e): e is LiveJobDetails['events'][number] => shape(e,['id','actorId','type','at']) && cursor(e.id)
      && (e.actorId===job.elderId || e.actorId===job.volunteerId)
      && oneOf(e.type,['posted','accepted','on-the-way','arrived','reported-done','confirmed','cancelled','rated']) && timestamp(e.at),8)
    && v.events.length>0 && unique(v.events.map(e=>e.id))
    && (v.rating===null || (shape(v.rating,['stars','note','at','byId']) && finite(v.rating.stars,1,5) && Number.isInteger(v.rating.stars)
      && liveText(v.rating.note,1000,true) && timestamp(v.rating.at) && v.rating.byId===v.job.elderId && v.job.status==='completed'));
}
export function message(v: unknown): v is LiveMessage {
  return shape(v,['id','jobId','fromId','at','text','language']) && cursor(v.id) && uuid(v.jobId) && uuid(v.fromId) && timestamp(v.at) && liveText(v.text,2000) && isLanguage(v.language);
}
export function credit(v: unknown): v is LiveServiceCredit {
  return shape(v,['jobId','volunteerId','approvedServiceCreditMinutes','confirmedAt']) && uuid(v.jobId) && uuid(v.volunteerId)
    && finite(v.approvedServiceCreditMinutes,1,480) && Number.isInteger(v.approvedServiceCreditMinutes) && timestamp(v.confirmedAt);
}
export function mutation(v: unknown): v is LiveMutation {
  return shape(v,['jobId','status','messageId']) && uuid(v.jobId) && status(v.status) && (v.messageId===null || cursor(v.messageId));
}
export function page<T>(check: (v: unknown) => v is T): (v: unknown) => v is LivePage<T> {
  return (v): v is LivePage<T> => shape(v,['items','nextCursor']) && list(v.items,check,100) && (v.nextCursor===null || (v.items.length>0 && cursor(v.nextCursor)));
}
