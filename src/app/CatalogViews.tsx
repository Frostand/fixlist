import { authored } from '../i18n/authored';
import { useT } from '../i18n';
import { en } from '../i18n/en';
import type { RuleResult } from '../domain/fact-screening';
import { checklistPresentation, displayAnswer } from './checklist-presentation';
import { getSelectedProfile, type DemoState } from '../domain/workflow';
import { computeWorkRelevance, screenProgram } from '../domain/screening';
import type { PlanItem } from '../domain/plan';
import type { AssistanceProgram, DemoScenario, FundingTag, ReferenceAction } from '../domain/types';
import { actionTitle, screeningStatusLabels, SourceNote } from './display';

const tagLabels: Record<FundingTag, string> = {
  general_repair: en["legacy.catalogviews.1"], railing: en["legacy.catalogviews.2"], bathroom_support: en["legacy.catalogviews.3"], lighting: en["legacy.catalogviews.4"],
};
const resultLabels = { met: en["legacy.catalogviews.5"], not_met: en["legacy.catalogviews.6"], unknown: en["legacy.catalogviews.7"] };
const relevanceLabels = { relevant: en["legacy.catalogviews.8"], not_relevant: en["legacy.catalogviews.9"], no_confirmed_work: en["legacy.catalogviews.10"] };

export function CoverageSummary({ scenario, state }: { scenario: DemoScenario; state: DemoState }) {
  const t = useT();
  const coverage = checklistPresentation(scenario, state);
  const cells = scenario.checklist.map((item) => displayAnswer(state, item.id));
  return <div className="coverage-summary">
    <p className="coverage-headline"><strong>{t("legacy.catalogviews.11")}{t('home.progress', { answered: coverage.answered, total: coverage.total, notSure: coverage.notSure, unanswered: coverage.unanswered })}</strong> {coverage.yes}{t("legacy.catalogviews.15")}{coverage.no}{t("legacy.catalogviews.16")}</p>
    <ol className="coverage-bar" aria-hidden="true">{cells.map((answer, index) => <li key={index} data-answer={answer} />)}</ol>
    <p>{t(coverage.unanswered > 0 ? 'checklist.incomplete' : coverage.notSure > 0 ? 'checklist.uncertain' : 'legacy.catalogviews.18')}</p>
    <ul className="coverage-rooms">{coverage.rooms.map((room) => <li key={room.roomId} data-complete={room.unknown === 0}>{authored(t, room.roomName)}: {t('home.progress', { answered: room.answered, total: room.total, notSure: room.notSure, unanswered: room.unanswered })}</li>)}</ul>
    <p className="small-text">{authored(t, coverage.disclaimer)}</p>
  </div>;
}

export function ProfileFacts({ scenario, state }: { scenario: DemoScenario; state: DemoState }) {
  const t = useT();
  const profile = getSelectedProfile(scenario, state);
  return <div className="profile-facts">
    <p><strong>{t("legacy.catalogviews.19")}</strong> {authored(t, profile?.label ?? t("legacy.catalogviews.20"))}</p>
    <p className="small-text">{t("legacy.catalogviews.21")}</p>
    <dl className="fact-grid">{scenario.factDefinitions.map((definition) => {
      const value = profile?.facts[definition.id];
      const missing = value === undefined || value === null;
      const shown = missing ? t("common.unknown")
        : typeof value === 'boolean' ? value ? t("check.yes") : t("check.no")
          : definition.type === 'number' ? `${value} ${definition.unit}` : value;
      return <div key={definition.id} className="fact" data-missing={missing}><dt>{authored(t, definition.label)}</dt><dd>{authored(t, shown)}</dd></div>;
    })}</dl>
  </div>;
}

export function RuleExplanation({ result }: { result: RuleResult }) {
  const t = useT();
  return <li className="rule" data-status={result.status}>
    <strong className="rule-label">{authored(t, result.label)}: {authored(t, resultLabels[result.status])}</strong>
    <p>{authored(t, result.explanation).replace(t("legacy.catalogviews.22"), '')}</p>
    {result.children.length ? <ul className="rule-tree">{result.children.map((child) => <RuleExplanation key={child.id} result={child} />)}</ul> : null}
  </li>;
}

