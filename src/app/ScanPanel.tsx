import { scanMessage } from '../i18n/authored';
import { catalogText } from '../i18n/catalog';
import { useT, Copy } from '../i18n';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState } from '../domain/workflow';
import { MAX_SCAN_PINS, upgradeScanDocument, type Point3, type ScanAsset, type ScanDocumentV2, type ScanPin } from '../lib/scan-model';
import { getScanStore, loadScan, saveScan, type ScanStorageResult } from '../lib/scan-storage';
import { importScanSelection } from '../lib/scan-import';
import { getLocalDemoScans, loadLocalDemoScan, type LocalDemoScan } from '../lib/local-scan-loader';
import { isIOSDevice } from '../lib/scan-device';
import { createSuggestionCatalog, suggestionId, visibleSuggestionMarkers, type ScanSuggestion, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { dismissScanSuggestion, pinScanSuggestion } from '../lib/scan-suggestion-actions';
import { ScanSuggestions } from './ScanSuggestions';

const ScanViewer = lazy(() => import('./ScanViewer'));

export interface ScanConcern { id: string; label: string; roomId: string; confirmed: boolean }
interface Props { scenario: DemoScenario; state: DemoState; restoreSaved?: boolean; onSuggestionsChange?: (layer: ScanSuggestionLayer | null) => void; onPinsChange?: (pins: readonly ScanPin[]) => void }

class ViewerBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() {
    return this.state.failed ? <p role="alert" className="error-message"><Copy id="legacy.scanpanel.2" /></p> : this.props.children;
  }
}

