import { isLanguage } from '../domain/roles';
import { SKILLS, TASK_CATEGORIES, TOOLS } from './types';
import type { Account, AvailabilitySlot, ElderProfile, FamilyLink, Job, JobAnalysis, ScanEvidence, VolunteerProfile } from './types';

export type Shape = Record<string, unknown>;
export function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Shape {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => typeof key === 'string'
    && (required.includes(key) || optional.includes(key)) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}
export const text = (v: unknown, max = 4000, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
export const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
export const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.includes(v as T);
export function iso(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)) return false;
  const n = Date.parse(v);
  // Also reject normalized impossible calendar dates, e.g. February 30.
  const day = v.slice(0, 10), time = v.slice(11, 19);
  const local = new Date(`${day}T${time}Z`);
  return Number.isFinite(n) && Number.isFinite(local.getTime()) && local.toISOString().startsWith(`${day}T${time}`);
}
export function list<T>(v: unknown, check: (entry: unknown) => entry is T, max = 10000): v is T[] {
  if (!Array.isArray(v) || v.length > max) return false;
  for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i) || !check(v[i])) return false;
  return true;
}
export const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length;
export const ids = (v: unknown): v is string[] => list(v, id) && unique(v);
export function slot(v: unknown): v is AvailabilitySlot {
  return shape(v, ['day', 'part']) && finite(v.day, 0, 6) && Number.isInteger(v.day) && oneOf(v.part, ['morning', 'afternoon', 'evening']);
}
export const slots = (v: unknown): v is AvailabilitySlot[] => list(v, slot, 21) && unique(v.map((s) => `${s.day}:${s.part}`));
export function account(v: unknown): v is Account {
  return shape(v, ['id', 'role', 'name', 'firstName', 'avatarTone', 'language', 'provider', 'area', 'location', 'createdAt'])
    && id(v.id) && oneOf(v.role, ['elder', 'volunteer', 'family']) && text(v.name, 120) && text(v.firstName, 120)
    && oneOf(v.avatarTone, ['sage', 'clay', 'sky', 'plum', 'sun']) && isLanguage(v.language) && oneOf(v.provider, ['apple', 'google', 'email'])
    && text(v.area, 160) && shape(v.location, ['lat', 'lng']) && finite(v.location.lat, -90, 90) && finite(v.location.lng, -180, 180) && iso(v.createdAt);
}
export function elder(v: unknown): v is ElderProfile {
  return shape(v, ['accountId', 'needs', 'addressHint', 'familyIds']) && id(v.accountId)
    && list(v.needs, (n): n is string => text(n, 200), 30) && text(v.addressHint, 240, true) && ids(v.familyIds);
}
export function volunteer(v: unknown): v is VolunteerProfile {
  return shape(v, ['accountId', 'skills', 'tools', 'availability', 'maxMiles', 'bio', 'badges'], ['school']) && id(v.accountId)
    && list(v.skills, (s): s is typeof SKILLS[number] => oneOf(s, SKILLS), SKILLS.length) && unique(v.skills)
    && list(v.tools, (t): t is typeof TOOLS[number] => oneOf(t, TOOLS), TOOLS.length) && unique(v.tools) && slots(v.availability)
    && finite(v.maxMiles, 0, 500) && text(v.bio, 2000, true) && (!Object.hasOwn(v, 'school') || text(v.school, 200, true))
    && shape(v.badges, ['idChecked', 'backgroundCheck']) && typeof v.badges.idChecked === 'boolean' && typeof v.badges.backgroundCheck === 'boolean';
}
export const family = (v: unknown): v is FamilyLink => shape(v, ['accountId', 'elderIds']) && id(v.accountId) && ids(v.elderIds);
export function analysis(v: unknown): v is JobAnalysis {
  return shape(v, ['title', 'titleEnglish', 'summary', 'summaryEnglish', 'category', 'skills', 'tools', 'estimatedMinutes', 'peopleNeeded', 'urgency', 'safetyNotes', 'language', 'engine'])
    && text(v.title, 200) && text(v.titleEnglish, 200) && text(v.summary, 2000) && text(v.summaryEnglish, 2000) && oneOf(v.category, TASK_CATEGORIES)
    && list(v.skills, (s): s is typeof SKILLS[number] => oneOf(s, SKILLS), SKILLS.length) && unique(v.skills)
    && list(v.tools, (t): t is typeof TOOLS[number] => oneOf(t, TOOLS), TOOLS.length) && unique(v.tools)
    && finite(v.estimatedMinutes, 1, 1440) && (v.peopleNeeded === 1 || v.peopleNeeded === 2) && oneOf(v.urgency, ['today', 'this-week', 'flexible'])
    && list(v.safetyNotes, (s): s is string => text(s, 1000), 30) && isLanguage(v.language) && oneOf(v.engine, ['rules', 'apple-on-device']);
}
export function evidence(v: unknown): v is ScanEvidence {
  return shape(v, ['roomId', 'photoId', 'flagId', 'label', 'point', 'thumbnail']) && id(v.roomId) && id(v.photoId) && id(v.flagId) && text(v.label, 1000)
    && (v.point === null || (shape(v.point, ['u', 'v']) && finite(v.point.u, 0, 1) && finite(v.point.v, 0, 1)))
    && (v.thumbnail === null || (typeof v.thumbnail === 'string' && v.thumbnail.length <= 500000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v.thumbnail)));
}
export function job(v: unknown): v is Job {
  return shape(v, ['id', 'elderId', 'createdById', 'createdAt', 'source', 'originalText', 'analysis', 'evidence', 'preferredSlots', 'repeatEveryDays', 'status', 'volunteerId', 'scheduledFor', 'timeline', 'rating', 'hoursCredited'])
    && id(v.id) && id(v.elderId) && id(v.createdById) && iso(v.createdAt) && oneOf(v.source, ['voice', 'typed', 'scan', 'quick-pick']) && text(v.originalText)
    && analysis(v.analysis) && list(v.evidence, evidence, 30) && slots(v.preferredSlots)
    && (v.repeatEveryDays === null || (finite(v.repeatEveryDays, 1, 365) && Number.isInteger(v.repeatEveryDays)))
    && oneOf(v.status, ['open', 'accepted', 'on-the-way', 'arrived', 'reported-done', 'completed', 'cancelled']) && (v.volunteerId === null || id(v.volunteerId))
    && (v.scheduledFor === null || iso(v.scheduledFor)) && list(v.timeline, (e): e is Job['timeline'][number] => shape(e, ['at', 'actorId', 'type'], ['note'])
      && iso(e.at) && id(e.actorId) && oneOf(e.type, ['posted', 'accepted', 'on-the-way', 'arrived', 'reported-done', 'confirmed', 'rated', 'cancelled'])
      && (!Object.hasOwn(e, 'note') || text(e.note, 2000, true)), 10000) && v.timeline.length > 0
    && (v.rating === null || (shape(v.rating, ['stars', 'byId', 'at'], ['note']) && finite(v.rating.stars, 1, 5) && Number.isInteger(v.rating.stars) && id(v.rating.byId)
      && iso(v.rating.at) && (!Object.hasOwn(v.rating, 'note') || text(v.rating.note, 2000, true))))
    && (v.hoursCredited === null || (finite(v.hoursCredited, 0.5, 24.25) && Number.isInteger(v.hoursCredited * 4)));
}
export function creditHours(minutes: number): number { return Math.max(0.5, Math.round((minutes / 60 + 0.25) * 4) / 4); }
