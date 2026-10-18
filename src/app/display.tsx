import type { HelpRequestStatus } from '../domain/roles';
import type { DemoScenario, ScreeningStatus, SourceRecord } from '../domain/types';

export const requestStatusLabels: Record<HelpRequestStatus, string> = {
  draft: 'Local draft', invited: 'Volunteer invited (local demo)', accepted: 'Volunteer accepted', declined: 'Invitation declined', scheduled: 'Visit time agreed', in_progress: 'In progress', volunteer_reported_done: 'Volunteer reported done (unverified)', resident_confirmed_done: 'Resident confirmed done (not independently verified)', cancelled: 'Cancelled — retained history',
};
export const screeningStatusLabels: Record<ScreeningStatus, string> = {
  criteria_matched: 'Fictional criteria matched',
  needs_information: 'Needs information',
  known_criterion_not_met: 'A known criterion is not met',
};
export function actionTitle(scenario: DemoScenario, referenceActionId: string): string {
  return scenario.referenceActions.find((action) => action.id === referenceActionId)?.title ?? 'Reference action unavailable';
}
/** Readable local time for the screen; the machine-readable ISO value stays on `dateTime`. */
export function LocalTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const shown = Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <time dateTime={iso}>{shown}</time>;
}
export function SourceNote({ source }: { source: SourceRecord }) {
  return <p className="source-note">Source: {source.label} · {source.status === 'synthetic' ? 'Synthetic; no verification date.' : source.status === 'unverified' ? 'Unverified; no verification date.' : `Verified source record dated ${source.verifiedAt}.`}</p>;
}
