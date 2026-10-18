/** Local demo identities are not authenticated accounts. Roles cannot be edited. */
export type PersonRole = 'resident' | 'family_helper' | 'volunteer';
export type Language = 'en' | 'es';
export type DelegationScope = 'checklist' | 'confirm' | 'requests';
export interface Attribution { actorId: string; at: string }
export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  fictional: true;
  language: Language;
  onboarding: Record<string, { stepIndex: number; completed: boolean }>;
  checklistPosition: number;
  skills: readonly string[];
  availability: string;
  selfReportLabel: 'Self-reported, not verified';
  createdBy: Attribution;
  updatedBy: Attribution;
}
export interface Household { id: 'maple-house'; residentId: string }
export interface Delegation {
  personId: string;
  scopes: readonly DelegationScope[];
  updatedBy: Attribution;
}
export interface HouseholdPhoto {
  id: string;
  checklistItemId: string;
  addedBy: string;
  addedAt: string;
  width: number;
  height: number;
}
export const MAX_HOUSEHOLD_PHOTOS = 64;
export const MAX_REMOVED_PHOTO_HISTORY = 32;
export const sharingFields = ['roomName', 'photos', 'scanLocation', 'visitTimes', 'areaLabel'] as const;
export type SharingField = typeof sharingFields[number];
export type RequestSharing = Record<SharingField, boolean>;
export const noSharing = (): RequestSharing => ({ roomName: false, photos: false, scanLocation: false, visitTimes: false, areaLabel: false });
export const REQUEST_HISTORY_LIMIT = 120;
// After ordinary edits stop: five field revocations, release the assignment,
// then close the draft, with one additional completion decision. No events
// need to be discarded or compacted.
export const MAX_REQUEST_HISTORY = REQUEST_HISTORY_LIMIT + sharingFields.length + 3;
export type HelpRequestStatus = 'draft' | 'invited' | 'declined' | 'accepted' | 'scheduled' | 'in_progress' | 'volunteer_reported_done' | 'resident_confirmed_done' | 'cancelled';
export function remainingPrivacyEvents(request: { status: HelpRequestStatus; sharing: RequestSharing }): number {
  const closures = ['draft', 'declined'].includes(request.status) ? 1
    : ['cancelled', 'resident_confirmed_done'].includes(request.status) ? 0 : 2;
  return sharingFields.filter((field) => request.sharing[field]).length + closures + (request.status === 'volunteer_reported_done' ? 1 : 0);
}
export interface RequestEvent extends Attribution { type: string; text: string | null }
export interface LegacyRequestHistory {
  label: 'Family record (before roles)';
  status: 'draft' | 'family_reported_requested' | 'family_reported_in_progress';
  completion: { status: 'unconfirmed'; reportedBy: null; reportedAt: null } | { status: 'family_reported_complete'; reportedBy: string; reportedAt: string };
  note: 'Inactive history only; no volunteer invitation, acceptance or repair verification was inferred.';
}
export interface HelpRequest {
  id: string;
  referenceActionId: string;
  episode: number;
  professionalReferral: 'recorded' | 'contacted' | 'closed' | null;
  status: HelpRequestStatus;
  revision: number;
  volunteerId: string | null;
  sharing: RequestSharing;
  visitTimes: string;
  areaLabel: string;
  /** Opaque local scan-pin ID; never grants access to the whole scan. */
  scanLocation: string | null;
  proposedTime: (Attribution & { text: string }) | null;
  agreedTime: (Attribution & { text: string }) | null;
  updates: readonly (Attribution & { text: string })[];
  reportedDone: Attribution | null;
  confirmedDone: Attribution | null;
  createdBy: { actorId: string; at: string | null };
  updatedBy: { actorId: string; at: string | null };
  history: readonly RequestEvent[];
  legacyHistory: LegacyRequestHistory | null;
  independentVerification: 'not available in this demo';
}
/** Constructed field-by-field. No household state or underlying request escapes. */
export interface VolunteerRequestView {
  kind: 'volunteer';
  id: string;
  status: HelpRequestStatus;
  revision: number;
  active: boolean;
  title: string;
  nextStep: string;
  roomName?: string;
  photos?: readonly HouseholdPhoto[];
  scanLocation?: string | null;
  visitTimes?: string;
  areaLabel?: string;
  proposedTime: HelpRequest['proposedTime'];
  agreedTime: HelpRequest['agreedTime'];
  updates: HelpRequest['updates'];
  reportedDone: HelpRequest['reportedDone'];
  confirmedDone: HelpRequest['confirmedDone'];
  independentVerification: HelpRequest['independentVerification'];
}
