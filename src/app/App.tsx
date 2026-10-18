import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { demoScenario } from '../data/demo-scenario';
import { applyCommand, validateCatalog, type DemoCommand } from '../domain/workflow';
import { getBrowserStorage, loadDemoState, resetDemoState, saveDemoState } from '../lib/demo-storage';
import { createPrintSnapshot } from '../lib/print';
import { PrintReport } from './PrintReport';
import { AssistanceSection, ChecklistSection, PlanSection, RequestsSection } from './WorkflowSections';

export function App() {
  const validation = validateCatalog(demoScenario);
  return validation.ok ? <DemoApp /> : <main><h1>FixList demo unavailable</h1><p role="alert">The authored catalog is invalid: {validation.error}</p></main>;
}

function DemoApp() {
  const [initial] = useState(() => {
    const storage = getBrowserStorage();
    return { storage, ...loadDemoState(storage, demoScenario) };
  });
  const [state, setState] = useState(initial.state);
  const currentState = useRef(initial.state);
  const [persistence, setPersistence] = useState({ status: initial.status as string, message: initial.message });
  const [feedback, setFeedback] = useState('Start with a sample checklist answer, then explicitly confirm a concern.');
  const [error, setError] = useState('');
  const [report, setReport] = useState(() => createPrintSnapshot(initial.state));
  const [reportIsCurrent, setReportIsCurrent] = useState(true);

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
    setFeedback(messages[command.type]);
  }

  function resetDemo() {
    const result = resetDemoState(initial.storage, demoScenario);
    currentState.current = result.state;
    setState(result.state);
    setPersistence(result);
    setError('');
    setFeedback('Fresh synthetic demo restored: all profile facts and sample answers are unknown, with no confirmations or workflow requests.');
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

  return (
    <>
      <a className="skip-link screen-only" href="#main-content">Skip to demo</a>
      <main id="main-content" tabIndex={-1}>
        <div className="app-screen">
          <header>
            <p className="eyebrow">Local browser demo · Synthetic data only</p>
            <h1>FixList</h1>
            <p className="intro">Turn explicitly confirmed sample concerns into an explained action plan, then record possible next steps locally.</p>
            <p>{demoScenario.disclosure}</p>
            <p className="notice">This app does not certify a home as safe, find every hazard, or provide a complete assessment. Use only the fictional controls shown here.</p>
            <nav aria-label="Demo sections">
              <a href="#checklist">Checklist</a><a href="#plan">Action plan</a><a href="#assistance">Assistance</a><a href="#requests">Family log</a><a href="#print-preview">Printable report</a>
            </nav>
          </header>
          <section className="session-status" aria-label="Local demo status">
            <p role="status" aria-live="polite" aria-atomic="true" className={['saved', 'loaded', 'migrated', 'reset', 'empty'].includes(persistence.status) ? '' : 'notice'}><strong>Browser storage:</strong> {persistence.message}</p>
            <p role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
            {error ? <p role="alert" className="error-message">{error}</p> : null}
            <button className="secondary" onClick={resetDemo}>Reset synthetic demo</button>
            <p className="small-text">Reset affects only FixList’s demo data in this browser. There are no accounts or external messages.</p>
          </section>
          <ChecklistSection scenario={demoScenario} state={state} onCommand={runCommand} />
          <PlanSection scenario={demoScenario} state={state} onCommand={runCommand} />
          <AssistanceSection scenario={demoScenario} state={state} onCommand={runCommand} />
          <RequestsSection scenario={demoScenario} state={state} onCommand={runCommand} />
        </div>
        <section id="print-preview" className="print-preview-shell" aria-labelledby="print-heading">
          <div className="screen-only">
            <h2 id="print-heading">5. Inspect and print</h2>
            <p>The report below is a frozen snapshot. Refresh it to inspect the current state. Printing captures the current state and a fresh generation time, including browser-menu printing.</p>
            <div className="button-row"><button className="secondary" onClick={refreshReport}>Refresh report preview</button><button onClick={printCurrentReport}>Print current report</button></div>
            <p role="status" aria-live="polite">{reportIsCurrent ? 'Report preview reflects the current demo state.' : 'The demo has changed since this snapshot. Refresh the report or print to capture the current state.'}</p>
            <p className="small-text">Uses native browser printing. Opening printing does not confirm that a PDF was saved or that its layout was verified.</p>
          </div>
          <PrintReport scenario={demoScenario} snapshot={report} />
        </section>
        <footer className="app-screen"><p>Local React, TypeScript, and Vite demonstration. Implementation uses AI assistance; see the project’s assistance disclosures. Student technical contributions and understanding must be documented before submission.</p></footer>
      </main>
    </>
  );
}
