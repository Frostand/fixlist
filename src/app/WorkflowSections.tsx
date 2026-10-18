import { useCallback, useState, type ReactNode } from 'react';
import type { Concern, ConcernEvidence, DemoScenario } from '../domain/types';
import {
  canConfirmConcern, computeCoverage, computePlan, getRequestViews, getRequiredChecklistItemIds, attributionLabel,
  type ChecklistAnswer, type ResidentCommandInput, type DemoState,
} from '../domain/workflow';
import { actionTitle, LocalTime, requestStatusLabels, SourceNote } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';
import type { ScanPin } from '../lib/scan-model';
import { ScanPanel } from './ScanPanel';
import { suggestionForChecklist, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { ScanSuggestionChip } from './ScanSuggestions';

interface WorkflowProps { scenario: DemoScenario; state: DemoState; onCommand: (command: ResidentCommandInput) => void }

const answerOptions: readonly { value: ChecklistAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' },
];

export function StepHead({ step, id, title, children }: { step: number; id: string; title: string; children?: ReactNode }) {
  return <header className="step-head"><p className="step-index">Step {step} of 5</p><h2 id={id}>{title}</h2>{children}</header>;
}

export function ChecklistSection({ scenario, state, onCommand, scanResetVersion = 0, scanResetting = false, scanSuggestions, onScanPinsChange }: WorkflowProps & { scanResetVersion?: number; scanResetting?: boolean; scanSuggestions?: ScanSuggestionLayer | null; onScanPinsChange?: (pins: readonly ScanPin[]) => void }) {
  const coverage = computeCoverage(scenario, state);
  const [loadedSuggestions, setLoadedSuggestions] = useState<{ version: number; layer: ScanSuggestionLayer | null }>({ version: scanResetVersion, layer: null });
  const onSuggestionsChange = useCallback((layer: ScanSuggestionLayer | null) => setLoadedSuggestions({ version: scanResetVersion, layer }), [scanResetVersion]);
  const suggestions = scanResetting ? null : scanSuggestions ?? (loadedSuggestions.version === scanResetVersion ? loadedSuggestions.layer : null);
  return (
    <section id="checklist" className="step" aria-labelledby="checklist-heading">
      <StepHead step={1} id="checklist-heading" title="Walk through each room">
        <p className="lead">Answer what you see. A “yes” records an observation only — the family confirms which concerns to act on as a separate step, and changing the answer back removes that confirmation immediately.</p>
        <p className="small-text"><strong>{scenario.title}</strong> · Text-only sample rooms. Observations are authored examples, with no live detection or room photos.</p>
      </StepHead>
      <CoverageSummary scenario={scenario} state={state} />
      {scanResetting ? <p className="screen-only" role="status">Clearing the saved room scan and pins…</p>
        : <ScanPanel key={scanResetVersion} scenario={scenario} state={state} restoreSaved={scanResetVersion === 0} onSuggestionsChange={onSuggestionsChange} {...(onScanPinsChange ? { onPinsChange: onScanPinsChange } : {})} />}
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
                {evidence.map((item) => <ObservationItem key={item.id} scenario={scenario} state={state} onCommand={onCommand} evidence={item} suggestions={suggestions} />)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ObservationItem({ scenario, state, onCommand, evidence, suggestions }: WorkflowProps & { evidence: ConcernEvidence; suggestions: ScanSuggestionLayer | null }) {
  const item = scenario.checklist.find((entry) => entry.id === evidence.checklistItemId);
  const concerns = scenario.concerns.filter((concern) => concern.evidenceIds[0] === evidence.id);
  const confirmed = concerns.some((concern) => state.confirmations[concern.id]?.humanConfirmed === true);
  const answer = item ? state.checklistAnswers[item.id] ?? 'unknown' : 'unknown';
  const suggestion = item ? suggestionForChecklist(suggestions, item.id) : undefined;
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
          {suggestion ? <ScanSuggestionChip item={suggestion} /> : null}
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
                  : <button aria-label={`Create local request: ${item.referenceAction.title}`} onClick={() => onCommand({ type: 'create_request', referenceActionId: item.referenceActionId, expectedRevision: 0 })}>Create local request draft</button>}
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

export function RequestsSection({ scenario, state }: WorkflowProps) {
  const views = getRequestViews(scenario, state);
  return <section id="requests" className="step" aria-labelledby="requests-heading">
    <StepHead step={4} id="requests-heading" title="Family log"><p className="lead">Local help-request records. Nothing is sent, and no helper or repair is independently verified.</p></StepHead>
    {views.length === 0 ? <p className="empty-state">No workflow requests. Create a local draft from an active plan action.</p> : views.map(({ request, activityLabel, historyNotice }) => <article className="request-card" key={request.id}>
      <p className="eyebrow">{activityLabel}</p><h3>{actionTitle(scenario, request.referenceActionId)}</h3>
      <p>{requestStatusLabels[request.status]}</p><p>Recorded by: {attributionLabel(state, request.createdBy.actorId)}.</p>
      <p>Independent verification: {request.independentVerification}.</p>
      {request.legacyHistory ? <p>{request.legacyHistory.label}: {request.legacyHistory.status}; {request.legacyHistory.completion.status}. {request.legacyHistory.note}</p> : null}
      <p className="notice">{historyNotice}</p><RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
    </article>)}
  </section>;
}
