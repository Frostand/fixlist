import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState } from '../domain/workflow';
import { MAX_SCAN_PINS, upgradeScanDocument, type Point3, type ScanAsset, type ScanDocumentV2 } from '../lib/scan-model';
import { getScanStore, loadScan, saveScan, type ScanStorageResult } from '../lib/scan-storage';
import { importScanSelection } from '../lib/scan-import';
import { getLocalDemoScans, loadLocalDemoScan, type LocalDemoScan } from '../lib/local-scan-loader';
import { isIOSDevice } from '../lib/scan-device';
import { createSuggestionCatalog, suggestionId, visibleSuggestionMarkers, type ScanSuggestion, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { dismissScanSuggestion, pinScanSuggestion } from '../lib/scan-suggestion-actions';
import { ScanSuggestions } from './ScanSuggestions';

const ScanViewer = lazy(() => import('./ScanViewer'));

export interface ScanConcern { id: string; label: string; roomId: string; confirmed: boolean }
interface Props { scenario: DemoScenario; state: DemoState; restoreSaved?: boolean; onSuggestionsChange?: (layer: ScanSuggestionLayer | null) => void }

class ViewerBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() {
    return this.state.failed ? <p role="alert" className="error-message">The 3D viewer could not start. Reload the page to retry loading the viewer. The checklist and plan are still available.</p> : this.props.children;
  }
}

