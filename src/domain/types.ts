/** Missing information must stay unknown until it is supplied. */
export type CriterionStatus = 'met' | 'not_met' | 'unknown';

/** Planned screening results; no screening engine is implemented yet. */
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

/** Reference content only. A generated repair plan is a later milestone. */
export interface ReferenceAction {
  id: string;
  title: string;
  description: string;
  source: SourceRecord;
}

export interface ProgramCriterion {
  id: string;
  description: string;
  status: CriterionStatus;
  answerNote: string;
}

export interface AssistanceProgram {
  id: string;
  name: string;
  fictional: boolean;
  description: string;
  source: SourceRecord;
  contact: string | null;
  criteria: readonly ProgramCriterion[];
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
  schemaVersion: 1;
  title: string;
  synthetic: true;
  disclosure: string;
  rooms: readonly Room[];
  checklist: readonly ChecklistItem[];
  evidence: readonly ConcernEvidence[];
  concerns: readonly Concern[];
  referenceActions: readonly ReferenceAction[];
  programs: readonly AssistanceProgram[];
  requests: readonly FamilyRequest[];
}
