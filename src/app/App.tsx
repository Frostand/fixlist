import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { demoScenario } from '../data/demo-scenario';
import { applyCommand, computeCoverage, computePlan, getRequestViews, validateCatalog, type DemoCommand } from '../domain/workflow';
import { getBrowserStorage, loadDemoState, resetDemoState, saveDemoState } from '../lib/demo-storage';
import { createPrintSnapshot } from '../lib/print';
import { FloorPlan } from './FloorPlan';
import { PrintReport } from './PrintReport';
import { AssistanceSection, ChecklistSection, PlanSection, RequestsSection, StepHead } from './WorkflowSections';

const sectionIds = ['checklist', 'plan', 'assistance', 'requests', 'print-preview'] as const;
const healthyStorage = ['saved', 'loaded', 'migrated', 'reset', 'empty'];

export function App() {
  const validation = validateCatalog(demoScenario);
  return validation.ok ? <DemoApp /> : <main className="unavailable"><h1>FixList demo unavailable</h1><p role="alert">The authored catalog is invalid: {validation.error}</p></main>;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 14.5 16 4l12 10.5V28H4Z" className="logo-house" />
      <path d="M10 16h12M10 21h8" className="logo-lines" />
      <rect x="20" y="19" width="4.5" height="4.5" rx="1" className="logo-flag" />
    </svg>
  );
}

/** Highlights the last step whose top has passed the reading line; purely navigational, never saved. */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(sectionIds[0]);
  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current: string = sectionIds[0];
      for (const id of sectionIds) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return active;
}

