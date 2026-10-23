import { authored } from '../i18n/authored';
import { useT } from '../i18n';
import { en } from '../i18n/en';
import { useCallback, useState, type ReactNode } from 'react';
import type { Concern, ConcernEvidence, DemoScenario } from '../domain/types';
import {
  canConfirmConcern, computePlan, getRequestViews, getRequiredChecklistItemIds, attributionLabel,
  type ChecklistAnswer, type ResidentCommandInput, type DemoState,
} from '../domain/workflow';
import { actionTitle, LocalTime, requestStatusLabels, SourceNote } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';
import type { ScanPin } from '../lib/scan-model';
import { ScanPanel } from './ScanPanel';
import { suggestionForChecklist, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { ScanSuggestionChip } from './ScanSuggestions';
import { progressText, checklistPresentation, displayAnswer } from './checklist-presentation';

interface WorkflowProps { scenario: DemoScenario; state: DemoState; onCommand: (command: ResidentCommandInput) => void }

const answerOptions: readonly { value: ChecklistAnswer; label: string }[] = [
  { value: 'yes', label: en["check.yes"] }, { value: 'no', label: en["check.no"] }, { value: 'unknown', label: en["check.unknown"] },
];

export function StepHead({ step, id, title, children }: { step: number; id: string; title: string; children?: ReactNode }) {
  const t = useT();
  return <header className="step-head"><p className="step-index">{t("legacy.workflowsections.2")}{step}{t("legacy.workflowsections.3")}</p><h2 id={id}>{authored(t, title)}</h2>{children}</header>;
}

export function ChecklistSection({ scenario, state, onCommand, scanResetVersion = 0, scanResetting = false, scanSuggestions, onScanPinsChange }: WorkflowProps & { scanResetVersion?: number; scanResetting?: boolean; scanSuggestions?: ScanSuggestionLayer | null; onScanPinsChange?: (pins: readonly ScanPin[]) => void }) {
  const t = useT();
  const coverage = checklistPresentation(scenario, state);
  const [loadedSuggestions, setLoadedSuggestions] = useState<{ version: number; layer: ScanSuggestionLayer | null }>({ version: scanResetVersion, layer: null });
  const onSuggestionsChange = useCallback((layer: ScanSuggestionLayer | null) => setLoadedSuggestions({ version: scanResetVersion, layer }), [scanResetVersion]);
  const suggestions = scanResetting ? null : scanSuggestions ?? (loadedSuggestions.version === scanResetVersion ? loadedSuggestions.layer : null);
  return (
    <section id="checklist" className="step" aria-labelledby="checklist-heading">
      <StepHead step={1} id="checklist-heading" title={t("legacy.workflowsections.4")}>
        <p className="lead">{t("legacy.workflowsections.5")}</p>
        <p className="small-text"><strong>{scenario.title}</strong>{t("legacy.workflowsections.6")}</p>
      </StepHead>
      <CoverageSummary scenario={scenario} state={state} />
      {scanResetting ? <p className="screen-only" role="status">{t("legacy.workflowsections.7")}</p>
        : <ScanPanel key={scanResetVersion} scenario={scenario} state={state} restoreSaved={scanResetVersion === 0} onSuggestionsChange={onSuggestionsChange} {...(onScanPinsChange ? { onPinsChange: onScanPinsChange } : {})} />}
      <div className="rooms">
        {scenario.rooms.map((room) => {
          const evidence = scenario.evidence.filter((item) => item.roomId === room.id);
          const tally = coverage.rooms.find((entry) => entry.roomId === room.id);
          return (
            <article className="room" key={room.id} data-count={evidence.length} aria-labelledby={`room-${room.id}`}>
              <header className="room-head">
                <h3 id={`room-${room.id}`}>{authored(t, room.name)}</h3>
                {tally ? <p className="room-tally" data-complete={tally.unknown === 0}>{progressText(t, { answered: tally.answered, total: tally.total, notSure: tally.notSure, unanswered: tally.unanswered })}</p> : null}
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
  const t = useT();
  const item = scenario.checklist.find((entry) => entry.id === evidence.checklistItemId);
  const concerns = scenario.concerns.filter((concern) => concern.evidenceIds[0] === evidence.id);
  const confirmed = concerns.some((concern) => state.confirmations[concern.id]?.humanConfirmed === true);
  const answer = item ? displayAnswer(state, item.id) : 'unanswered';
  const suggestion = item ? suggestionForChecklist(suggestions, item.id) : undefined;
  return (
    <div className="item" data-confirmed={confirmed}>
      <div className="item-evidence">
        <p className="observation"><span className="kicker">{t("legacy.workflowsections.9")}</span>{authored(t, evidence.observation)}</p>
        <SourceNote source={evidence.source} />
      </div>
      <div className="item-decision">
      {item ? (
        <fieldset className="answer">
          <legend>{authored(t, item.prompt)}</legend>
          {answer === 'unanswered' ? <p className="small-text">{t('check.unanswered')}</p> : null}
          {suggestion ? <ScanSuggestionChip item={suggestion} /> : null}
          <div className="segmented" data-answer={answer}>
            {answerOptions.map((option) => (
              <label className="segment" key={option.value}>
                <input type="radio" name={item.id} id={`${item.id}-${option.value}`} value={option.value} checked={answer === option.value}
                  onChange={() => onCommand({ type: 'answer_checklist', checklistItemId: item.id, answer: option.value })} />
                <span>{authored(t, option.label)}</span>
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
  const t = useT();
  const confirmation = state.confirmations[concern.id];
  const title = actionTitle(scenario, concern.referenceActionId);
  const helpId = `confirmation-help-${concern.id}`;
  if (confirmation?.humanConfirmed === true) {
    return (
      <div className="concern" data-confirmed="true">
        <p className="kicker">{t("legacy.workflowsections.10")}</p><h4>{authored(t, title)}</h4>
        <p className="confirmed-tag" id={helpId}>{t("legacy.printreport.12")}{confirmation.confirmedBy} · <LocalTime iso={confirmation.confirmedAt} /></p>
        <button className="secondary compact" aria-label={t("legacy.workflowsections.11", { v0: title })} aria-describedby={helpId} onClick={() => onCommand({ type: 'unconfirm_concern', concernId: concern.id })}>{t("check.unconfirm")}</button>
      </div>
    );
  }
  const requiredIds = getRequiredChecklistItemIds(scenario, concern.id);
  return (
    <div className="concern" data-confirmed="false">
      <p className="kicker">{t("legacy.workflowsections.10")}</p><h4>{authored(t, title)}</h4>
      <p id={helpId} className="small-text">{requiredIds ? t("legacy.workflowsections.12") : t("legacy.workflowsections.13")}</p>
      <button disabled={!canConfirmConcern(scenario, state, concern.id)} aria-label={t("legacy.workflowsections.14", { v0: title })} aria-describedby={helpId} onClick={() => onCommand({ type: 'confirm_concern', concernId: concern.id, at: new Date().toISOString() })}>{t("legacy.workflowsections.15")}</button>
    </div>
  );
}

export function PlanSection({ scenario, state, onCommand }: WorkflowProps) {
  const t = useT();
  const plan = computePlan(scenario, state);
  const coverage = checklistPresentation(scenario, state);
  const concernCount = plan.reduce((count, item) => count + item.concernIds.length, 0);
  return (
    <section id="plan" className="step" aria-labelledby="plan-heading">
      <StepHead step={2} id="plan-heading" title={t("legacy.workflowsections.16")}>
        <p className="lead">{t("legacy.workflowsections.17")}</p>
      </StepHead>
      <p className="tally-line" role="status" aria-live="polite">{concernCount}{t("legacy.workflowsections.18")}{concernCount === 1 ? '' : 's'} · {plan.length}{t("legacy.workflowsections.19")}{plan.length === 1 ? '' : 's'}.</p>
      <p className="small-text">{t("legacy.workflowsections.20")}</p>
      {plan.length === 0 ? <p className="empty-state">{t("legacy.workflowsections.21")}{progressText(t, { answered: coverage.answered, total: coverage.total, notSure: coverage.notSure, unanswered: coverage.unanswered })}. {t("legacy.workflowsections.23")}</p> : (
        <ol className="plan-list">{plan.map((item) => (
          <li key={item.referenceActionId} value={item.catalogPosition}>
            <article className="action-card" data-routing={item.referenceAction.helpRouting.kind} aria-labelledby={`action-${item.referenceActionId}`}>
              <h3 id={`action-${item.referenceActionId}`}>{authored(t, item.referenceAction.title)}</h3>
              <p className="action-description">{authored(t, item.referenceAction.description)}</p>
              <p>{authored(t, item.selectionExplanation)}</p><p className="small-text">{authored(t, item.orderExplanation)}</p>
              <h4>{t("legacy.workflowsections.24")}</h4>
              <ul className="evidence-list">{item.evidence.map((evidence) => <li key={evidence.id}>{authored(t, evidence.observation)} <span className="source-note">{t("legacy.printreport.11")}{authored(t, evidence.source.label)}{t("legacy.workflowsections.25")}</span></li>)}</ul>
              <ActionMetadata action={item.referenceAction} roomNames={[...new Set(item.evidence.map((evidence) => scenario.rooms.find((room) => room.id === evidence.roomId)?.name ?? t("legacy.printreport.14")))]} />
              <div className="button-row">
                {state.requests.some((request) => request.referenceActionId === item.referenceActionId)
                  ? <a className="text-link" href="#requests">{t("legacy.workflowsections.26")}</a>
                  : <button aria-label={t("legacy.workflowsections.27", { v0: item.referenceAction.title })} onClick={() => onCommand({ type: 'create_request', referenceActionId: item.referenceActionId, expectedRevision: 0 })}>{t("legacy.workflowsections.28")}</button>}
                {item.concernIds.map((concernId) => <button className="secondary" key={concernId} aria-label={t("legacy.workflowsections.29", { v0: item.referenceAction.title, v1: item.concernIds.length > 1 ? ` (${concernId})` : '' })} onClick={() => onCommand({ type: 'unconfirm_concern', concernId })}>{t("check.unconfirm")}{item.concernIds.length > 1 ? ` (${concernId})` : ''}</button>)}
              </div>
            </article>
          </li>
        ))}</ol>
      )}
    </section>
  );
}

export function AssistanceSection({ scenario, state, onCommand }: WorkflowProps) {
  const t = useT();
  const plan = computePlan(scenario, state);
  return (
    <section id="assistance" className="step" aria-labelledby="assistance-heading">
      <StepHead step={3} id="assistance-heading" title={t("legacy.workflowsections.30")}>
        <p className="lead">{t("legacy.workflowsections.31")}</p>
      </StepHead>
      <div className="profile-panel">
        <div className="field"><label htmlFor="fictional-profile">{t("legacy.workflowsections.32")}</label><select id="fictional-profile" value={state.profileId} onChange={(event) => onCommand({ type: 'select_profile', profileId: event.target.value })}>{scenario.profiles.map((profile) => <option key={profile.id} value={profile.id}>{authored(t, profile.label)}</option>)}</select></div>
        <ProfileFacts scenario={scenario} state={state} />
      </div>
      <div className="program-grid">
        {scenario.programs.map((program) => (
          <article className="program-card" key={program.id} aria-labelledby={`program-${program.id}`}>
            <p className="eyebrow">{t("legacy.workflowsections.33")}</p><h3 id={`program-${program.id}`}>{authored(t, program.name)}</h3><p>{authored(t, program.description)}</p>
            <ProgramDetails program={program} scenario={scenario} state={state} plan={plan} live />
          </article>
        ))}
      </div>
    </section>
  );
}

export function RequestsSection({ scenario, state }: WorkflowProps) {
  const t = useT();
  const views = getRequestViews(scenario, state);
  return <section id="requests" className="step" aria-labelledby="requests-heading">
    <StepHead step={4} id="requests-heading" title={t("legacy.workflowsections.34")}><p className="lead">{t("legacy.workflowsections.35")}</p></StepHead>
    {views.length === 0 ? <p className="empty-state">{t("legacy.workflowsections.36")}</p> : views.map(({ request, activityLabel, historyNotice }) => <article className="request-card" key={request.id}>
      <p className="eyebrow">{authored(t, activityLabel)}</p><h3>{authored(t, actionTitle(scenario, request.referenceActionId))}</h3>
      <p>{authored(t, requestStatusLabels[request.status])}</p><p>{t("legacy.printreport.27")}{attributionLabel(state, request.createdBy.actorId)}.</p>
      <p>{t("legacy.printreport.28")}{authored(t, request.independentVerification)}.</p>
      {request.legacyHistory ? <p>{authored(t, request.legacyHistory.label)}: {t(`legacyStatus.${request.legacyHistory.status}`)}; {t(`legacyStatus.${request.legacyHistory.completion.status}`)}. {authored(t, request.legacyHistory.note)}</p> : null}
      <p className="notice">{authored(t, historyNotice)}</p><RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
    </article>)}
  </section>;
}
