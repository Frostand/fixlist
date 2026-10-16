import { demoScenario } from '../data/demo-scenario';

export function App() {
  const confirmedCount = demoScenario.concerns.filter(
    (concern) => concern.confirmation.humanConfirmed,
  ).length;

  return (
    <main>
      <header>
        <p>Local demo setup · Scaffold only</p>
        <h1>FixList</h1>
        <p>
          The project structure and typed sample data are ready for development.
          The product journey is not implemented yet.
        </p>
      </header>

      <section aria-labelledby="sample-heading">
        <h2 id="sample-heading">Synthetic scenario loaded</h2>
        <p>{demoScenario.title}</p>
        <p>{demoScenario.disclosure}</p>
        <ul>
          <li>{demoScenario.rooms.length} sample rooms; photos have not been added.</li>
          <li>{demoScenario.evidence.length} scripted observations.</li>
          <li>{confirmedCount} human-confirmed concerns.</li>
          <li>{demoScenario.programs.length} fictional assistance record; screening is not implemented.</li>
          <li>{demoScenario.requests.length} draft family request; completion is unconfirmed.</li>
        </ul>
      </section>

      <section aria-labelledby="next-heading">
        <h2 id="next-heading">Next implementation milestones</h2>
        <ol>
          <li>Room checklist, explicit confirmation, and a computed action plan.</li>
          <li>Source-backed program screening, a family request log, and printable output.</li>
          <li>A resettable recording journey, meaningful tests, and the demo video.</li>
        </ol>
        <p>See the repository’s architecture and video shot list before building the next milestone.</p>
      </section>
    </main>
  );
}
