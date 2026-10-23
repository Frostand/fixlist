import { scanFailureMessage, scanMessage } from '../i18n/authored';
import { projectedCatalogText, catalogText } from '../i18n/catalog';
import { useT, useLanguage, localeFor, Copy } from '../i18n';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState } from '../domain/workflow';
import { MAX_SCAN_PINS, upgradeScanDocument, verifiedSceneHash, type Point3, type ScanAsset, type ScanDocumentV2, type ScanPin } from '../lib/scan-model';
import { getScanStore, loadScan, saveScan, type ScanFailureCode, type ScanStorageResult } from '../lib/scan-storage';
import { importScanSelection } from '../lib/scan-import';
import { createScanLoadTask, getLocalDemoScans, loadLocalDemoScan, type LocalDemoScan } from '../lib/local-scan-loader';
import { isIOSDevice } from '../lib/scan-device';
import { createSuggestionCatalog, suggestionId, validateSuggestionScene, visibleSuggestionMarkers, type ScanSuggestion, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { dismissScanSuggestion, pinScanSuggestion, reconcileScanSuggestionPins, removeScanPin } from '../lib/scan-suggestion-actions';
import { ScanSuggestions } from './ScanSuggestions';
import { scanConcernQuestions } from '../lib/location';
import { isAnnotatedScanImage } from '../lib/scan-image';

const ScanViewer = lazy(() => import('./ScanViewer'));

// Exact bytes of the licensed public-render adaptation credited in CREDITS.md.
// A filename or a developer-local path alone is not evidence of this source.
export const SAMPLE_APARTMENT_SCENE_SHA256 = '591d0f21e85b830bd9c848477a5686c98b8393768a49ec7d781fe002bc54e61c';
type ScanSourceOrigin = 'user' | 'local' | 'saved';
export function scanSourceKind(kind: ScanAsset['kind'], verifiedHash: string | undefined, origin: ScanSourceOrigin) {
  return kind === 'generated' ? 'generated' : verifiedHash === SAMPLE_APARTMENT_SCENE_SHA256 ? 'sample' : origin === 'user' ? 'imported' : origin;
}
export function ScanSourceNote({ source }: { source: ReturnType<typeof scanSourceKind> }) {
  const t = useT();
  return <p className="scan-source-note">{t(source === 'sample' ? 'scan.sampleLabel' : source === 'generated' ? 'legacy.scanpanel.26' : source === 'imported' ? 'legacy.scanpanel.27' : source === 'local' ? 'scan.localLabel' : 'scan.savedLabel')}</p>;
}
export function SampleApartmentCredit() {
  const t = useT();
  return <div className="scan-sample-credit"><p>{t('scan.sampleCredit')}</p><a className="source-link" href="https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm">{t('scan.sampleTitle')}</a><a className="source-link" href="https://creativecommons.org/licenses/by-sa/4.0/">{t('scan.sampleLicense')}</a></div>;
}

export function ScanPinQuestions({ scenario, concernId }: { scenario: DemoScenario; concernId: string }) {
  const t = useT(), questions = scanConcernQuestions(scenario, concernId);
  return questions.length ? <>{questions.length > 1 ? <span>{t('scanViewer.questionChoice')}</span> : null}{questions.map((question) => <a key={question.id} className="text-link" href={`#/r/question/${question.id}`}>{questions.length === 1 ? t('legacy.scanpanel.47') : catalogText(t, 'check', question.id)}</a>)}</> : <span>{t('scanViewer.noQuestion')}</span>;
}

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
  const t = useT(), language = useLanguage();
  const [document, setDocument] = useState<ScanDocumentV2 | null>(null);
  const [sourceOrigin, setSourceOrigin] = useState<ScanSourceOrigin>('saved');
  const importInput = useRef<HTMLInputElement>(null);
  const current = useRef<ScanDocumentV2 | null>(null);
  const [open, setOpen] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [busy, setBusy] = useState(restoreSaved);
  const [storage, setStorage] = useState<ScanStorageResult>({ ok: true, message: restoreSaved ? t("legacy.scanpanel.3") : t("legacy.scanpanel.4") });
  const [loadNotice, setLoadNotice] = useState('');
  const [error, setError] = useState<{ message: string; code?: ScanFailureCode | undefined } | null>(null);
  const [viewerMessage, setViewerMessage] = useState('');
  const [placing, setPlacing] = useState('');
  const [focus, setFocus] = useState<{ position: Point3; viewpoint?: Point3 | null; sequence: number; capture?: boolean } | null>(null);
  const [pendingPin, setPendingPin] = useState<{ concernId: string; position: Point3; image: string | null; suggestion?: string; existing?: string } | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const loadTask = useRef<ReturnType<typeof createScanLoadTask> | null>(null);
  const [retryLocal, setRetryLocal] = useState<LocalDemoScan | null>(null);
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
        const restored = result.document ? reconcileScanSuggestionPins(upgradeScanDocument(result.document)) : null;
        current.current = restored;
        canSave.current = result.document !== null;
        setDocument(restored);
        setStorage(result);
        if (result.message.includes('dropped')) setLoadNotice(result.message);
        setBusy(false);
      });
    }
    return () => { cancelled = true; alive.current = false; importSequence.current++; loadTask.current?.dispose(); };
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

  useEffect(() => { if (pendingPin) previewHeading.current?.focus(); }, [pendingPin]);
  const pendingSuggestion = document?.suggestions?.data.items.find((item) => suggestionId(item) === pendingPin?.suggestion);

  function persist(next: ScanDocumentV2) {
    const sequence = ++saveSequence.current;
    setStorage({ ok: true, message: t("legacy.scanpanel.6") });
    void saveScan(getScanStore(), next, concernIds, suggestionCatalog).then((result) => {
      if (alive.current && sequence === saveSequence.current) setStorage(result);
    });
  }
  function change(next: ScanDocumentV2) {
    if (!canDisplay(next)) return;
    current.current = next;
    setDocument(next);
    needsSave.current = true;
    if (canSave.current) { persist(next); needsSave.current = false; }
  }
  function openDocument(next: ScanDocumentV2, origin: ScanSourceOrigin = 'user') {
    if (!canDisplay(next)) { loadTask.current?.finish(); setBusy(false); return; }
    setSourceOrigin(origin);
    ready.current = false;
    canSave.current = false;
    setPendingPin(null);
    needsSave.current = true;
    current.current = next;
    setDocument(next);
    setViewerVersion((version) => version + 1);
    setFocus(null);
    setPlacing('');
    setError(null);
    setLoadNotice('');
    setViewerMessage(t("legacy.scanpanel.7"));
    setStorage({ ok: true, message: t("legacy.scanpanel.8") });
    setOpen(true);
  }
  async function importFiles(files: readonly File[]) {
    if (busy || files.length === 0) return;
    const task = startLoad(), sequence = importSequence.current;
    setRetryLocal(null);
    const result = await importScanSelection(files, suggestionCatalog);
    if (!alive.current || !task.isCurrent() || sequence !== importSequence.current) return;
    if (!result.ok) { task.finish(); setError({ message: result.error, code: result.code }); setBusy(false); return; }
    openDocument(result.value);
  }
  function canDisplay(next: ScanDocumentV2): boolean {
    if (!next.suggestions) return true;
    const scene = validateSuggestionScene(next.suggestions.data, next.asset);
    if (scene.ok) return true;
    setError({ message: scene.error, code: scene.code }); return false;
  }
  function useAsset(asset: ScanAsset) { openDocument({ version: 2, asset, flipUpright: false, pins: [], suggestions: null }); }
  function startLoad() {
    loadTask.current?.dispose();
    importSequence.current++;
    ready.current = false;
    setOpen(false); setBusy(true); setError(null); setPendingPin(null);
    const task = createScanLoadTask((reason) => {
      importSequence.current++; ready.current = false;
      setBusy(false); setOpen(false); setPlacing(''); setViewerMessage('');
      setError({ message: t(reason === 'timeout' ? 'scanViewer.timeout' : 'scanViewer.cancelled') });
    });
    loadTask.current = task;
    return task;
  }
  async function loadLocal(entry: LocalDemoScan) {
    if (busy) return;
    const task = startLoad(), sequence = importSequence.current;
    setRetryLocal(entry);
    const result = await loadLocalDemoScan(entry, suggestionCatalog, fetch, task.signal);
    if (!alive.current || !task.isCurrent() || sequence !== importSequence.current) return;
    if (!result.ok) { task.finish(); setError({ message: result.failure ? t(result.failure === 'timeout' ? 'scanViewer.timeout' : 'scanViewer.cancelled') : result.error, code: result.code }); setBusy(false); return; }
    openDocument(result.value, 'local');
  }
  async function sample() {
    if (busy || current.current) return;
    const task = startLoad(), sequence = importSequence.current;
    setRetryLocal(null);
    try {
      const { generateSampleRoom } = await import('../lib/scan-sample');
      if (alive.current && task.isCurrent() && sequence === importSequence.current) useAsset(generateSampleRoom());
    } catch {
      if (alive.current && task.isCurrent() && sequence === importSequence.current) { task.finish(); setError({ message: t("legacy.scanpanel.9") }); setBusy(false); }
    }
  }
  function place(position: Point3, image: string | null) {
    const latest = current.current;
    if (!latest || !placing || !concernIds.has(placing)) return;
    if (latest.pins.length >= MAX_SCAN_PINS) { setError({ message: t("legacy.scanpanel.10", { v0: MAX_SCAN_PINS }) }); return; }
    setPendingPin({ concernId: placing, position, image });
    setPlacing(''); setError(null);
  }
  function savePendingPin() {
    const latest = current.current, draft = pendingPin;
    if (!latest || !draft) return;
    const id = `pin-${crypto.randomUUID()}`, at = new Date().toISOString();
    if (draft.existing) change({ ...latest, pins: latest.pins.map((pin) => pin.id === draft.existing ? { ...pin, image: draft.image } : pin) });
    else if (draft.suggestion) {
      const result = pinScanSuggestion(latest, draft.suggestion, id, at, draft.image);
      if (!result.ok) { setError({ message: result.error, code: result.code }); return; }
      change(result.value);
    } else {
      if (latest.pins.length >= MAX_SCAN_PINS) { setError({ message: t('legacy.scanpanel.10', { v0: MAX_SCAN_PINS }) }); return; }
      change({ ...latest, pins: [...latest.pins, { id, concernId: draft.concernId, position: draft.position, createdAt: at, origin: 'family', image: draft.image }] });
    }
    setPendingPin(null); setError(null); setViewerMessage(t(draft.suggestion ? 'legacy.scanpanel.12' : 'scanViewer.pinSaved'));
  }
  function showSuggestion(item: ScanSuggestion) {
    const position = item.position;
    if (position) setFocus((previous) => ({ position, viewpoint: item.viewpoint, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  function pinSuggestion(item: ScanSuggestion) {
    if (!current.current) return;
    if (!item.position) return;
    setPendingPin({ concernId: item.concernId, position: item.position, image: null, suggestion: suggestionId(item) });
    setFocus((previous) => ({ position: item.position!, viewpoint: item.viewpoint, sequence: (previous?.sequence ?? 0) + 1, capture: true }));
  }

  const source = document ? scanSourceKind(document.asset.kind, verifiedSceneHash(document.asset.blob), sourceOrigin) : null;
  return (
    <section className="scan-panel screen-only" aria-labelledby="scan-heading">
      <h3 id="scan-heading">{t('legacy.scanpanel.14')}</h3>
      <div className="scan-stage">
        {document && open ? <>
          <ViewerBoundary key={viewerVersion} onFail={() => { loadTask.current?.finish(); setBusy(false); ready.current = false; }}><Suspense fallback={<p role="status">{t("legacy.scanpanel.35")}</p>}>
            <ScanViewer asset={document.asset} flipUpright={document.flipUpright} pins={document.pins} suggestions={visibleSuggestionMarkers(document.suggestions)} expectedSuggestionCount={document.suggestions?.data.scan.splatCount ?? null} concerns={concerns} placing={Boolean(placing)} focus={focus} onPlace={place} onCapture={(image) => setPendingPin((draft) => draft ? { ...draft, image } : null)}
              onReady={(count) => {
                if (!alive.current || !loadTask.current?.isCurrent()) return;
                loadTask.current.finish();
                ready.current = true;
                canSave.current = true;
                setBusy(false);
                setError(null);
                setViewerMessage(t('scan.loaded', { count: count.toLocaleString(localeFor(language)), notice: document.asset.kind === 'generated' ? t("legacy.scanpanel.36") : t("legacy.scanpanel.37") }));
                if (needsSave.current && current.current) { persist(current.current); needsSave.current = false; }
              }}
              onError={(message) => { loadTask.current?.finish(); ready.current = false; setBusy(false); setError({ message }); setViewerMessage(''); }} />
          </Suspense></ViewerBoundary>
        </> : <div className="scan-view-placeholder">
          <p>{t(document ? 'scan.savedView' : 'scan.emptyView')}</p>
          {document ? <button disabled={busy} onClick={() => { startLoad(); setOpen(true); }}>{t('legacy.scanpanel.24')}</button> : <>
            {localScans.map((entry) => <button key={entry.name} disabled={busy} onClick={() => void loadLocal(entry)}>{t(entry.name === 'viennese-v2' ? 'scan.openSample' : 'scan.openLocal')}</button>)}
            <button className="secondary" disabled={busy} onClick={() => void sample()}>{t('legacy.scanpanel.23')}</button>
          </>}
          {busy ? <p role="status">{t('scanViewer.loading')}</p> : null}
        </div>}
      </div>
      {busy && loadTask.current?.isCurrent() ? <div className="button-row"><p role="status">{t('scanViewer.loading')}</p><button className="secondary" onClick={() => loadTask.current?.cancel()}>{t('scanViewer.cancel')}</button></div> : null}
      {!busy && error && retryLocal ? <button className="secondary" onClick={() => void loadLocal(retryLocal)}>{t('scanViewer.retry')}</button> : null}
      {error ? <p role="alert" className="error-message">{scanFailureMessage(t, error)}</p> : null}
      {loadNotice ? <p className="notice" role="status">{scanMessage(t, loadNotice)}</p> : null}
      {!storage.ok ? <p role="status" className="scan-storage" data-healthy="false">{scanFailureMessage(t, storage)}</p> : null}
      {source ? <ScanSourceNote source={source} /> : null}
      {document && open ? <details className="scan-pin-tools scan-suggestion-details"><summary>{t('scan.pinConcern')}</summary>
        <label htmlFor="scan-concern">{t('legacy.scanpanel.32')}</label>
        <select id="scan-concern" value={placing} disabled={busy || document.pins.length >= MAX_SCAN_PINS} onChange={(event) => setPlacing(event.target.value)}>
          <option value="">{t('legacy.scanpanel.33')}</option>{concerns.map((concern) => <option key={concern.id} value={concern.id}>{concern.label}</option>)}
        </select><p className="small-text">{t('legacy.scanpanel.15')}</p>
      </details> : null}
      {pendingPin ? <section className="card" aria-labelledby="scan-image-preview"><h4 id="scan-image-preview" ref={previewHeading} tabIndex={-1}>{t('scanViewer.previewTitle')}</h4><p>{t('scanViewer.previewHelp')}</p>{pendingSuggestion ? <p>{t('scanViewer.modelNote')} {projectedCatalogText(t, suggestionCatalog.get(pendingSuggestion.checklistItemId)?.question ?? pendingSuggestion.question)}</p> : null}{pendingPin.image ? <img className="scan-suggestion-thumbnail" src={pendingPin.image} width="320" alt={t('scanViewer.previewAlt')} /> : <p>{t('scanViewer.noImage')}</p>}<div className="button-row"><button onClick={savePendingPin}>{t(pendingPin.image ? 'scanViewer.savePin' : 'scanViewer.saveNote')}</button><button className="secondary" onClick={() => setPendingPin(null)}>{t('scanViewer.discard')}</button></div></section> : null}
      {document?.suggestions ? <ScanSuggestions asset={document.asset} layer={document.suggestions} catalog={suggestionCatalog} viewerReady={open && !busy && ready.current} canAddPin={document.pins.length < MAX_SCAN_PINS}
        onShow={showSuggestion} onPin={pinSuggestion} onDismiss={(item, dismissed) => { if (current.current) change(dismissScanSuggestion(current.current, suggestionId(item), dismissed)); }} /> : null}
      {document ? <details className="scan-pins scan-suggestion-details"><summary>{t('scan.pins')} ({document.pins.length})</summary><p className="small-text">{t('legacy.scanpanel.39')}</p>
        {document.pins.length === 0 ? <p className="small-text">{t("legacy.scanpanel.40")}</p> : <ol className="scan-pin-list">{document.pins.map((pin, index) => {
          const concern = concerns.find((entry) => entry.id === pin.concernId);
          return <li key={pin.id} data-confirmed={concern?.confirmed === true}>
            <span className="scan-pin-number" aria-hidden="true">{index + 1}</span>
            <div><strong>{concern?.label}</strong><p className="small-text">{concern?.confirmed ? t("legacy.scanpanel.41") : t("legacy.scanpanel.42")} · {pin.origin === 'ai-suggestion' ? t("legacy.scanpanel.43") : t("legacy.scanpanel.44")}</p>
              {isAnnotatedScanImage(pin.image) ? <details><summary>{t('scanViewer.savedPreview')}</summary><img className="scan-suggestion-thumbnail" src={pin.image!} width="320" alt={t('scanViewer.previewAlt')} /></details> : <p className="small-text">{t(pin.image ? 'scanViewer.legacyImage' : 'scanViewer.pinNoImage')}</p>}
              <div className="button-row">
                <button className="secondary compact" disabled={!open || busy || !ready.current} onClick={() => { setPendingPin({ concernId: pin.concernId, position: pin.position, image: null, existing: pin.id }); setFocus((previous) => ({ position: pin.position, sequence: (previous?.sequence ?? 0) + 1, capture: true })); }}>{t('scanViewer.refreshImage')}</button>
                <button className="secondary compact" disabled={!open || busy || !ready.current} onClick={() => setFocus((previous) => ({ position: pin.position, sequence: (previous?.sequence ?? 0) + 1 }))} aria-label={t("legacy.scanpanel.45", { v0: index + 1, v1: concern?.label })}>{t("legacy.scanpanel.46")}{index + 1}</button>
                <ScanPinQuestions scenario={scenario} concernId={pin.concernId} />
                <button className="secondary compact" aria-label={t("legacy.scanpanel.48", { v0: index + 1, v1: concern?.label })} onClick={() => { if (current.current) change(removeScanPin(current.current, pin.id)); if (pendingPin?.existing === pin.id) setPendingPin(null); }}>{t("legacy.scanpanel.49")}</button>
              </div>
            </div>
          </li>;
        })}</ol>}
      </details> : null}
      <details className="scan-import-details scan-suggestion-details"><summary>{t('scan.importOwn')}</summary>
        <p className="small-text">{t('legacy.scanpanel.16')}</p>
        <div className="scan-import" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer.files)); }}>
          <p id="scan-file-description">{t('legacy.scanpanel.17')}</p><button className="secondary" disabled={busy} onClick={() => importInput.current?.click()}>{t('scan.importOwn')}</button>
          <input id="scan-file" ref={importInput} hidden type="file" multiple aria-label={t('scan.importOwn')} aria-describedby="scan-file-description" accept={relaxAccept ? undefined : '.splat,.ply,.json'} disabled={busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />
          <p className="small-text">{t('legacy.scanpanel.18')}</p>
        </div>
      </details>
      <details className="scan-details scan-suggestion-details"><summary>{t('scan.details')}</summary>
        <p className="small-text">{t('legacy.scanpanel.15')}</p>
        {storage.ok ? <p role="status" aria-live="polite" className="small-text scan-storage" data-healthy="true">{scanMessage(t, storage.message)}</p> : null}
        {document ? <><p className="scan-caption">{document.asset.name} · {(document.asset.blob.size / (1024 * 1024)).toFixed(1)}{t('legacy.scanpanel.28')}{document.asset.metadata ? t('legacy.scanpanel.29') : t('legacy.scanpanel.30')}</p>
          <p className="small-text" role="status">{viewerMessage}</p>
          <p className="small-text">{t('scan.pinCount', { count: document.pins.length, limit: MAX_SCAN_PINS })}</p>
          <label className="scan-flip"><input type="checkbox" checked={document.flipUpright} onChange={(event) => change({ ...document, flipUpright: event.target.checked })} />{t('legacy.scanpanel.31')}</label>
          {source === 'sample' ? <SampleApartmentCredit /> : null}
          {open ? <button className="secondary" onClick={() => { loadTask.current?.dispose(); ready.current = false; setOpen(false); setBusy(false); setPlacing(''); setPendingPin(null); }}>{t('legacy.scanpanel.25')}</button> : null}
        </> : null}
        {document && localScans.length ? <div className="scan-local-demos"><p className="small-text">{t('legacy.scanpanel.20')}</p>{localScans.map((entry) => <button className="secondary" key={entry.name} disabled={busy} onClick={() => void loadLocal(entry)}>{t(entry.name === 'viennese-v2' ? 'scan.openSample' : 'scan.openLocal')}</button>)}</div> : null}
      </details>
    </section>
  );
}
