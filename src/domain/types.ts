import type { FactDefinition, FactRule, FactValues } from './fact-screening';

/** Missing information must stay unknown until it is supplied. */
export type CriterionStatus = 'met' | 'not_met' | 'unknown';

/** Recorded-criteria screening never establishes approval or funding. */
export type ScreeningStatus =
  | 'criteria_matched'
  | 'needs_information'
  | 'known_criterion_not_met';

export type SourceRecord =
  | {
      status: 'synthetic';
      label: string;
      citationUrl: null;
      verifiedAt: null;
    }
  | {
      status: 'unverified';
      label: string;
      citationUrl: string | null;
      verifiedAt: null;
    }
  | {
      status: 'verified';
      label: string;
      citationUrl: string;
      verifiedAt: string;
    };

export interface Room {
  id: string;
  name: string;
  photoUrl: string | null;
}

export interface ChecklistItem {
  id: string;
  roomId: string;
  prompt: string;
  referenceActionId: string;
}

export interface ConcernEvidence {
  id: string;
  roomId: string;
  checklistItemId: string;
  observation: string;
  imageUrl: string | null;
  source: SourceRecord;
}

export type HumanConfirmation =
  | {
      humanConfirmed: false;
      confirmedBy: null;
      confirmedAt: null;
    }
  | {
      humanConfirmed: true;
      confirmedBy: string;
      confirmedAt: string;
    };

export interface Concern {
  id: string;
  evidenceIds: readonly string[];
  referenceActionId: string;
  confirmation: HumanConfirmation;
}

export type FundingTag = 'general_repair' | 'railing' | 'bathroom_support' | 'lighting';

export interface GuidanceReference {
  title: string;
  url: string;
  section: string;
  reviewedOn: string;
}

/** Authored reference content; the workflow selects it only from confirmed concerns. */
export interface ReferenceAction {
  id: string;
  title: string;
  description: string;
  source: SourceRecord;
  guidance: GuidanceReference;
  fundingTags: readonly FundingTag[];
  helpRouting: { kind: 'family_review' | 'professional_review'; explanation: string };
  cost: { status: 'unknown'; explanation: string };
}

export interface FictionalProfile {
  id: string;
  label: string;
  fictional: true;
  facts: FactValues;
}

export interface AssistanceProgram {
  id: string;
  name: string;
  fictional: true;
  description: string;
  source: SourceRecord;
  contact: null;
  rule: FactRule;
  coverageTags: readonly FundingTag[];
  unmodeledRequirements: readonly string[];
}

export type CompletionRecord =
  | {
      status: 'unconfirmed';
      reportedBy: null;
      reportedAt: null;
    }
  | {
      status: 'family_reported_complete';
      reportedBy: string;
      reportedAt: string;
    };

/** A local family log never proves that a helper was contacted or vetted. */
export interface FamilyRequest {
  id: string;
  referenceActionId: string;
  helperLabel: string;
  recordedBy: string;
  status: 'draft' | 'family_reported_requested' | 'family_reported_in_progress';
  note: string;
  completion: CompletionRecord;
  source: SourceRecord;
}

export interface DemoScenario {
  id: string;
  schemaVersion: 2;
  title: string;
  synthetic: true;
  disclosure: string;
  rooms: readonly Room[];
  checklist: readonly ChecklistItem[];
  evidence: readonly ConcernEvidence[];
  concerns: readonly Concern[];
  referenceActions: readonly ReferenceAction[];
  factDefinitions: readonly FactDefinition[];
  profiles: readonly FictionalProfile[];
  programs: readonly AssistanceProgram[];
  requests: readonly FamilyRequest[];
}