export function ActionMetadata({ action, roomNames = [] }: { action: ReferenceAction; roomNames?: readonly string[] }) {
  const t = useT();
  const professional = action.helpRouting.kind === 'professional_review';
  return <div className="action-metadata">
    <dl className="meta-grid">
      {roomNames.length ? <div><dt>{t("legacy.catalogviews.23")}{roomNames.length === 1 ? '' : 's'}</dt><dd>{authored(t, roomNames.join(', '))}</dd></div> : null}
      <div><dt>{t("legacy.catalogviews.24")}</dt><dd><span className="routing" data-kind={action.helpRouting.kind}>{professional ? t("legacy.catalogviews.25") : t("legacy.catalogviews.26")}</span> {authored(t, action.helpRouting.explanation)}</dd></div>
      <div><dt>{t("legacy.catalogviews.27")}</dt><dd><strong>{t("legacy.catalogviews.28")}</strong> {authored(t, action.cost.explanation)}</dd></div>
      <div><dt>{t("legacy.catalogviews.29")}</dt><dd><ul className="chips">{action.fundingTags.map((tag) => <li key={tag}>{authored(t, tagLabels[tag])}</li>)}</ul></dd></div>
    </dl>
    <SourceNote source={action.source} />
    <p className="source-note"><strong>{t("legacy.catalogviews.30")}</strong> <a href={action.guidance.url}>{authored(t, action.guidance.title)}</a>, {authored(t, action.guidance.section)}{t("legacy.catalogviews.31")}{action.guidance.reviewedOn}{t("legacy.catalogviews.32")}</p>
  </div>;
}

export function RequestWorkContext({ action }: { action: ReferenceAction | undefined }) {
  const t = useT();
  return <div className="request-work-context">
    <p><strong>{t("legacy.catalogviews.33")}{action?.helpRouting.kind === 'professional_review' ? t('legacy.catalogviews.25').toLocaleLowerCase() : t('legacy.catalogviews.26').toLocaleLowerCase()}:</strong> {authored(t, action?.helpRouting.explanation ?? t("legacy.catalogviews.34"))}</p>
    <p className="small-text">{t("legacy.catalogviews.35")}</p>
  </div>;
}

export function ProgramDetails({ program, scenario, state, plan, live = false }: { program: AssistanceProgram; scenario: DemoScenario; state: DemoState; plan: readonly PlanItem[]; live?: boolean }) {
  const t = useT();
  const profile = getSelectedProfile(scenario, state);
  const screened = screenProgram(program, scenario.factDefinitions, profile?.facts ?? null);
  const relevance = computeWorkRelevance(program, plan);
  return <>
    <div className="screening-result" data-status={screened.error ? 'error' : screened.status} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <h4>{screened.error ? t("legacy.catalogviews.36") : authored(t, screeningStatusLabels[screened.status])}</h4>
      <p>{authored(t, screened.explanation)}</p>
    </div>
    {screened.ruleResult ? <ul className="rule-tree rule-root"><RuleExplanation result={screened.ruleResult} /></ul> : null}
    <div className="work-relevance" data-status={relevance.status}>
      <h4>{t("legacy.catalogviews.37")}{authored(t, relevanceLabels[relevance.status])}</h4><p>{authored(t, relevance.explanation)}</p>
      <p><strong>{t("legacy.catalogviews.38")}</strong> {program.coverageTags.map((tag) => authored(t, tagLabels[tag])).join(', ')}.</p>
      {relevance.matchedActionIds.length ? <><p>{t("legacy.catalogviews.39")}</p><ul>{relevance.matchedActionIds.map((id) => <li key={id}>{authored(t, actionTitle(scenario, id))}</li>)}</ul><p>{t("legacy.catalogviews.40")}{relevance.matchedTags.map((tag) => authored(t, tagLabels[tag])).join(', ')}.</p></> : null}
    </div>
    <div className="unmodeled">
      <h4>{t("legacy.catalogviews.41")}</h4><ul>{screened.unmodeledRequirements.map((requirement) => <li key={authored(t, requirement)}>{authored(t, requirement)}</li>)}</ul>
    </div>
    <p className="small-text">{authored(t, screened.disclaimer)}</p><SourceNote source={program.source} />
  </>;
}
