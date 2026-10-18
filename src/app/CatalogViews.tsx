import type { RuleResult } from '../domain/fact-screening';
import { computeCoverage } from '../domain/coverage';
import { getSelectedProfile, type DemoState } from '../domain/workflow';
import { computeWorkRelevance, screenProgram } from '../domain/screening';
import type { PlanItem } from '../domain/plan';
import type { AssistanceProgram, DemoScenario, FundingTag, ReferenceAction } from '../domain/types';
import { actionTitle, screeningStatusLabels, SourceNote } from './display';

const tagLabels: Record<FundingTag, string> = {
  general_repair: 'General repair', railing: 'Railing', bathroom_support: 'Bathroom support', lighting: 'Lighting',
};
const resultLabels = { met: 'Condition met', not_met: 'Condition not met', unknown: 'Unknown / unanswered' };
const relevanceLabels = { relevant: 'Work categories overlap', not_relevant: 'Work categories do not overlap', no_confirmed_work: 'No confirmed work to compare' };

export function CoverageSummary({ scenario, state }: { scenario: DemoScenario; state: DemoState }) {
  const coverage = computeCoverage(scenario, state);
  const cells = scenario.checklist.map((item) => state.checklistAnswers[item.id] ?? 'unknown');
  return <div className="coverage-summary">
    <p className="coverage-headline"><strong>Sample checklist: {coverage.answered} of {coverage.total} answered; {coverage.unknown} unknown.</strong> {coverage.yes} yes; {coverage.no} no.</p>
    <ol className="coverage-bar" aria-hidden="true">{cells.map((answer, index) => <li key={index} data-answer={answer} />)}</ol>
    {coverage.unknown > 0 ? <p>The sample checklist is incomplete. Unanswered questions remain unknown even when the plan is empty.</p> : <p>All sample questions have an answer. Confirmation remains a separate step.</p>}
    <ul className="coverage-rooms">{coverage.rooms.map((room) => <li key={room.roomId} data-complete={room.unknown === 0}>{room.roomName}: {room.answered} of {room.total} answered; {room.unknown} unknown.</li>)}</ul>
    <p className="small-text">{coverage.disclaimer}</p>
  </div>;
}

export function ProfileFacts({ scenario, state }: { scenario: DemoScenario; state: DemoState }) {
  const profile = getSelectedProfile(scenario, state);
  return <div className="profile-facts">
    <p><strong>Selected profile:</strong> {profile?.label ?? 'Unavailable fictional profile'}</p>
    <p className="small-text">These fixed fictional facts are sample data, not household information.</p>
    <dl className="fact-grid">{scenario.factDefinitions.map((definition) => {
      const value = profile?.facts[definition.id];
      const missing = value === undefined || value === null;
      const shown = missing ? 'Unknown / not supplied'
        : typeof value === 'boolean' ? value ? 'Yes' : 'No'
          : definition.type === 'number' ? `${value} ${definition.unit}` : value;
      return <div key={definition.id} className="fact" data-missing={missing}><dt>{definition.label}</dt><dd>{shown}</dd></div>;
    })}</dl>
  </div>;
}

export function RuleExplanation({ result }: { result: RuleResult }) {
  return <li className="rule" data-status={result.status}>
    <strong className="rule-label">{result.label}: {resultLabels[result.status]}</strong>
    <p>{result.explanation.replace(' Every child result is retained.', '')}</p>
    {result.children.length ? <ul className="rule-tree">{result.children.map((child) => <RuleExplanation key={child.id} result={child} />)}</ul> : null}
  </li>;
}

export function ActionMetadata({ action, roomNames = [] }: { action: ReferenceAction; roomNames?: readonly string[] }) {
  const professional = action.helpRouting.kind === 'professional_review';
  return <div className="action-metadata">
    <dl className="meta-grid">
      {roomNames.length ? <div><dt>Sample room{roomNames.length === 1 ? '' : 's'}</dt><dd>{roomNames.join(', ')}</dd></div> : null}
      <div><dt>Who reviews</dt><dd><span className="routing" data-kind={action.helpRouting.kind}>{professional ? 'Professional review' : 'Family review'}</span> {action.helpRouting.explanation}</dd></div>
      <div><dt>Cost</dt><dd><strong>Cost estimate: Unknown.</strong> {action.cost.explanation}</dd></div>
      <div><dt>Fictional work categories</dt><dd><ul className="chips">{action.fundingTags.map((tag) => <li key={tag}>{tagLabels[tag]}</li>)}</ul></dd></div>
    </dl>
    <SourceNote source={action.source} />
    <p className="source-note"><strong>Reference guidance:</strong> <a href={action.guidance.url}>{action.guidance.title}</a>, {action.guidance.section}; read {action.guidance.reviewedOn}. The checklist is reference material; it does not validate this fictional observation, routing, cost, ordering or program category.</p>
  </div>;
}

export function RequestWorkContext({ action }: { action: ReferenceAction | undefined }) {
  return <div className="request-work-context">
    <p><strong>Next-step context — {action?.helpRouting.kind === 'professional_review' ? 'professional review' : 'family review'}:</strong> {action?.helpRouting.explanation ?? 'Action context is unavailable.'}</p>
    <p className="small-text">This local request records seeking appropriate help. It is not authorization to perform repairs. The fixed fictional helper label does not establish qualifications.</p>
  </div>;
}

export function ProgramDetails({ program, scenario, state, plan, live = false }: { program: AssistanceProgram; scenario: DemoScenario; state: DemoState; plan: readonly PlanItem[]; live?: boolean }) {
  const profile = getSelectedProfile(scenario, state);
  const screened = screenProgram(program, scenario.factDefinitions, profile?.facts ?? null);
  const relevance = computeWorkRelevance(program, plan);
  return <>
    <div className="screening-result" data-status={screened.error ? 'error' : screened.status} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <h4>{screened.error ? 'Screening unavailable — invalid definition or facts' : screeningStatusLabels[screened.status]}</h4>
      <p>{screened.explanation}</p>
    </div>
    {screened.ruleResult ? <ul className="rule-tree rule-root"><RuleExplanation result={screened.ruleResult} /></ul> : null}
    <div className="work-relevance" data-status={relevance.status}>
      <h4>Relation to confirmed work: {relevanceLabels[relevance.status]}</h4><p>{relevance.explanation}</p>
      <p><strong>Fictional program work categories:</strong> {program.coverageTags.map((tag) => tagLabels[tag]).join(', ')}.</p>
      {relevance.matchedActionIds.length ? <><p>Overlapping actions:</p><ul>{relevance.matchedActionIds.map((id) => <li key={id}>{actionTitle(scenario, id)}</li>)}</ul><p>Overlapping categories: {relevance.matchedTags.map((tag) => tagLabels[tag]).join(', ')}.</p></> : null}
    </div>
    <div className="unmodeled">
      <h4>Requirements this demo does not evaluate</h4><ul>{screened.unmodeledRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
    </div>
    <p className="small-text">{screened.disclaimer}</p><SourceNote source={program.source} />
  </>;
}
