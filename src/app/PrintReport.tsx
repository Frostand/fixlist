import { authored } from '../i18n/authored';
import { PhotoImage } from './Photos';
import { SharingSummary } from './RequestScreens';
import { personLabel } from './view-model';
import { useT } from '../i18n';
import type { DemoScenario } from '../domain/types';
import { computePlan, getRequestViews } from '../domain/workflow';
import type { PrintSnapshot } from '../lib/print';
import { actionTitle, LocalTime, requestStatusLabels } from './display';
import { ActionMetadata, CoverageSummary, ProfileFacts, ProgramDetails, RequestWorkContext } from './CatalogViews';
import { displayAnswer } from './checklist-presentation';

export function PrintReport({ scenario, snapshot }: { scenario: DemoScenario; snapshot: PrintSnapshot }) {
  const t = useT();
  const plan = computePlan(scenario, snapshot.state);
  const requests = getRequestViews(scenario, snapshot.state);
  return (
    <article className="print-report" aria-labelledby="report-title">
      <header>
        <p className="eyebrow">{t("legacy.printreport.1")}</p><h2 id="report-title">{t("legacy.printreport.2")}</h2><p><strong>{authored(t, scenario.title)}</strong></p>
        <p>{t("legacy.printreport.3")}<LocalTime iso={snapshot.generatedAt} />{t("legacy.printreport.4")}</p><p>{authored(t, scenario.disclosure)}</p>
        <p><strong>{t("legacy.printreport.5")}</strong>{t("legacy.printreport.6")}</p>
      </header>
      <section aria-labelledby="report-coverage-heading"><h3 id="report-coverage-heading">{t("legacy.printreport.7")}</h3><CoverageSummary scenario={scenario} state={snapshot.state} /><ul>{scenario.checklist.map((q) => <li key={q.id}><strong>{authored(t, q.prompt)}</strong>: {t(`check.${displayAnswer(snapshot.state, q.id)}`)}{snapshot.state.checklistAttribution[q.id] ? <p>{t('person.by', { name: personLabel(snapshot.state.people, snapshot.state.checklistAttribution[q.id]!.actorId, t) })}</p> : null}</li>)}</ul></section>
      <section aria-labelledby="report-plan-heading">
        <h3 id="report-plan-heading">{t("legacy.printreport.8")}</h3><p>{t("legacy.printreport.9")}</p>
        {plan.length === 0 ? <p>{t("legacy.printreport.10")}</p> : (
          <ol className="plan-list">{plan.map((item) => (
            <li key={item.referenceActionId} value={item.catalogPosition}>
              <article>
                <h4>{authored(t, item.referenceAction.title)}</h4><p>{authored(t, item.referenceAction.description)}</p><p>{authored(t, item.selectionExplanation)}</p><p>{authored(t, item.orderExplanation)}</p>
                <ul>{item.evidence.map((evidence) => <li key={evidence.id}>{authored(t, evidence.observation)} <span className="source-note">{t("legacy.printreport.11")}{authored(t, evidence.source.label)} ({authored(t, evidence.source.status)}).</span></li>)}</ul>
                <ul>{item.concernIds.map((id) => {
                  const confirmation = snapshot.state.confirmations[id];
                  return confirmation?.humanConfirmed ? <li key={id}>{t("legacy.printreport.12")}{personLabel(snapshot.state.people, confirmation.actorId, t)}{t("legacy.printreport.13")}<LocalTime iso={confirmation.confirmedAt} />.</li> : null;
                })}</ul>
                <p>{t('plan.next')}: {authored(t, item.referenceAction.nextStep)}</p><a href={item.referenceAction.guidance.url}>{t('plan.source')}</a><ActionMetadata action={item.referenceAction} roomNames={[...new Set(item.evidence.map((evidence) => scenario.rooms.find((room) => room.id === evidence.roomId)?.name ?? t("legacy.printreport.14")))]} />
              </article>
            </li>
          ))}</ol>
        )}
      </section>
      <section><h3>{t('report.photos')}</h3><div className="photo-grid">{snapshot.state.photos.map((photo) => <figure key={photo.id}><PhotoImage photo={photo} /><figcaption>{t('person.by', { name: personLabel(snapshot.state.people, photo.addedBy, t) })}</figcaption></figure>)}</div></section><section aria-labelledby="report-scan-heading">
        <h3 id="report-scan-heading">{t("legacy.printreport.15")}</h3>
        <p>{t("legacy.printreport.16")}</p>
        {snapshot.scanPins.length === 0 ? <p>{t("legacy.printreport.17")}</p> : snapshot.scanPins.map((pin) => {
          const concern = scenario.concerns.find((entry) => entry.id === pin.concernId);
          const name = concern ? actionTitle(scenario, concern.referenceActionId) : pin.concernId;
          return <figure key={pin.id} className="print-scan-location">
            <figcaption><h4>{t("legacy.printreport.18")}{authored(t, name)}</h4><p>{pin.origin === 'ai-suggestion' ? t("legacy.printreport.19") : t("legacy.printreport.20")}</p></figcaption>
            {pin.image ? <img src={pin.image} alt={t("legacy.printreport.21", { v0: name })} width="320" /> : <p>{t("report.noImage")}</p>}
          </figure>;
        })}
      </section>
      <section aria-labelledby="report-assistance-heading">
        <h3 id="report-assistance-heading">{t("legacy.printreport.22")}</h3>
        <ProfileFacts scenario={scenario} state={snapshot.state} />
        {scenario.programs.map((program) => {
          return (
            <article key={program.id} className="program-report">
              <h4>{authored(t, program.name)}</h4><p>{t("legacy.printreport.23")}{authored(t, program.description)}</p>
              <ProgramDetails program={program} scenario={scenario} state={snapshot.state} plan={plan} />
            </article>
          );
        })}
      </section>
      <section aria-labelledby="report-requests-heading">
        <h3 id="report-requests-heading">{t("legacy.printreport.24")}</h3><p>{t("legacy.printreport.25")}</p>
        {requests.length === 0 ? <p>{t("legacy.printreport.26")}</p> : requests.map(({ request, activityLabel, historyNotice }) => (
          <article key={request.id}>
            <h4>{authored(t, actionTitle(scenario, request.referenceActionId))}</h4><p><strong>{authored(t, activityLabel)}</strong> · {authored(t, requestStatusLabels[request.status])}</p>
            <p>{t("legacy.printreport.27")}{personLabel(snapshot.state.people, request.createdBy.actorId, t)}.</p>
            <p>{t("legacy.printreport.28")}{authored(t, request.independentVerification)}.</p>
            {request.legacyHistory ? <p>{authored(t, request.legacyHistory.label)}: {t(`legacyStatus.${request.legacyHistory.status}`)}; {t(`legacyStatus.${request.legacyHistory.completion.status}`)}. {authored(t, request.legacyHistory.note)}</p> : null}
            <p><strong>{t("legacy.printreport.29")}</strong> {authored(t, historyNotice)}</p>
            {request.proposedTime ? <div><h4>{t('request.proposed')}</h4><p>{request.proposedTime.text}</p><p>{t('person.written', { name: personLabel(snapshot.state.people, request.proposedTime.actorId, t) })}</p></div> : null}{request.agreedTime ? <p>{t('request.agreed')} · {t('person.by', { name: personLabel(snapshot.state.people, request.agreedTime.actorId, t) })}</p> : null}{request.reportedDone ? <p>{t('status.volunteer_reported_done')} · {t('person.by', { name: personLabel(snapshot.state.people, request.reportedDone.actorId, t) })}</p> : null}{request.confirmedDone ? <p>{t('status.resident_confirmed_done')} · {t('person.by', { name: personLabel(snapshot.state.people, request.confirmedDone.actorId, t) })}</p> : null}<SharingSummary request={request} />{request.updates.map((u, i) => <blockquote key={i}><p>{u.text}</p><footer>{t('person.written', { name: personLabel(snapshot.state.people, u.actorId, t) })}</footer></blockquote>)}<RequestWorkContext action={scenario.referenceActions.find((action) => action.id === request.referenceActionId)} />
          </article>
        ))}
      </section>
      <footer><p>{t("legacy.printreport.30")}</p></footer>
    </article>
  );
}
