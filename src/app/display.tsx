import { authored } from '../i18n/authored';
import { useT, useLanguage, localeFor } from '../i18n';
import { en } from '../i18n/en';
import type { HelpRequestStatus } from '../domain/roles';
import type { DemoScenario, ScreeningStatus, SourceRecord } from '../domain/types';

export const requestStatusLabels: Record<HelpRequestStatus, string> = {
  draft: en["status.draft"], invited: en["legacy.display.1"], accepted: en["legacy.display.2"], declined: en["legacy.display.3"], scheduled: en["legacy.display.4"], in_progress: en["status.in_progress"], volunteer_reported_done: en["legacy.display.5"], resident_confirmed_done: en["legacy.display.6"], cancelled: en["legacy.display.7"],
};
export const screeningStatusLabels: Record<ScreeningStatus, string> = {
  criteria_matched: en["legacy.display.8"],
  needs_information: en["legacy.display.9"],
  known_criterion_not_met: en["screen.knownFailure"],
};
export function actionTitle(scenario: DemoScenario, referenceActionId: string): string {
  return scenario.referenceActions.find((action) => action.id === referenceActionId)?.title ?? en["legacy.display.10"];
}
/** Readable local time for the screen; the machine-readable ISO value stays on `dateTime`. */
export function LocalTime({ iso }: { iso: string }) {
  const language = useLanguage();
  const date = new Date(iso);
  const shown = Number.isNaN(date.getTime()) ? iso : date.toLocaleString(localeFor(language), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return <time dateTime={iso}>{shown}</time>;
}
export function SourceNote({ source }: { source: SourceRecord }) {
  const t = useT();
  return <p className="source-note">{t("legacy.printreport.11")}{authored(t, source.label)} · {source.status === 'synthetic' ? t("legacy.display.11") : source.status === 'unverified' ? t("legacy.display.12") : t("legacy.display.13", { v0: source.verifiedAt })}</p>;
}