function DemoApp() {
  const [initial] = useState(() => {
    const storage = getBrowserStorage();
    return { storage, ...loadDemoState(storage, demoScenario) };
  });
  const [state, setState] = useState(initial.state);
  const currentState = useRef(initial.state);
  const [persistence, setPersistence] = useState({ status: initial.status as string, message: initial.message });
  const [feedback, setFeedback] = useState({ id: 0, text: 'Start with a sample checklist answer, then explicitly confirm a concern.' });
  const [error, setError] = useState('');
  const [report, setReport] = useState(() => createPrintSnapshot(initial.state));
  const [reportIsCurrent, setReportIsCurrent] = useState(true);
  const activeSection = useActiveSection();

  function announce(text: string) {
    setFeedback((previous) => ({ id: previous.id + 1, text }));
  }

  function runCommand(command: DemoCommand) {
    const result = applyCommand(demoScenario, currentState.current, command);
    if (!result.ok) { setError(result.error); return; }
    // Successive events see the latest command; storage stays outside React updaters/effects.
    currentState.current = result.state;
    setState(result.state);
    setPersistence(saveDemoState(initial.storage, demoScenario, result.state));
    setError('');
    setReportIsCurrent(false);
    const messages: Record<DemoCommand['type'], string> = {
      answer_checklist: 'Checklist answer recorded. Answers alone do not confirm a concern.',
      confirm_concern: 'Concern explicitly confirmed. The action plan was recomputed.',
      unconfirm_concern: 'Confirmation removed. The action plan was recomputed; request history is retained.',
      select_profile: 'Fictional profile selected. Screening was recomputed; confirmations and family records are unchanged.',
      create_request: 'Local draft recorded. Nothing was sent.',
      set_request_status: 'Family-reported status recorded locally. Nothing was sent.',
      complete_request: 'Family-reported completion recorded. This does not verify a repair or resolve a concern.',
      reopen_request: 'Local family record reopened. Completion is unconfirmed again.',
    };
    announce(messages[command.type]);
  }

  function resetDemo() {
    const result = resetDemoState(initial.storage, demoScenario);
    currentState.current = result.state;
    setState(result.state);
    setPersistence(result);
    setError('');
    announce('Fresh synthetic demo restored: all profile facts and sample answers are unknown, with no confirmations or workflow requests.');
    setReport(createPrintSnapshot(result.state));
    setReportIsCurrent(true);
  }

  function refreshReport() {
    setReport(createPrintSnapshot(currentState.current));
    setReportIsCurrent(true);
  }

  useEffect(() => {
    function beforePrint() {
      flushSync(() => {
        setReport(createPrintSnapshot(currentState.current));
        setReportIsCurrent(true);
      });
    }
    window.addEventListener('beforeprint', beforePrint);
    return () => window.removeEventListener('beforeprint', beforePrint);
  }, []);

  function printCurrentReport() {
    flushSync(refreshReport);
    try { window.print(); }
    catch { setError('The browser could not open printing. The inspectable report remains below; no PDF was created by this app.'); }
  }

  const coverage = computeCoverage(demoScenario, state);
  const plan = computePlan(demoScenario, state);
  const requests = getRequestViews(demoScenario, state);
  const activeRequests = requests.filter((view) => view.active).length;
  const steps = [
    { id: 'checklist', label: 'Walk-through', meta: `${coverage.answered} of ${coverage.total} answered` },
    { id: 'plan', label: 'Action plan', meta: plan.length ? `${plan.length} action${plan.length === 1 ? '' : 's'}` : 'Nothing confirmed yet' },
    { id: 'assistance', label: 'Help programs', meta: `${demoScenario.programs.length} fictional programs` },
    { id: 'requests', label: 'Family log', meta: requests.length ? `${activeRequests} active · ${requests.length - activeRequests} history` : 'No records' },
    { id: 'print-preview', label: 'Printable report', meta: reportIsCurrent ? 'Preview is current' : 'Changed since preview' },
  ];
  const storageHealthy = healthyStorage.includes(persistence.status);

  return (
    <>
      <a className="skip-link screen-only" href="#main-content">Skip to the walk-through</a>
      <div className="shell">
        <aside className="rail screen-only" aria-label="Demo overview">
          <div className="brand"><Logo /><div><p className="brand-name">FixList</p><p className="brand-tag">The family repair list</p></div></div>
          <FloorPlan scenario={demoScenario} state={state} />
          <nav aria-label="Demo steps">
            <ol className="step-nav">{steps.map((step, index) => (
              <li key={step.id}>
                <a href={`#${step.id}`} aria-current={activeSection === step.id ? 'location' : undefined}>
                  <span className="step-number" aria-hidden="true">{index + 1}</span>
                  <span className="step-text"><span className="step-label">{step.label}</span><span className="step-meta">{step.meta}</span></span>
                </a>
              </li>
            ))}</ol>
          </nav>
          <div className="rail-footer">
            <p role="status" aria-live="polite" aria-atomic="true" className="storage-line" data-healthy={storageHealthy}><strong>Browser storage:</strong> {persistence.message}</p>
            <button className="secondary compact" onClick={resetDemo}>Reset synthetic demo</button>
            <p className="small-text">Reset clears only FixList’s demo data in this browser. No accounts, no external messages.</p>
          </div>
        </aside>
        <main id="main-content" tabIndex={-1}>
          <div className="app-screen">
            <header className="page-head">
              <p className="eyebrow">Local browser demo · Synthetic data only</p>
              <h1>{demoScenario.title}</h1>
              <p className="intro">Walk through five rooms, confirm what the family wants to fix, and leave with a plan everyone can read — with every unknown left visible.</p>
              <p className="notice">{demoScenario.disclosure} FixList does not certify a home as safe, find every hazard, or provide a complete assessment.</p>
            </header>
            {error ? <p role="alert" className="error-message">{error}</p> : null}
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{feedback.text}</p>
            <ChecklistSection scenario={demoScenario} state={state} onCommand={runCommand} />
            <PlanSection scenario={demoScenario} state={state} onCommand={runCommand} />
            <AssistanceSection scenario={demoScenario} state={state} onCommand={runCommand} />
            <RequestsSection scenario={demoScenario} state={state} onCommand={runCommand} />
          </div>
          <section id="print-preview" className="step print-preview-shell" aria-labelledby="print-heading">
            <div className="screen-only">
              <StepHead step={5} id="print-heading" title="Printable report">
                <p className="lead">A frozen snapshot for the family and the resident. Refresh it to inspect the current state; printing always captures the current state with a fresh generation time.</p>
              </StepHead>
              <div className="report-toolbar">
                <p role="status" aria-live="polite" className="report-state" data-current={reportIsCurrent}>{reportIsCurrent ? 'Report preview reflects the current demo state.' : 'The demo has changed since this snapshot. Refresh the report or print to capture the current state.'}</p>
                <div className="button-row"><button className="secondary" onClick={refreshReport}>Refresh report preview</button><button onClick={printCurrentReport}>Print current report</button></div>
              </div>
              <p className="small-text">Uses native browser printing. Opening printing does not confirm that a PDF was saved or that its layout was verified.</p>
            </div>
            <div className="paper"><PrintReport scenario={demoScenario} snapshot={report} /></div>
          </section>
          <footer className="app-screen site-footer"><p>FixList local demo · React, TypeScript and Vite, built with AI assistance · All homes, people and programs are fictional.</p></footer>
        </main>
      </div>
      {feedback.id > 0 ? <div className="toast screen-only" aria-hidden="true" key={feedback.id}>{feedback.text}</div> : null}
    </>
  );
}
