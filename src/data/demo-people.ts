import type { Person } from '../domain/roles';

export const RESIDENT_ID = 'margaret';
export const LEGACY_ACTOR_ID = 'family-before-roles';
export const LEGACY_LABEL = 'Family record (before roles)';
export const FIXTURE_AT = '2026-10-18T00:00:00.000Z';
export const demoPeople: readonly Person[] = [
  { id: RESIDENT_ID, name: 'Margaret', role: 'resident', skills: [], availability: '' },
  { id: 'sam', name: 'Sam', role: 'family_helper', skills: [], availability: '' },
  { id: 'alex', name: 'Alex', role: 'volunteer', skills: ['Moving light objects', 'Putting down non-slip mats'], availability: 'Saturday morning (self-reported)' },
  { id: 'jordan', name: 'Jordan', role: 'volunteer', skills: ['Tidying walkways', 'Setting up plug-in night-lights'], availability: 'Sunday afternoon (self-reported)' },
].map((person) => ({ ...person, role: person.role as Person['role'], fictional: true, language: 'en', onboarding: {}, checklistPosition: 0,
  selfReportLabel: 'Self-reported, not verified', createdBy: { actorId: RESIDENT_ID, at: FIXTURE_AT }, updatedBy: { actorId: RESIDENT_ID, at: FIXTURE_AT } }));