/** This shell imports no renderer. Opening a saved scan is also an explicit action. */
export function ScanPanel({ scenario, state, restoreSaved = true, onSuggestionsChange, onPinsChange }: Props) {
  const t = useT();
  const [document, setDocument] = useState<ScanDocumentV2 | null>(null);
  const current = useRef<ScanDocumentV2 | null>(null);
  const [open, setOpen] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [busy, setBusy] = useState(restoreSaved);
  const [storage, setStorage] = useState<ScanStorageResult>({ ok: true, message: restoreSaved ? t("legacy.scanpanel.3") : t("legacy.scanpanel.4") });
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
    return { id: concern.id, label: `${room ? catalogText(t, 'room', room.id) : t("legacy.catalogviews.23")}: ${action ? catalogText(t, 'action', action.id, 'title') : concern.id}`, roomId: room?.id ?? '', confirmed: state.confirmations[concern.id]?.humanConfirmed === true };
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

  useEffect(() => { onPinsChange?.(document?.pins ?? []); }, [document?.pins, onPinsChange]);
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
    setStorage({ ok: true, message: t("legacy.scanpanel.6") });
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
  function openDocument(next: ScanDocumentV2) {
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
    setViewerMessage(t("legacy.scanpanel.7"));
    setStorage({ ok: true, message: t("legacy.scanpanel.8") });
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
    openDocument(result.value);
  }
  function useAsset(asset: ScanAsset) { openDocument({ version: 2, asset, flipUpright: false, pins: [], suggestions: null }); }
  async function loadLocal(entry: LocalDemoScan) {
    if (busy) return;
    const sequence = ++importSequence.current;
    setBusy(true); setError('');
    const result = await loadLocalDemoScan(entry, suggestionCatalog);
    if (!alive.current || sequence !== importSequence.current) return;
    if (!result.ok) { setError(result.error); setBusy(false); return; }
    openDocument(result.value);
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
      if (alive.current && sequence === importSequence.current) { setError(t("legacy.scanpanel.9")); setBusy(false); }
    }
  }
  function place(position: Point3, image: string | null) {
    const latest = current.current;
    if (!latest || !placing || !concernIds.has(placing)) return;
    if (latest.pins.length >= MAX_SCAN_PINS) { setError(t("legacy.scanpanel.10", { v0: MAX_SCAN_PINS })); return; }
    const pin: ScanPin = { id: `pin-${crypto.randomUUID()}`, concernId: placing, position, createdAt: new Date().toISOString(), origin: 'family', image };
    change({ ...latest, pins: [...latest.pins, pin] });
    setPlacing('');
    setError('');
    setViewerMessage(t("legacy.scanpanel.11", { v0: latest.pins.length + 1 }));
  }
  function showSuggestion(item: ScanSuggestion) {
    const position = item.position;
    if (position) setFocus((previous) => ({ position, viewpoint: item.viewpoint, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  function pinSuggestion(item: ScanSuggestion) {
    if (!current.current) return;
    const result = pinScanSuggestion(current.current, suggestionId(item), `pin-${crypto.randomUUID()}`, new Date().toISOString());
    if (!result.ok) { setError(result.error); return; }
    change(result.value); setError('');
    setViewerMessage(t("legacy.scanpanel.12"));
  }

  return (
    <section className="scan-panel screen-only" aria-labelledby="scan-heading">
      <p className="eyebrow">{t("legacy.scanpanel.13")}</p>
      <h3 id="scan-heading">{t("legacy.scanpanel.14")}</h3>
      <p>{t("legacy.scanpanel.15")}</p>
      <p className="small-text">{t("legacy.scanpanel.16")}</p>
      <div className="scan-import" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer.files)); }}>
        <label htmlFor="scan-file">{t("legacy.scanpanel.17")}</label>
        <input id="scan-file" type="file" multiple accept={relaxAccept ? undefined : '.splat,.ply,.spz,.ksplat,.json'} disabled={busy}
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />
        <p className="small-text">{t("legacy.scanpanel.18")}</p>
      </div>
      {localScans.length ? <div className="scan-local-demos"><h4>{t("legacy.scanpanel.19")}</h4><p className="small-text">{t("legacy.scanpanel.20")}</p><div className="button-row">{localScans.map((entry) => <button className="secondary" key={entry.name} disabled={busy} onClick={() => void loadLocal(entry)}>{t("legacy.scanpanel.21")}{entry.name} ({(entry.sizes['scene.splat'] / (1024 * 1024)).toFixed(1)}{t("legacy.scanpanel.22")}</button>)}</div></div> : null}
      <div className="button-row">
        <button className="secondary" disabled={busy} onClick={() => void sample()}>{t("legacy.scanpanel.23")}</button>
        {document && !open ? <button disabled={busy} onClick={() => { setOpen(true); setBusy(true); }}>{t("legacy.scanpanel.24")}</button> : null}
        {document && open ? <button className="secondary" onClick={() => { ready.current = false; setOpen(false); setBusy(false); setPlacing(''); }}>{t("legacy.scanpanel.25")}</button> : null}
      </div>
      {loadNotice ? <p className="notice" role="status">{scanMessage(t, loadNotice)}</p> : null}
      <p role="status" aria-live="polite" className="small-text scan-storage" data-healthy={storage.ok}>{scanMessage(t, storage.message)}</p>
      {error ? <p role="alert" className="error-message">{scanMessage(t, error)}</p> : null}
      {document ? <>
        <p className="scan-caption"><strong>{document.asset.kind === 'generated' ? t("legacy.scanpanel.26") : t("legacy.scanpanel.27")}</strong><br /><span className="small-text">{document.asset.name} · {(document.asset.blob.size / (1024 * 1024)).toFixed(1)}{t("legacy.scanpanel.28")}{document.asset.metadata ? t("legacy.scanpanel.29") : t("legacy.scanpanel.30")}</span></p>
        <label className="scan-flip"><input type="checkbox" checked={document.flipUpright} onChange={(event) => change({ ...document, flipUpright: event.target.checked })} />{t("legacy.scanpanel.31")}</label>
        {open ? <>
          <div className="field">
            <label htmlFor="scan-concern">{t("legacy.scanpanel.32")}</label>
            <select id="scan-concern" value={placing} disabled={busy || document.pins.length >= MAX_SCAN_PINS} onChange={(event) => setPlacing(event.target.value)}>
              <option value="">{t("legacy.scanpanel.33")}</option>
              {concerns.map((concern) => <option key={concern.id} value={concern.id}>{concern.label}</option>)}
            </select>
          </div>
          <p id="scan-controls-help" className="small-text">{t("legacy.scanpanel.34")}</p>
          <ViewerBoundary key={viewerVersion} onFail={() => { setBusy(false); ready.current = false; }}><Suspense fallback={<p role="status">{t("legacy.scanpanel.35")}</p>}>
            <ScanViewer asset={document.asset} flipUpright={document.flipUpright} pins={document.pins} suggestions={visibleSuggestionMarkers(document.suggestions)} expectedSuggestionCount={document.suggestions?.data.scan.splatCount ?? null} concerns={concerns} placing={Boolean(placing)} focus={focus} onPlace={place}
              onReady={(count) => {
                ready.current = true;
                canSave.current = true;
                setBusy(false);
                setError('');
                setViewerMessage(t('scan.loaded', { count: count.toLocaleString(), notice: document.asset.kind === 'generated' ? t("legacy.scanpanel.36") : t("legacy.scanpanel.37") }));
                if (needsSave.current && current.current) { persist(current.current); needsSave.current = false; }
              }}
              onError={(message) => { ready.current = false; setBusy(false); setError(message); setViewerMessage(''); }} />
          </Suspense></ViewerBoundary>
          <p role="status" aria-live="polite" className="small-text">{viewerMessage}</p>
        </> : null}
        {document.suggestions ? <ScanSuggestions layer={document.suggestions} catalog={suggestionCatalog} viewerReady={open && !busy && ready.current} canAddPin={document.pins.length < MAX_SCAN_PINS}
          onShow={showSuggestion} onPin={pinSuggestion} onDismiss={(item, dismissed) => { if (current.current) change(dismissScanSuggestion(current.current, suggestionId(item), dismissed)); }} /> : null}
        <h4>{t("legacy.scanpanel.38")}{document.pins.length}/{MAX_SCAN_PINS})</h4>
        <p className="small-text">{t("legacy.scanpanel.39")}</p>
        {document.pins.length === 0 ? <p className="small-text">{t("legacy.scanpanel.40")}</p> : <ol className="scan-pin-list">{document.pins.map((pin, index) => {
          const concern = concerns.find((entry) => entry.id === pin.concernId);
          return <li key={pin.id} data-confirmed={concern?.confirmed === true}>
            <span className="scan-pin-number" aria-hidden="true">{index + 1}</span>
            <div><strong>{concern?.label}</strong><p className="small-text">{concern?.confirmed ? t("legacy.scanpanel.41") : t("legacy.scanpanel.42")} · {pin.origin === 'ai-suggestion' ? t("legacy.scanpanel.43") : t("legacy.scanpanel.44")}</p>
              <div className="button-row">
                <button className="secondary compact" disabled={!open || busy || !ready.current} onClick={() => setFocus((previous) => ({ position: pin.position, sequence: (previous?.sequence ?? 0) + 1 }))} aria-label={t("legacy.scanpanel.45", { v0: index + 1, v1: concern?.label })}>{t("legacy.scanpanel.46")}{index + 1}</button>
                <a className="text-link" href={`#/r/question/${scenario.checklist.find((q) => q.roomId === concern?.roomId)?.id ?? scenario.checklist[0]!.id}`}>{t("legacy.scanpanel.47")}</a>
                <button className="secondary compact" aria-label={t("legacy.scanpanel.48", { v0: index + 1, v1: concern?.label })} onClick={() => change({ ...document, pins: document.pins.filter((entry) => entry.id !== pin.id) })}>{t("legacy.scanpanel.49")}</button>
              </div>
            </div>
          </li>;
        })}</ol>}
      </> : null}
    </section>
  );
}
