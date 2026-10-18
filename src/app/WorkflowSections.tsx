import type { ReactNode } from 'react';
import type { Concern, ConcernEvidence, DemoScenario } from '../domain/types';
import {
  canConfirmConcern, computeCoverage, computePlan, getRequestViews, getRequiredChecklistItemIds,
  type ChecklistAnswer, type DemoCommand, type DemoState,
} from '../domain/workflow';
import { actionTitle, LocalTime, requestStatusLabels, SourceNote } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';
import { ScanPanel } from './ScanPanel';

interface WorkflowProps { scenario: DemoScenario; state: DemoState; onCommand: (command: DemoCommand) => void }

const answerOptions: readonly { value: ChecklistAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' },
];

export function StepHead({ step, id, title, children }: { step: number; id: string; title: string; children?: ReactNode }) {
  return <header className="step-head"><p className="step-index">Step {step} of 5</p><h2 id={id}>{title}</h2>{children}</header>;
}

export function ChecklistSection({ scenario, state, onCommand, scanResetVersion = 0, scanResetting = false }: WorkflowProps & { scanResetVersion?: number; scanResetting?: boolean }) {
  const coverage = computeCoverage(scenario, state);
  return (
    <section id="checklist" className="step" aria-labelledby="checklist-heading">
      <StepHead step={1} id="checklist-heading" title="Walk through each room">
        <p className="lead">Answer what you see. A “yes” records an observation only — the family confirms which concerns to act on as a separate step, and changing the answer back removes that confirmation immediately.</p>
        <p className="small-text"><strong>{scenario.title}</strong> · Text-only sample rooms. Observations are authored examples, with no live detection or room photos.</p>
      </StepHead>
      <CoverageSummary scenario={scenario} state={state} />
      {scanResetting ? <p className="screen-only" role="status">Clearing the saved room scan and pins…</p>
        : <ScanPanel key={scanResetVersion} scenario={scenario} state={state} restoreSaved={scanResetVersion === 0} />}
      <div className="rooms">
        {scenario.rooms.map((room) => {
          const evidence = scenario.evidence.filter((item) => item.roomId === room.id);
          const tally = coverage.rooms.find((entry) => entry.roomId === room.id);
          return (
            <article className="room" key={room.id} data-count={evidence.length} aria-labelledby={`room-${room.id}`}>
              <header className="room-head">
                <h3 id={`room-${room.id}`}>{room.name}</h3>
                {tally ? <p className="room-tally" data-complete={tally.unknown === 0}>{tally.answered}/{tally.total} answered</p> : null}
              </header>
              <div className="room-items">
                {evidence.map((item) => <ObservationItem key={item.id} scenario={scenario} state={state} onCommand={onCommand} evidence={item} />)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ObservationItem({ scenario, state, onCommand, evidence }: WorkflowProps & { evidence: ConcernEvidence }) {
  const item = scenario.checklist.find((entry) => entry.id === evidence.checklistItemId);
  const concerns = scenario.concerns.filter((concern) => concern.evidenceIds[0] === evidence.id);
  const confirmed = concerns.some((concern) => state.confirmations[concern.id]?.humanConfirmed === true);
  const answer = item ? state.checklistAnswers[item.id] ?? 'unknown' : 'unknown';
  return (
    <div className="item" data-confirmed={confirmed}>
      <div className="item-evidence">
        <p className="observation"><span className="kicker">Sample observation</span>{evidence.observation}</p>
        <SourceNote source={evidence.source} />
      </div>
      <div className="item-decision">
      {item ? (
        <fieldset className="answer">
          <legend>{item.prompt}</legend>
          <div className="segmented" data-answer={answer}>
            {answerOptions.map((option) => (
              <label className="segment" key={option.value}>
                <input type="radio" name={item.id} id={`${item.id}-${option.value}`} value={option.value} checked={answer === option.value}
                  onChange={() => onCommand({ type: 'answer_checklist', checklistItemId: item.id, answer: option.value })} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {concerns.map((concern) => <ConcernControl key={concern.id} scenario={scenario} state={state} onCommand={onCommand} concern={concern} />)}
      </div>
    </div>
  );
}

function ConcernControl({ scenario, state, onCommand, concern }: WorkflowProps & { concern: Concern }) {
  const confirmation = state.confirmations[concern.id];
  const title = actionTitle(scenario, concern.referenceActionId);
  const helpId = `confirmation-help-${concern.id}`;
  if (confirmation?.humanConfirmed === true) {
    return (
      <div className="concern" data-confirmed="true">
        <p className="kicker">Concern</p><h4>{title}</h4>
        <p className="confirmed-tag" id={helpId}>Explicitly confirmed by {confirmation.confirmedBy} · <LocalTime iso={confirmation.confirmedAt} /></p>
        <button className="secondary compact" aria-label={`Remove confirmation: ${title}`} aria-describedby={helpId} onClick={() => onCommand({ type: 'unconfirm_concern', concernId: concern.id })}>Remove confirmation</button>
      </div>
    );
  }
  const requiredIds = getRequiredChecklistItemIds(scenario, concern.id);
  return (
    <div className="concern" data-confirmed="false">
      <p className="kicker">Concern</p><h4>{title}</h4>
      <p id={helpId} className="small-text">{requiredIds ? 'Confirmation is enabled only when every backing checklist answer is yes.' : 'The authored evidence chain is incomplete; this concern cannot be confirmed.'}</p>
      <button disabled={!canConfirmConcern(scenario, state, concern.id)} aria-label={`Confirm concern: ${title}`} aria-describedby={helpId} onClick={() => onCommand({ type: 'confirm_concern', concernId: concern.id, at: new Date().toISOString() })}>Confirm concern</button>
    </div>
  );
}

export function PlanSection({ scenario, state, onCommand }: WorkflowProps) {
  const plan = computePlan(scenario, state);
  const coverage = computeCoverage(scenario, state);
  const concernCount = plan.reduce((count, item) => count + item.concernIds.length, 0);
  return (
    <section id="plan" className="step" aria-labelledby="plan-heading">
      <StepHead step={2} id="plan-heading" title="Action plan">
        <p className="lead">Built only from concerns the family confirmed. Each action explains why it is here, who should look at it, and what is still unknown.</p>
      </StepHead>
      <p className="tally-line" role="status" aria-live="polite">{concernCount} explicitly confirmed concern{concernCount === 1 ? '' : 's'} · {plan.length} computed action{plan.length === 1 ? '' : 's'}.</p>
      <p className="small-text">Actions follow authored catalog order for this demonstration. The order is not a validated risk score. Only confirmed concerns are included; a family completion report never removes them.</p>
      {plan.length === 0 ? <p className="empty-state">No plan actions yet. {coverage.unknown > 0 ? `${coverage.unknown} sample questions are still unknown; the sample checklist is incomplete. ` : 'All sample questions are answered, but no concern is explicitly confirmed. '}An empty plan does not certify safety. Answer a sample checklist question and explicitly confirm its concern.</p> : (
        <ol className="plan-list">{plan.map((item) => (
          <li key={item.referenceActionId} value={item.catalogPosition}>
            <article className="action-card" data-routing={item.referenceAction.helpRouting.kind} aria-labelledby={`action-${item.referenceActionId}`}>
              <h3 id={`action-${item.referenceActionId}`}>{item.referenceAction.title}</h3>
              <p className="action-description">{item.referenceAction.description}</p>
              <p>{item.selectionExplanation}</p><p className="small-text">{item.orderExplanation}</p>
              <h4>Selected authored evidence</h4>
              <ul className="evidence-list">{item.evidence.map((evidence) => <li key={evidence.id}>{evidence.observation} <span className="source-note">Source: {evidence.source.label} (synthetic).</span></li>)}</ul>
              <ActionMetadata action={item.referenceAction} roomNames={[...new Set(item.evidence.map((evidence) => scenario.rooms.find((room) => room.id === evidence.roomId)?.name ?? 'Unknown sample room'))]} />
              <div className="button-row">
                {state.requests.some((request) => request.referenceActionId === item.referenceActionId)
                  ? <a className="text-link" href="#requests">View retained family record</a>
                  : <button aria-label={`Create local request: ${item.referenceAction.title}`} onClick={() => onCommand({ type: 'create_request', referenceActionId: item.referenceActionId })}>Create local request draft</button>}
                {item.concernIds.map((concernId) => <button className="secondary" key={concernId} aria-label={`Remove confirmation: ${item.referenceAction.title}${item.concernIds.length > 1 ? ` (${concernId})` : ''}`} onClick={() => onCommand({ type: 'unconfirm_concern', concernId })}>Remove confirmation{item.concernIds.length > 1 ? ` (${concernId})` : ''}</button>)}
              </div>
            </article>
          </li>
        ))}</ol>
      )}
    </section>
  );
}

export function AssistanceSection({ scenario, state, onCommand }: WorkflowProps) {
  const plan = computePlan(scenario, state);
  return (
    <section id="assistance" className="step" aria-labelledby="assistance-heading">
      <StepHead step={3} id="assistance-heading" title="Check fictional help programs">
        <p className="lead">These invented programs do not exist. Choose fixed fictional facts to see how conditions and missing information affect screening. A match is never approval or guaranteed funding.</p>
      </StepHead>
      <div className="profile-panel">
        <div className="field"><label htmlFor="fictional-profile">Select a fictional profile</label><select id="fictional-profile" value={state.profileId} onChange={(event) => onCommand({ type: 'select_profile', profileId: event.target.value })}>{scenario.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></div>
        <ProfileFacts scenario={scenario} state={state} />
      </div>
      <div className="program-grid">
        {scenario.programs.map((program) => (
          <article className="program-card" key={program.id} aria-labelledby={`program-${program.id}`}>
            <p className="eyebrow">Fictional example · Synthetic source</p><h3 id={`program-${program.id}`}>{program.name}</h3><p>{program.description}</p>
            <ProgramDetails program={program} scenario={scenario} state={state} plan={plan} live />
          </article>
        ))}
      </div>
    </section>
  );
}

const stages = [
  { key: 'draft', label: 'Draft' },
  { key: 'family_reported_requested', label: 'Requested' },
  { key: 'family_reported_in_progress', label: 'In progress' },
  { key: 'complete', label: 'Reported complete' },
] as const;

export function RequestsSection({ scenario, state, onCommand }: WorkflowProps) {
  const views = getRequestViews(scenario, state);
  return (
    <section id="requests" className="step" aria-labelledby="requests-heading">
      <StepHead step={4} id="requests-heading" title="Family log">
        <p className="lead">This log does not contact, authenticate, vet, or qualify a helper. All identities are fixed fictional labels. Completion stays unconfirmed until a separate family report is explicitly recorded.</p>
      </StepHead>
      {views.length === 0 ? <p className="empty-state">No workflow requests. Create a local draft from an active plan action.</p> : views.map(({ request, active, activityLabel, historyNotice }) => {
        const title = actionTitle(scenario, request.referenceActionId);
        const complete = request.completion.status === 'family_reported_complete';
        const reached = (key: (typeof stages)[number]['key']) => key === 'draft' || (key === 'complete' ? complete
          : key === 'family_reported_requested' ? request.status !== 'draft' : request.status === 'family_reported_in_progress');
        const current = complete ? 'complete' : request.status;
        return (
          <article className={`request-card ${active ? '' : 'inactive-record'}`} key={request.id} aria-labelledby={`request-${request.id}`}>
            <p className="eyebrow">{activityLabel}</p><h3 id={`request-${request.id}`}>{title}</h3>
            <ol className="stages" aria-label="Family-reported stages">{stages.map((stage) => (
              <li key={stage.key} data-reached={reached(stage.key)} aria-current={current === stage.key ? 'step' : undefined}>
                <span>{stage.label}</span>{reached(stage.key) ? <span className="sr-only"> (recorded)</span> : null}
              </li>
            ))}</ol>
            <dl className="record-grid">
              <div><dt>Current family record</dt><dd>{complete ? 'Family reported complete (unverified)' : requestStatusLabels[request.status]}</dd></div>
              {complete ? <div><dt>Pre-completion stage</dt><dd>{requestStatusLabels[request.status]}</dd></div> : null}
              <div><dt>Helper label</dt><dd>{request.helperLabel}</dd></div><div><dt>Recorded by</dt><dd>{request.recordedBy}</dd></div>
              <div className="span-all"><dt>Completion</dt><dd>{request.completion.status === 'family_reported_complete' ? <>Family reported complete by {request.completion.reportedBy} at <LocalTime iso={request.completion.reportedAt} />.</> : 'Unconfirmed — no completion report recorded.'}</dd></div>
            </dl>
            <p>{request.note}</p><p className="notice">{historyNotice}</p>
            <RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
            {!active ? <p className="small-text">Inactive records are read-only. Explicitly confirm a backing concern again to reactivate this action; the previous family report is retained.</p> : null}
            <div className="button-row">
              {complete ? <button className="secondary" disabled={!active} aria-label={`Reopen local record: ${title}`} onClick={() => onCommand({ type: 'reopen_request', requestId: request.id })}>Reopen local record</button> : (
                <>
                  {request.status === 'draft' ? <button disabled={!active} aria-label={`Record requested: ${title}`} onClick={() => onCommand({ type: 'set_request_status', requestId: request.id, status: 'family_reported_requested' })}>Record family-reported requested</button> : request.status === 'family_reported_requested' ? <button disabled={!active} aria-label={`Record in progress: ${title}`} onClick={() => onCommand({ type: 'set_request_status', requestId: request.id, status: 'family_reported_in_progress' })}>Record family-reported in progress</button> : null}
                  {request.status !== 'draft' ? <button className={request.status === 'family_reported_in_progress' ? undefined : 'secondary'} disabled={!active} aria-label={`Record family-reported completion: ${title}`} onClick={() => onCommand({ type: 'complete_request', requestId: request.id, at: new Date().toISOString() })}>Record family-reported completion</button> : null}
                </>
              )}
            </div>
            <SourceNote source={request.source} />
          </article>
        );
      })}
    </section>
  );
}
