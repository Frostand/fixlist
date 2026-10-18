import type { DemoScenario } from '../domain/types';
import {
  canConfirmConcern, computeCoverage, computePlan, getRequestViews, getRequiredChecklistItemIds,
  isChecklistAnswer, type DemoCommand, type DemoState,
} from '../domain/workflow';
import { actionTitle, requestStatusLabels, SourceNote } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';

interface WorkflowProps { scenario: DemoScenario; state: DemoState; onCommand: (command: DemoCommand) => void }

export function ChecklistSection({ scenario, state, onCommand }: WorkflowProps) {
  return (
    <section id="checklist" aria-labelledby="checklist-heading">
      <h2 id="checklist-heading">1. Observe and explicitly confirm</h2>
      <p><strong>{scenario.title}</strong> · Text-only sample rooms. Observations are authored examples, with no live detection or room photos.</p>
      <p>An answer is separate from confirmation. Answer yes to every backing question to enable its concern button. Changing yes to no or unknown removes that confirmation immediately.</p>
      <CoverageSummary scenario={scenario} state={state} />
      <div className="room-grid">
        {scenario.rooms.map((room) => {
          const evidence = scenario.evidence.filter((item) => item.roomId === room.id);
          const checklistIds = new Set(evidence.map((item) => item.checklistItemId));
          const concerns = scenario.concerns.filter((concern) => scenario.evidence.find((item) => item.id === concern.evidenceIds[0])?.roomId === room.id);
          return (
            <article className="card" key={room.id} aria-labelledby={`room-${room.id}`}>
              <h3 id={`room-${room.id}`}>{room.name}</h3>
              {evidence.map((item) => <div key={item.id}><p>{item.observation}</p><SourceNote source={item.source} /></div>)}
              {scenario.checklist.filter((item) => checklistIds.has(item.id)).map((item) => (
                <div className="field" key={item.id}>
                  <label htmlFor={item.id}>{item.prompt}</label>
                  <select id={item.id} value={state.checklistAnswers[item.id] ?? 'unknown'} onChange={(event) => {
                    if (isChecklistAnswer(event.target.value)) onCommand({ type: 'answer_checklist', checklistItemId: item.id, answer: event.target.value });
                  }}>
                    <option value="unknown">Unknown / unanswered</option><option value="yes">Yes — sample concern observed</option><option value="no">No — sample concern not observed</option>
                  </select>
                </div>
              ))}
              {concerns.map((concern) => {
                const confirmation = state.confirmations[concern.id];
                const isConfirmed = confirmation?.humanConfirmed === true;
                const requiredIds = getRequiredChecklistItemIds(scenario, concern.id);
                return (
                  <div className="confirmation" key={concern.id}>
                    <h4>{actionTitle(scenario, concern.referenceActionId)}</h4>
                    <p id={`confirmation-help-${concern.id}`} className="small-text">{isConfirmed ? `Explicitly confirmed by ${confirmation.confirmedBy} at ${confirmation.confirmedAt}. Remove confirmation in the plan below.` : requiredIds ? 'Confirmation is enabled only when every backing checklist answer is yes.' : 'The authored evidence chain is incomplete; this concern cannot be confirmed.'}</p>
                    <button disabled={isConfirmed || !canConfirmConcern(scenario, state, concern.id)} aria-label={`Confirm concern: ${actionTitle(scenario, concern.referenceActionId)}`} aria-describedby={`confirmation-help-${concern.id}`} onClick={() => onCommand({ type: 'confirm_concern', concernId: concern.id, at: new Date().toISOString() })}>{isConfirmed ? 'Confirmation recorded' : 'Confirm concern'}</button>
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PlanSection({ scenario, state, onCommand }: WorkflowProps) {
  const plan = computePlan(scenario, state);
  const coverage = computeCoverage(scenario, state);
  const concernCount = plan.reduce((count, item) => count + item.concernIds.length, 0);
  return (
    <section id="plan" aria-labelledby="plan-heading">
      <h2 id="plan-heading">2. Computed action plan</h2>
      <p role="status" aria-live="polite">{concernCount} explicitly confirmed concern{concernCount === 1 ? '' : 's'} · {plan.length} computed action{plan.length === 1 ? '' : 's'}.</p>
      <p>Actions follow authored catalog order for this demonstration. The order is not a validated risk score. Only confirmed concerns are included; a family completion report never removes them.</p>
      {plan.length === 0 ? <p className="empty-state">No plan actions yet. {coverage.unknown > 0 ? `${coverage.unknown} sample questions are still unknown; the sample checklist is incomplete. ` : 'All sample questions are answered, but no concern is explicitly confirmed. '}An empty plan does not certify safety. Answer a sample checklist question and explicitly confirm its concern.</p> : (
        <ol className="plan-list">{plan.map((item) => (
          <li key={item.referenceActionId} value={item.catalogPosition}>
            <article className="card">
              <h3>{item.referenceAction.title}</h3><p>{item.referenceAction.description}</p>
              <p>{item.selectionExplanation}</p><p className="small-text">{item.orderExplanation}</p>
              <h4>Selected authored evidence</h4><ul>{item.evidence.map((evidence) => <li key={evidence.id}>{evidence.observation} <span className="source-note">Source: {evidence.source.label} (synthetic).</span></li>)}</ul>
              <ActionMetadata action={item.referenceAction} roomNames={[...new Set(item.evidence.map((evidence) => scenario.rooms.find((room) => room.id === evidence.roomId)?.name ?? 'Unknown sample room'))]} />
              <div className="button-row">
                {item.concernIds.map((concernId) => <button className="secondary" key={concernId} aria-label={`Remove confirmation: ${item.referenceAction.title}${item.concernIds.length > 1 ? ` (${concernId})` : ''}`} onClick={() => onCommand({ type: 'unconfirm_concern', concernId })}>Remove confirmation{item.concernIds.length > 1 ? ` (${concernId})` : ''}</button>)}
                {state.requests.some((request) => request.referenceActionId === item.referenceActionId) ? <a href="#requests">View retained family record</a> : <button aria-label={`Create local request: ${item.referenceAction.title}`} onClick={() => onCommand({ type: 'create_request', referenceActionId: item.referenceActionId })}>Create local request draft</button>}
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
    <section id="assistance" aria-labelledby="assistance-heading">
      <h2 id="assistance-heading">3. Explore fictional assistance criteria</h2>
      <p>These invented programs do not exist. Choose fixed fictional facts to see how conditions and missing information affect screening. A match is never approval or guaranteed funding.</p>
      <div className="field"><label htmlFor="fictional-profile">Select a fictional profile</label><select id="fictional-profile" value={state.profileId} onChange={(event) => onCommand({ type: 'select_profile', profileId: event.target.value })}>{scenario.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></div>
      <ProfileFacts scenario={scenario} state={state} />
      {scenario.programs.map((program) => {
        return (
          <article className="card" key={program.id} aria-labelledby={`program-${program.id}`}>
            <p className="eyebrow">Fictional example · Synthetic source</p><h3 id={`program-${program.id}`}>{program.name}</h3><p>{program.description}</p>
            <ProgramDetails program={program} scenario={scenario} state={state} plan={plan} live />
          </article>
        );
      })}
    </section>
  );
}

export function RequestsSection({ scenario, state, onCommand }: WorkflowProps) {
  const views = getRequestViews(scenario, state);
  return (
    <section id="requests" aria-labelledby="requests-heading">
      <h2 id="requests-heading">4. Local family request log</h2>
      <p>This log does not contact, authenticate, vet, or qualify a helper. All identities are fixed fictional labels. Completion stays unconfirmed until a separate family report is explicitly recorded.</p>
      {views.length === 0 ? <p className="empty-state">No workflow requests. Create a local draft from an active plan action.</p> : views.map(({ request, active, activityLabel, historyNotice }) => {
        const title = actionTitle(scenario, request.referenceActionId);
        const complete = request.completion.status === 'family_reported_complete';
        return (
          <article className={`card ${active ? '' : 'inactive-record'}`} key={request.id} aria-labelledby={`request-${request.id}`}>
            <p className="eyebrow">{activityLabel}</p><h3 id={`request-${request.id}`}>{title}</h3>
            <dl>
              <dt>Current family record</dt><dd>{complete ? 'Family reported complete (unverified)' : requestStatusLabels[request.status]}</dd>
              {complete ? <><dt>Pre-completion stage</dt><dd>{requestStatusLabels[request.status]}</dd></> : null}
              <dt>Helper label</dt><dd>{request.helperLabel}</dd><dt>Recorded by</dt><dd>{request.recordedBy}</dd>
              <dt>Completion</dt><dd>{complete ? `Family reported complete by ${request.completion.reportedBy} at ${request.completion.reportedAt}.` : 'Unconfirmed — no completion report recorded.'}</dd>
            </dl>
            <p>{request.note}</p><p className="notice">{historyNotice}</p>
            <RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
            {!active ? <p>Inactive records are read-only. Explicitly confirm a backing concern again to reactivate this action; the previous family report is retained.</p> : null}
            <div className="button-row">
              {complete ? <button className="secondary" disabled={!active} aria-label={`Reopen local record: ${title}`} onClick={() => onCommand({ type: 'reopen_request', requestId: request.id })}>Reopen local record</button> : (
                <>
                  {request.status === 'draft' ? <button disabled={!active} aria-label={`Record requested: ${title}`} onClick={() => onCommand({ type: 'set_request_status', requestId: request.id, status: 'family_reported_requested' })}>Record family-reported requested</button> : request.status === 'family_reported_requested' ? <button disabled={!active} aria-label={`Record in progress: ${title}`} onClick={() => onCommand({ type: 'set_request_status', requestId: request.id, status: 'family_reported_in_progress' })}>Record family-reported in progress</button> : null}
                  {request.status !== 'draft' ? <button disabled={!active} aria-label={`Record family-reported completion: ${title}`} onClick={() => onCommand({ type: 'complete_request', requestId: request.id, at: new Date().toISOString() })}>Record family-reported completion</button> : null}
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