/** This shell imports no renderer. Opening a saved scan is also an explicit action. */
export function ScanPanel({ scenario, state, restoreSaved = true, onSuggestionsChange }: Props) {
  const [document, setDocument] = useState<ScanDocumentV2 | null>(null);
  const current = useRef<ScanDocumentV2 | null>(null);
  const [open, setOpen] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [busy, setBusy] = useState(restoreSaved);
  const [storage, setStorage] = useState<ScanStorageResult>({ ok: true, message: restoreSaved ? 'Checking this browser for a saved scan…' : 'No room scan in this view. Import one or try the generated sample.' });
  const [loadNotice, setLoadNotice] = useState('');
  const [error, setError] = useState('');
  const [viewerMessage, setViewerMessage] = useState('');
  const [placing, setPlacing] = useState('');
  const [focus, setFocus] = useState<{ position: Point3; viewpoint?: Point3 | null; sequence: number } | null>(null);
  const [localScans, setLocalScans] = useState<LocalDemoScan[]>([]);
  const [relaxAccept, setRelaxAccept] = useState(false);
  const alive = useRef(true), importSequence = useRef(0), saveSequence = useRef(0);
  const ready = useRef(false), canSave = useRef(false), needsSave = useRef(false);
  const [concernIds] = useState(() => new Set(scenario.concerns.map((concern) => concern.id)));
  const [suggestionCatalog] = useState(() => createSuggestionCatalog(scenario));
  const concerns: ScanConcern[] = scenario.concerns.map((concern) => {
    const evidence = scenario.evidence.find((entry) => entry.id === concern.evidenceIds[0]);
    const action = scenario.referenceActions.find((entry) => entry.id === concern.referenceActionId);
    const room = scenario.rooms.find((entry) => entry.id === evidence?.roomId);
    return { id: concern.id, label: `${room?.name ?? 'Sample room'}: ${action?.title ?? concern.id}`, roomId: room?.id ?? '', confirmed: state.confirmations[concern.id]?.humanConfirmed === true };
  });

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    if (restoreSaved) {
      void loadScan(getScanStore(), concernIds, suggestionCatalog).then((result) => {
        if (cancelled) return;
        const restored = result.document ? upgradeScanDocument(result.document) : null;
        current.current = restored;
        canSave.current = result.document !== null;
        setDocument(restored);
        setStorage(result);
        if (result.message.includes('dropped')) setLoadNotice(result.message);
        setBusy(false);
      });
    }
    return () => { cancelled = true; alive.current = false; importSequence.current++; };
  }, [concernIds, restoreSaved, suggestionCatalog]);

  useEffect(() => { onSuggestionsChange?.(document?.suggestions ?? null); }, [document?.suggestions, onSuggestionsChange]);
  useEffect(() => {
    setRelaxAccept(isIOSDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    const controller = new AbortController();
    void getLocalDemoScans(fetch, controller.signal).then((scans) => { if (!controller.signal.aborted) setLocalScans(scans); });
    return () => controller.abort();
  }, []);
  // Dev/preview convenience (e.g. the iOS Simulator): ?localScan=<name> opens a listed local scan once.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current || busy || localScans.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get('localScan');
    const entry = localScans.find((scan) => scan.name === requested);
    if (!entry) return;
    autoLoaded.current = true;
    void loadLocal(entry);
  });

  function persist(next: ScanDocumentV2) {
    const sequence = ++saveSequence.current;
    setStorage({ ok: true, message: 'Saving scan changes in this browser…' });
    void saveScan(getScanStore(), next, concernIds, suggestionCatalog).then((result) => {
      if (alive.current && sequence === saveSequence.current) setStorage(result);
    });
  }
  function change(next: ScanDocumentV2) {
    current.current = next;
    setDocument(next);
    needsSave.current = true;
    if (canSave.current) { persist(next); needsSave.current = false; }
  }
  function useDocument(next: ScanDocumentV2) {
    ready.current = false;
    canSave.current = false;
    needsSave.current = true;
    current.current = next;
    setDocument(next);
    setViewerVersion((version) => version + 1);
    setFocus(null);
    setPlacing('');
    setError('');
    setLoadNotice('');
    setViewerMessage('Loading room geometry…');
    setStorage({ ok: true, message: 'Room is in memory. It will be saved only after it loads successfully.' });
    setOpen(true);
  }
  async function importFiles(files: readonly File[]) {
    if (busy || files.length === 0) return;
    const sequence = ++importSequence.current;
    setBusy(true);
    setError('');
    const result = await importScanSelection(files, suggestionCatalog);
    if (!alive.current || sequence !== importSequence.current) return;
    if (!result.ok) { setError(result.error); setBusy(false); return; }
    useDocument(result.value);
  }
  function useAsset(asset: ScanAsset) { useDocument({ version: 2, asset, flipUpright: false, pins: [], suggestions: null }); }
  async function loadLocal(entry: LocalDemoScan) {
    if (busy) return;
    const sequence = ++importSequence.current;
    setBusy(true); setError('');
    const result = await loadLocalDemoScan(entry, suggestionCatalog);
    if (!alive.current || sequence !== importSequence.current) return;
    if (!result.ok) { setError(result.error); setBusy(false); return; }
    useDocument(result.value);
  }
  async function sample() {
    if (busy) return;
    const sequence = ++importSequence.current;
    setBusy(true);
    setError('');
    try {
      const { generateSampleRoom } = await import('../lib/scan-sample');
      if (alive.current && sequence === importSequence.current) useAsset(generateSampleRoom());
    } catch {
      if (alive.current && sequence === importSequence.current) { setError('The generated room could not be created. Reload to retry.'); setBusy(false); }
    }
  }
  function place(position: Point3) {
    const latest = current.current;
    if (!latest || !placing || !concernIds.has(placing)) return;
    if (latest.pins.length >= MAX_SCAN_PINS) { setError(`This room already has ${MAX_SCAN_PINS} pins. Remove a pin before adding another.`); return; }
    const pin = { id: crypto.randomUUID(), concernId: placing, position, createdAt: new Date().toISOString() };
    change({ ...latest, pins: [...latest.pins, pin] });
    setPlacing('');
    setError('');
    setViewerMessage(`Pin ${latest.pins.length + 1} placed. The concern is not confirmed by placing a pin.`);
  }
  function showSuggestion(item: ScanSuggestion) {
    const position = item.position;
    if (position) setFocus((previous) => ({ position, viewpoint: item.viewpoint, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  function pinSuggestion(item: ScanSuggestion) {
    if (!current.current) return;
    const result = pinScanSuggestion(current.current, suggestionId(item), crypto.randomUUID(), new Date().toISOString());
    if (!result.ok) { setError(result.error); return; }
    change(result.value); setError('');
    setViewerMessage('Suggestion added as a family-placed pin. The checklist and confirmation are unchanged.');
  }

  return (
    <section className="scan-panel screen-only" aria-labelledby="scan-heading">
      <p className="eyebrow">Optional room reference</p>
      <h3 id="scan-heading">3D room scan (optional)</h3>
      <p>The scan stays in this browser and is never uploaded. Pins are placed by you; they are not hazard detection. A pin is not a confirmation.</p>
      <p className="small-text">Scan a room you are comfortable showing, with mail, screens and faces out of frame. Import one scan and optionally its scene.json and suggestions.json together, or drop them here. Importing or generating another room replaces this room, its pins and model suggestions.</p>
      <div className="scan-import" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer.files)); }}>
        <label htmlFor="scan-file">Import a local scan (up to 300 MiB)</label>
        <input id="scan-file" type="file" multiple accept={relaxAccept ? undefined : '.splat,.ply,.spz,.ksplat,.json'} disabled={busy}
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />
        <p className="small-text">Supported: .splat, .ply, .spz, .ksplat. Optional metadata must be named scene.json; optional model output must be named suggestions.json.</p>
      </div>
      {localScans.length ? <div className="scan-local-demos"><h4>Load a local demo scan</h4><p className="small-text">Available on this developer server only. Loading replaces the current room and its pins.</p><div className="button-row">{localScans.map((entry) => <button className="secondary" key={entry.name} disabled={busy} onClick={() => void loadLocal(entry)}>Load local demo scan: {entry.name} ({(entry.sizes['scene.splat'] / (1024 * 1024)).toFixed(1)} MiB)</button>)}</div></div> : null}
      <div className="button-row">
        <button className="secondary" disabled={busy} onClick={() => void sample()}>Try a generated sample room</button>
        {document && !open ? <button disabled={busy} onClick={() => { setOpen(true); setBusy(true); }}>Open saved room viewer</button> : null}
        {document && open ? <button className="secondary" onClick={() => { ready.current = false; setOpen(false); setBusy(false); setPlacing(''); }}>Close room viewer</button> : null}
      </div>
      {loadNotice ? <p className="notice" role="status">{loadNotice}</p> : null}
      <p role="status" aria-live="polite" className="small-text scan-storage" data-healthy={storage.ok}>{storage.message}</p>
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      {document ? <>
        <p className="scan-caption"><strong>{document.asset.kind === 'generated' ? 'Generated sample room — not scanned' : 'Imported room — supplied by you, not assessed by FixList'}</strong><br /><span className="small-text">{document.asset.name} · {(document.asset.blob.size / (1024 * 1024)).toFixed(1)} MiB{document.asset.metadata ? ' · Pipeline metadata: y-up, arbitrary units' : ' · No pipeline metadata; view framed from splat bounds'}</span></p>
        <label className="scan-flip"><input type="checkbox" checked={document.flipUpright} onChange={(event) => change({ ...document, flipUpright: event.target.checked })} />Flip upright (for upside-down app exports)</label>
        {open ? <>
          <div className="field">
            <label htmlFor="scan-concern">Place a pin for:</label>
            <select id="scan-concern" value={placing} disabled={busy || document.pins.length >= MAX_SCAN_PINS} onChange={(event) => setPlacing(event.target.value)}>
              <option value="">Choose a concern to place a pin</option>
              {concerns.map((concern) => <option key={concern.id} value={concern.id}>{concern.label}</option>)}
            </select>
          </div>
          <p id="scan-controls-help" className="small-text">Drag to orbit; scroll or pinch to zoom. Focus the scene and use arrow keys to orbit, +/− to zoom, Home to reset. Choose a concern, then tap or click a surface or use “Place pin at center of view.” Pins link to the fictional checklist only.</p>
          <ViewerBoundary key={viewerVersion} onFail={() => { setBusy(false); ready.current = false; }}><Suspense fallback={<p role="status">Loading the 3D viewer…</p>}>
            <ScanViewer asset={document.asset} flipUpright={document.flipUpright} pins={document.pins} suggestions={visibleSuggestionMarkers(document.suggestions)} expectedSuggestionCount={document.suggestions?.data.scan.splatCount ?? null} concerns={concerns} placing={Boolean(placing)} focus={focus} onPlace={place}
              onReady={(count) => {
                ready.current = true;
                canSave.current = true;
                setBusy(false);
                setError('');
                setViewerMessage(`${count.toLocaleString()} splats loaded. ${document.asset.kind === 'generated' ? 'This room is generated, not scanned.' : 'This scan has not been assessed by FixList.'}`);
                if (needsSave.current && current.current) { persist(current.current); needsSave.current = false; }
              }}
              onError={(message) => { ready.current = false; setBusy(false); setError(message); setViewerMessage(''); }} />
          </Suspense></ViewerBoundary>
          <p role="status" aria-live="polite" className="small-text">{viewerMessage}</p>
        </> : null}
        {document.suggestions ? <ScanSuggestions layer={document.suggestions} catalog={suggestionCatalog} viewerReady={open && !busy && ready.current} canAddPin={document.pins.length < MAX_SCAN_PINS}
          onShow={showSuggestion} onPin={pinSuggestion} onDismiss={(item, dismissed) => { if (current.current) change(dismissScanSuggestion(current.current, suggestionId(item), dismissed)); }} /> : null}
        <h4>Room pins ({document.pins.length}/{MAX_SCAN_PINS})</h4>
        <p className="small-text">Yellow means the linked concern is explicitly confirmed right now. Ink means it is unconfirmed. Pins never change the checklist, plan, help screening or family log.</p>
        {document.pins.length === 0 ? <p className="small-text">No pins placed. Open the room and choose a concern to add one.</p> : <ol className="scan-pin-list">{document.pins.map((pin, index) => {
          const concern = concerns.find((entry) => entry.id === pin.concernId);
          return <li key={pin.id} data-confirmed={concern?.confirmed === true}>
            <span className="scan-pin-number" aria-hidden="true">{index + 1}</span>
            <div><strong>{concern?.label}</strong><p className="small-text">{concern?.confirmed ? 'Concern explicitly confirmed' : 'Concern unconfirmed'} · Family-placed location</p>
              <div className="button-row">
                <button className="secondary compact" disabled={!open || busy || !ready.current} onClick={() => setFocus((previous) => ({ position: pin.position, sequence: (previous?.sequence ?? 0) + 1 }))} aria-label={`View pin ${index + 1}: ${concern?.label}`}>View pin {index + 1}</button>
                <a className="text-link" href={`#room-${concern?.roomId}`}>Go to room checklist</a>
                <button className="secondary compact" aria-label={`Remove pin ${index + 1}: ${concern?.label}`} onClick={() => change({ ...document, pins: document.pins.filter((entry) => entry.id !== pin.id) })}>Remove pin</button>
              </div>
            </div>
          </li>;
        })}</ol>}
      </> : null}
    </section>
  );
}
