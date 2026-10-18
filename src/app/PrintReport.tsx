import type { DemoScenario } from '../domain/types';
import { computePlan, getRequestViews } from '../domain/workflow';
import type { PrintSnapshot } from '../lib/print';
import { actionTitle, requestStatusLabels, SourceNote } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';

export function PrintReport({ scenario, snapshot }: { scenario: DemoScenario; snapshot: PrintSnapshot }) {
  const plan = computePlan(scenario, snapshot.state);
  const requests = getRequestViews(scenario, snapshot.state);
  return (
    <article className="print-report" aria-labelledby="report-title">
      <header>
        <p className="eyebrow">Synthetic scenario · Local record only</p><h2 id="report-title">FixList local demo report</h2><p><strong>{scenario.title}</strong></p>
        <p>Generated at <time dateTime={snapshot.generatedAt}>{snapshot.generatedAt}</time> (UTC).</p><p>{scenario.disclosure}</p>
        <p><strong>Evidence limits:</strong> Authored observations are separate from human confirmation. This app does not certify safety, find every hazard, or provide a complete assessment. No external contact, approval, or independent repair verification is established by this report.</p>
      </header>
      <section aria-labelledby="report-coverage-heading"><h3 id="report-coverage-heading">Sample checklist coverage</h3><CoverageSummary scenario={scenario} state={snapshot.state} /></section>
      <section aria-labelledby="report-plan-heading">
        <h3 id="report-plan-heading">Confirmed-concern action plan</h3><p>Demonstration review order follows the authored action catalog and stable IDs; it is not a validated risk score. Unconfirmed concerns are excluded.</p>
        {plan.length === 0 ? <p>No confirmed concerns or computed actions in this snapshot.</p> : (
          <ol className="plan-list">{plan.map((item) => (
            <li key={item.referenceActionId} value={item.catalogPosition}>
              <article>
                <h4>{item.referenceAction.title}</h4><p>{item.referenceAction.description}</p><p>{item.selectionExplanation}</p><p>{item.orderExplanation}</p>
                <ul>{item.evidence.map((evidence) => <li key={evidence.id}>{evidence.observation} <span className="source-note">Source: {evidence.source.label} ({evidence.source.status}).</span></li>)}</ul>
                <ul>{item.concernIds.map((id) => {
                  const confirmation = snapshot.state.confirmations[id];
                  return confirmation?.humanConfirmed ? <li key={id}>Explicitly confirmed by {confirmation.confirmedBy} at <time dateTime={confirmation.confirmedAt}>{confirmation.confirmedAt}</time>.</li> : null;
                })}</ul>
                <ActionMetadata action={item.referenceAction} roomNames={[...new Set(item.evidence.map((evidence) => scenario.rooms.find((room) => room.id === evidence.roomId)?.name ?? 'Unknown sample room'))]} />
              </article>
            </li>
          ))}</ol>
        )}
      </section>
      <section aria-labelledby="report-assistance-heading">
        <h3 id="report-assistance-heading">Fictional assistance screening</h3>
        <ProfileFacts scenario={scenario} state={snapshot.state} />
        {scenario.programs.map((program) => {
          return (
            <article key={program.id} className="program-report">
              <h4>{program.name}</h4><p>Fictional example: this program does not exist. {program.description}</p>
              <ProgramDetails program={program} scenario={scenario} state={snapshot.state} plan={plan} />
            </article>
          );
        })}
      </section>
      <section aria-labelledby="report-requests-heading">
        <h3 id="report-requests-heading">Local family reports and retained history</h3><p>These records do not contact, authenticate, vet, or qualify helpers. A family report is not independent verification, and it does not resolve any current or newly confirmed concern.</p>
        {requests.length === 0 ? <p>No local family request records in this snapshot.</p> : requests.map(({ request, activityLabel, historyNotice }) => (
          <article key={request.id}>
            <h4>{actionTitle(scenario, request.referenceActionId)}</h4><p><strong>{activityLabel}</strong> · {request.completion.status === 'family_reported_complete' ? 'Family reported complete (unverified)' : requestStatusLabels[request.status]}</p>
            {request.completion.status === 'family_reported_complete' ? <p>Pre-completion stage: {requestStatusLabels[request.status]}.</p> : null}
            <p>Helper label: {request.helperLabel}. Recorded by: {request.recordedBy}.</p>
            <p>{request.completion.status === 'family_reported_complete' ? <>Family reported complete by {request.completion.reportedBy} at <time dateTime={request.completion.reportedAt}>{request.completion.reportedAt}</time>.</> : 'Completion unconfirmed — no family completion report recorded.'}</p>
            <p>{request.note}</p><p><strong>History boundary:</strong> {historyNotice}</p><SourceNote source={request.source} />
            <RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
          </article>
        ))}
      </section>
      <footer><p>Built with React, TypeScript, and Vite with AI implementation assistance. This generated report is a synthetic demonstration, not a home assessment or an independently verified outcome.</p></footer>
    </article>
  );
}
