import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { DemoScenario } from '../domain/types';
import { hasScope, type ChecklistAnswer, type DemoState, type Person } from '../domain/workflow';
import { useLanguage, useT, localeFor, translate, type MessageKey, type Translator } from '../i18n';
import { catalogText } from '../i18n/catalog';
import { buildCaptureBundle } from '../lib/capture-bundle';
import { CaptureError, newCaptureId, sha256Blob, validateCaptureManifest } from '../lib/capture-model';
import { getCaptureStore, type StoredCapture } from '../lib/capture-storage';
import { MAX_CAPTURE_FLAGS_BYTES, parseCaptureSuggestions } from '../lib/capture-suggestions';
import type { CaptureManifest, CapturePhoto, CaptureSuggestionItem } from '../lib/capture-types';
import { captureAvailability, runNativeCapture, shareText, type CapturePrompt } from '../lib/native-capture';
import { reencodePhoto } from '../lib/photo-storage';
import { trustedPhotoQuestions } from '../lib/scan-suggestions';
import { PhotoInputActions } from './Photos';
import { RoomSketch } from './RoomSketch';
import { CaptureVideos } from './CaptureVideos';
import { roomFlags } from './capture-summary';
import { Icon, ScreenLink, type Navigate } from './PhoneShell';
import { SegmentedControl, Sheet, StatusPill, SecondaryButton, IconTile } from './UI';
import { createFlagCheckSession, initialFlagCheckState, type FlagCheckState } from './flag-check-state';
import { displayAnswer } from './checklist-presentation';
import type { Dispatch } from './ui-controller';
import '../styles/capture.css';

interface CaptureScreenProps { scenario: DemoScenario; state: DemoState; person: Person; dispatch: Dispatch; navigate: Navigate; roomId: string; canContinue?(): boolean }
export function canUseCaptures(state: DemoState, person: Person): boolean { return person.role !== 'volunteer' && hasScope(state, person.id, 'checklist'); }
export function capturePrompts(scenario: DemoScenario, roomId: string, t: Translator): CapturePrompt[] {
  return [{ checklistItemId: null, text: t('capture.overview') }, ...trustedPhotoQuestions.filter((q) => scenario.checklist.some((c) => c.id === q.checklistItemId && c.roomId === roomId))
    .map((q) => ({ checklistItemId: q.checklistItemId, text: t(`capture.prompt.${q.checklistItemId}` as MessageKey) }))];
}
function errorText(error: unknown, t: Translator): string {
  if (error instanceof CaptureError) {
    if (error.code === 'CANCELLED') return t('capture.changed');
    if (error.code === 'CAPTURE_MISMATCH') return t(error.message === translate('en', 'room.mismatch') ? 'room.mismatch' : 'capture.changed');
  }
  return error instanceof Error ? error.message : t('capture.error');
}
/** Bind each asynchronous action to its starting actor, saved revision and mounted screen. */
function useCaptureOperation(dispatch: Dispatch, canContinue?: () => boolean) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return { alive, start: () => {
    const revision = dispatch.capture?.();
    return () => alive.current && (revision?.() ?? true) && (canContinue?.() ?? true);
  } };
}
function requireCurrent(current: () => boolean, t: Translator) { if (!current()) throw new CaptureError('CANCELLED', t('capture.changed')); }
function CaptureDenied() { const t = useT(); return <p className="notice">{t('person.noGrant')}</p>; }
function Confirmation({ text, confirm, onConfirm, onCancel }: { text: string; confirm: string; onConfirm(): void; onCancel(): void }) {
  const t = useT();
  return <Sheet title={t('capture.title')} onClose={onCancel}><p>{text}</p><div className="stack"><button className="secondary" onClick={onCancel}>{t('capture.cancel')}</button><button onClick={onConfirm}>{confirm}</button></div></Sheet>;
}
function usePhotoUrls(photos: ReadonlyMap<string, Blob> | undefined): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    photos?.forEach((blob, id) => next.set(id, URL.createObjectURL(blob))); setUrls(next);
    return () => { next.forEach((url) => URL.revokeObjectURL(url)); };
  }, [photos]);
  return urls;
}
export function RoomPage(props: CaptureScreenProps) { return canUseCaptures(props.state, props.person) ? <AuthorizedRoomPage {...props} /> : <CaptureDenied />; }
function AuthorizedRoomPage(props: CaptureScreenProps) {
  const { roomId, navigate, dispatch, canContinue } = props;
  const t = useT(), language = useLanguage(), [store] = useState(getCaptureStore), [record, setRecord] = useState<StoredCapture | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState<'delete' | 'export' | null>(null);
  const [arAvailable, setArAvailable] = useState<boolean | null>(null);
  useEffect(() => { let active = true; void captureAvailability().then((value) => { if (active) setArAvailable(value.arkit); }).catch(() => { if (active) setArAvailable(false); }); return () => { active = false; }; }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null), [mode, setMode] = useState<'plan' | '3d'>('plan');
  const { alive, start } = useCaptureOperation(dispatch, canContinue), busyRef = useRef(false), urls = usePhotoUrls(record?.photos);
  const checkPending = useRef(false);
  const [flagCheck, setFlagCheck] = useState(initialFlagCheckState), flagSession = useRef<ReturnType<typeof createFlagCheckSession> | null>(null);
  useEffect(() => {
    alive.current = true; let active = true; const current = start();
    const session = createFlagCheckSession({ roomId, readRecord: () => store.read(roomId), captureCurrent: start, canStart: () => !busyRef.current, onState: (next) => { checkPending.current = next.checking; setFlagCheck(next); }, onRecord: (saved) => { setRecord(saved); setSelectedId(null); } });
    flagSession.current = session;
    void store.read(roomId).then((saved) => {
      if (!active) return;
      requireCurrent(current, t); setRecord(saved); setLoading(false);
      void session.load(saved);
    }).catch((failure) => { if (active) { setError(errorText(failure, t)); setLoading(false); } });
    return () => { active = false; alive.current = false; session.dispose(); if (flagSession.current === session) flagSession.current = null; };
  }, [roomId, store]);
  async function operation(fn: (current: () => boolean) => Promise<void>) { if (busyRef.current || checkPending.current) return; const current = start(); busyRef.current = true; setBusy(true); setError(''); setNotice(''); try { requireCurrent(current, t); await fn(current); } catch (e) { if (alive.current) setError(errorText(e, t)); } finally { busyRef.current = false; if (alive.current) setBusy(false); } }
  async function importFlags(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !record) return;
    await operation(async (current) => {
      if (file.size > MAX_CAPTURE_FLAGS_BYTES) throw new CaptureError('CAPACITY', t('capture.flagsTooLarge'));
      const parsed = parseCaptureSuggestions(await file.text(), record.manifest);
      if (!parsed.ok) throw new CaptureError(parsed.code, parsed.error);
      requireCurrent(current, t);
      await store.writeFlags(roomId, parsed.value, current);
      if (current()) { setRecord({ ...record, flags: parsed.value }); setSelectedId(null); setNotice(t('room.imported')); }
    });
  }
  const flagsInput = useRef<HTMLInputElement>(null);
  return <div className="stack capture-screen">{error ? <p role="alert" className="error-message">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {loading ? <p role="status">{t('common.loading')}</p> : !record ? <>
      <RoomScanIntro roomName={catalogText(t, 'room', roomId)} arAvailable={arAvailable} disabled={busy || !!error} onStart={() => navigate({ role: 'r', screen: 'capture', id: roomId })} />
      <details className="card"><summary>{t('room.withoutScan')}</summary><InlineRoomQuestions {...props} /></details>
    </> : <>
      <p className="footnote">{t('room.saved', { date: new Date(record.manifest.createdAt).toLocaleDateString(localeFor(language)), photos: t(record.manifest.photos.length === 1 ? 'capture.photoOne' : 'capture.photoMany', { count: record.manifest.photos.length }) })}</p>
      <FlagCheckStatus state={flagCheck} onCheck={() => flagSession.current?.check(record)} />
      <RoomCaptureContent {...props} decisionsDisabled={flagCheck.checking} record={record} photoUrls={urls} selectedId={selectedId} onSelect={setSelectedId} mode={mode} onMode={setMode} navigate={navigate} />
      <InlineRoomQuestions {...props} disabled={flagCheck.checking} />
      <div className="button-row"><SecondaryButton disabled={busy || flagCheck.checking} onClick={() => navigate({ role: 'r', screen: 'capture', id: roomId })}><Icon name="scan" />{t('room.replace')}</SecondaryButton><button className="plain danger" disabled={busy || flagCheck.checking} onClick={() => setConfirmation('delete')}><Icon name="trash" />{t('room.delete')}</button></div>
      <details className="card advanced-review"><summary>{t('room.advanced')}</summary><p className="footnote">{t('room.exportPrivacy')}</p><div className="stack"><button className="secondary" disabled={busy || flagCheck.checking} onClick={() => setConfirmation('export')}>{t('room.export')}</button><button className="secondary" disabled={busy || flagCheck.checking} onClick={() => flagsInput.current?.click()}>{t('room.import')}</button><input ref={flagsInput} hidden type="file" accept=".json,application/json" aria-label={t('room.import')} disabled={busy || flagCheck.checking} onChange={(event) => void importFlags(event)} /></div></details>
      {confirmation ? <Confirmation text={t(confirmation === 'delete' ? 'room.deleteConfirm' : 'room.exportPrivacy')} confirm={t(confirmation === 'delete' ? 'room.delete' : 'room.send')} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); void operation(async (current) => {
        if (action === 'delete') { await store.remove(roomId, record.manifest.captureId, current); if (current()) { setRecord(null); setSelectedId(null); setNotice(t('room.deleted')); } }
        else { const bundle = await buildCaptureBundle(record.manifest, record.photos); requireCurrent(current, t); const result = await shareText(bundle.fileName, bundle.text); if (current() && result.completed) setNotice(t('room.exported')); }
      }); }} /> : null}
    </>}
  </div>;
}
export function FlagCheckStatus({ state, onCheck }: { state: FlagCheckState; onCheck(): void }) {
  const t = useT();
  if (state.checking) return <section className="card flag-check-progress" role="status" aria-live="polite"><span className="flag-check-spinner" aria-hidden="true" /><p>{t('room.checkingPhotos')}</p></section>;
  if (state.available === false) return <p className="muted flag-check-unavailable">{t('room.checkUnavailable')}</p>;
  return <>{state.failed ? <p className="muted" role="alert">{t('room.checkFailed')}</p> : null}{state.available || state.failed ? <SecondaryButton onClick={onCheck}>{t('room.checkAgain')}</SecondaryButton> : null}</>;
}
export function RoomScanIntro({ roomName, arAvailable, disabled = false, onStart }: { roomName: string; arAvailable: boolean | null; disabled?: boolean; onStart(): void }) {
  const t = useT();
  return <section className="scan-intro"><div className="scan-intro-heading"><IconTile name="scan" /><div><p className="eyebrow">{roomName}</p><h2>{t('room.scanTitle')}</h2></div></div><ol className="scan-tips">{(['floor', 'corners', 'photos'] as const).map((tip, index) => <li key={tip}><span className="tip-number">{index + 1}</span><span>{t(tip === 'corners' && arAvailable === false ? 'room.tip.photoFallback' : `room.tip.${tip}`)}</span></li>)}</ol><button className="full" disabled={disabled || arAvailable === null} onClick={onStart}>{t(arAvailable ? 'room.start' : 'room.startPhotos')}<Icon name="arrow" /></button><div className="scan-intro-notes">{arAvailable === false ? <p className="footnote">{t('room.noAR')}</p> : null}<p className="footnote">{t('room.phonePrivacy')}</p></div></section>;
}
export function InlineRoomQuestions({ scenario, state, person, roomId, dispatch, navigate, canContinue, disabled = false }: CaptureScreenProps & { disabled?: boolean }) {
  const t = useT(), [busy, setBusy] = useState(false), pending = useRef(false);
  const { alive, start } = useCaptureOperation(dispatch, () => state.activePersonId === person.id && canUseCaptures(state, person) && (canContinue?.() ?? true));
  async function answer(id: string, value: ChecklistAnswer) {
    if (disabled || pending.current || !start()()) return; pending.current = true; setBusy(true);
    try { await dispatch({ type: 'answer_checklist', checklistItemId: id, answer: value, position: scenario.checklist.findIndex((item) => item.id === id) }); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="room-questions stack"><h2>{t('room.questions')}</h2><p className="footnote">{t('check.confirmHelp')}</p>{scenario.checklist.filter((item) => item.roomId === roomId).map((item) => {
    const value = displayAnswer(state, item.id);
    return <article className="card inline-question" key={item.id}><h3>{catalogText(t, 'check', item.id)}</h3><SegmentedControl label={catalogText(t, 'check', item.id)} value={value === 'unanswered' ? null : value} disabled={busy || disabled} options={(['yes', 'no', 'unknown'] as const).map((value) => ({ value, label: t(`check.${value}`) }))} onChange={(value) => answer(item.id, value)} /><ScreenLink title={t('room.questionDetails')} route={{ role: 'r', screen: 'question', id: item.id }} navigate={navigate} /></article>;
  })}</section>;
}
export function RoomCaptureContent({ scenario, record, photoUrls, selectedId, onSelect, mode, onMode, navigate, state, person, dispatch, canContinue, decisionsDisabled = false }: Omit<CaptureScreenProps, 'roomId'> & { decisionsDisabled?: boolean; record: StoredCapture; photoUrls: ReadonlyMap<string, string>; selectedId: string | null; onSelect(id: string): void; mode: 'plan' | '3d'; onMode(mode: 'plan' | '3d'): void; navigate: Navigate }) {
  const t = useT(), language = useLanguage(), capture = record.manifest;
  const flags = roomFlags(record.flags, scenario.checklist, capture.roomId);
  const helper = state.people.find((p) => p.role === 'family_helper');
  const { alive, start } = useCaptureOperation(dispatch, () => state.activePersonId === person.id && canUseCaptures(state, person) && (canContinue?.() ?? true));
  const [decisionBusy, setDecisionBusy] = useState(false), decisionPending = useRef(false);
  function review(id: string) { if (!decisionsDisabled && start()()) navigate({ role: 'r', screen: 'question', id }); }
  async function notProblem(id: string) {
    if (decisionsDisabled || decisionPending.current || !start()()) return;
    decisionPending.current = true; setDecisionBusy(true);
    try { await dispatch({ type: 'answer_checklist', checklistItemId: id, answer: 'no' }); }
    finally { decisionPending.current = false; if (alive.current) setDecisionBusy(false); }
  }
  const sketchFlags = flags.map((f) => ({ id: f.checklistItemId, checklistItemId: f.checklistItemId, photoId: f.bestPhotoId!, point: f.point, label: f.question }));
  return <><CaptureVideos record={record} ownerKey={person.id} /><section className="card sketch-hero">{capture.outline?.closed ? <SegmentedControl label={t('room.view')} value={mode} options={[{ value: 'plan', label: t('room.plan') }, { value: '3d', label: t('room.threeD') }]} onChange={onMode} /> : null}<RoomSketch capture={capture} photoUrls={photoUrls} flags={sketchFlags} selectedId={selectedId} onSelect={onSelect} mode={mode} /></section>
    <section className="stack spots-section"><h2>{t('room.flags')}</h2>{!flags.length && !decisionsDisabled ? <p className="muted">{t(record.flags ? 'room.flagsEmpty' : 'room.flagsNotChecked')}</p> : null}{flags.map((flag) => <article className="card capture-flag" key={flag.checklistItemId} data-selected={selectedId === flag.checklistItemId}>
      <button className="capture-flag-select" aria-pressed={selectedId === flag.checklistItemId} onClick={() => onSelect(flag.checklistItemId)}>{photoUrls.get(flag.bestPhotoId ?? '') ? <div className="flag-photo"><img src={photoUrls.get(flag.bestPhotoId ?? '')} alt={t('room.photo', { number: capture.photos.findIndex((photo) => photo.photoId === flag.bestPhotoId) + 1 })} /><span className="flag-photo-marker"><Icon name="flag" /></span></div> : <span className="flag-placeholder"><Icon name="flag" /></span>}<h3>{spotTitle(t, flag.checklistItemId)}</h3></button>
      <StatusPill tone="amber">{t('room.aiLabel')}</StatusPill><p className="muted" lang="en">{flag.limitation}</p>
      <details className="flag-details"><summary>{t('room.whatAI')}</summary><p lang="en">{flag.question}</p>{language !== 'en' ? <p className="footnote">{t('room.original')}</p> : null}<p className="footnote">{captureScoreText(flag, record.flags!, t)}</p><p className="footnote">{t('room.reviewNotice')}</p><p className="footnote">{t(record.flags!.model.backend === 'coreml' ? 'room.modelLicenseOnDevice' : 'room.modelLicense')}</p></details>
      <p className="muted" data-checklist-answer={displayAnswer(state, flag.checklistItemId)}>{t('room.related')}: {t(`check.${displayAnswer(state, flag.checklistItemId)}`)}{state.confirmations[flag.concernId]?.humanConfirmed ? ` · ${t('check.confirmed')}` : ''}</p>
      <p className="footnote">{t(person.role === 'resident' || hasScope(state, person.id, 'confirm') ? 'room.addSteps' : 'room.proposeSteps')}</p>
      <div className="button-row capture-decisions"><button disabled={decisionBusy || decisionsDisabled} onClick={() => review(flag.checklistItemId)}>{t(person.role === 'resident' ? 'room.add' : 'room.propose')}</button><button className="secondary" disabled={decisionBusy || decisionsDisabled} onClick={() => notProblem(flag.checklistItemId)}>{t('room.notProblem')}</button></div>
      {person.role === 'resident' && helper ? <details className="helper-handoff"><summary>{t('room.helperOptions')}</summary><p className="footnote">{t('room.localHandoff', { name: helper.name })}</p><button className="plain" disabled={decisionBusy || decisionsDisabled} onClick={() => { if (start()()) navigate({ screen: 'people' }); }}>{t('room.askHelper', { name: helper.name })}</button></details> : null}
      <ScreenLink title={t('room.related')} route={{ role: 'r', screen: 'question', id: flag.checklistItemId }} navigate={navigate} />
    </article>)}</section></>;
}
function spotTitle(t: Translator, checklistId: string): string {
  const keys: Record<string, MessageKey> = { 'rug-check': 'room.spot.rug-check', 'cord-check': 'room.spot.cord-check', 'stair-clutter-check': 'room.spot.stair-clutter-check', 'handrail-check': 'room.spot.handrail-check', 'stair-lighting-check': 'room.spot.stair-lighting-check', 'night-lighting-check': 'room.spot.night-lighting-check', 'shower-surface-check': 'room.spot.shower-surface-check', 'bathroom-support-check': 'room.spot.bathroom-support-check' };
  const key = keys[checklistId]; return key ? t(key) : catalogText(t, 'check', checklistId);
}
function captureScoreText(flag: CaptureSuggestionItem, file: NonNullable<StoredCapture['flags']>, t: Translator): string {
  return t(file.calibration ? 'room.scoreCalibrated' : 'room.scoreRaw', { score: typeof flag.score === 'number' && Number.isFinite(flag.score) ? flag.score.toFixed(2) : '—', count: file.calibration?.trainExamples as number | undefined });
}
export function CaptureFlow(props: CaptureScreenProps) { return canUseCaptures(props.state, props.person) ? <AuthorizedCaptureFlow {...props} /> : <CaptureDenied />; }
function AuthorizedCaptureFlow({ scenario, roomId, person, navigate, dispatch, canContinue }: CaptureScreenProps) {
  const t = useT(), language = useLanguage(), [store] = useState(getCaptureStore), [phase, setPhase] = useState<'loading' | 'replace' | 'native' | 'photos' | 'denied' | 'failed' | 'cleanup'>('loading'), [reason, setReason] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false), [captureId] = useState(newCaptureId);
  const { alive, start } = useCaptureOperation(dispatch, canContinue);
  const tourCurrent = useRef<(() => boolean) | null>(null), previousCaptureId = useRef<string | null>(null);
  const pendingNative = useRef<AbortController | null>(null), operationEpoch = useRef(0);
  const prompts = capturePrompts(scenario, roomId, t);
  const returnToRoom = () => navigate({ role: 'r', screen: 'room', id: roomId });
  async function begin(replace: boolean) {
    pendingNative.current?.abort();
    const controller = new AbortController(), epoch = ++operationEpoch.current, authorized = start();
    pendingNative.current = controller;
    const current = () => !controller.signal.aborted && epoch === operationEpoch.current && authorized();
    tourCurrent.current = current;
    setPhase('loading'); setReason('');
    try {
      requireCurrent(current, t);
      const availability = await captureAvailability();
      requireCurrent(current, t);
      if (!availability.arkit) { setPhase('photos'); return; }
      setPhase('native');
      const outcome = await runNativeCapture({ roomId, roomName: catalogText(t, 'room', roomId), language, prompts, replaceConfirmed: replace, expectedCaptureId: previousCaptureId.current, store, isCurrent: current, signal: controller.signal });
      if (!current()) return;
      if (outcome.cleanupFailed) { setPhase('cleanup'); setReason([t(outcome.status === 'completed' ? 'capture.savedCleanupFailed' : 'capture.cleanupFailed'), outcome.reason].filter(Boolean).join(' ')); }
      else if (outcome.status === 'completed' || outcome.status === 'cancelled') returnToRoom();
      else { setPhase(outcome.status === 'denied' ? 'denied' : outcome.status === 'unavailable' ? 'photos' : 'failed'); setReason(outcome.reason ?? ''); }
    } catch (error) { if (current()) { setPhase('failed'); setReason(errorText(error, t)); } }
  }
  useEffect(() => {
    alive.current = true; let active = true;
    void store.read(roomId).then((r) => { if (active) { previousCaptureId.current = r?.manifest.captureId ?? null; if (r) setPhase('replace'); else void begin(false); } }).catch((e) => { if (active) { setPhase('failed'); setReason(errorText(e, t)); } });
    return () => { active = false; alive.current = false; operationEpoch.current++; pendingNative.current?.abort(); pendingNative.current = null; tourCurrent.current = null; };
  }, [roomId, store, person.id]);
  if (phase === 'replace') return <Confirmation text={t('room.replaceConfirm')} confirm={t('room.replaceYes')} onConfirm={() => { setReplaceConfirmed(true); void begin(true); }} onCancel={returnToRoom} />;
  return <div className="stack capture-screen"><h2>{catalogText(t, 'room', roomId)}</h2><p className="footnote">{t('capture.privacy')}</p>
    {phase === 'loading' || phase === 'native' ? <p role="status">{t('capture.preparing')}</p> : null}
    {phase === 'cleanup' ? <p role="alert">{reason}</p> : null}
    {phase === 'denied' ? <p className="notice">{t('capture.denied')}</p> : null}
    {phase === 'failed' ? <><p role="alert">{t('capture.failed')} {reason}</p><button onClick={() => void begin(replaceConfirmed)}>{t('capture.retry')}</button><button className="secondary" onClick={() => { tourCurrent.current = start(); setPhase('photos'); }}>{t('capture.photoTour')}</button></> : null}
    {phase === 'photos' || phase === 'denied' ? <GuidedPhotoTour prompts={prompts} onCancel={returnToRoom} onSave={async (photos, blobs) => {
      const manifest: CaptureManifest = { format: 'fixlist-room-capture', version: 1, captureId, roomId, createdAt: new Date().toISOString(), mode: 'photos', floorY: null, outline: null, doors: [], photos };
      const valid = validateCaptureManifest(manifest);
      if (!valid.ok) throw new CaptureError(valid.code, valid.error);
      const current = tourCurrent.current ?? start(); requireCurrent(current, t);
      await store.writeCapture(valid.value, blobs, replaceConfirmed, current, previousCaptureId.current);
      if (current()) returnToRoom();
    }} /> : phase !== 'native' ? <button className="secondary" onClick={returnToRoom}>{t('capture.cancel')}</button> : null}
  </div>;
}
interface DraftPhoto { photo: CapturePhoto; blob: Blob }
export function GuidedPhotoTour({ prompts, onSave, onCancel }: { prompts: readonly CapturePrompt[]; onSave(photos: readonly CapturePhoto[], blobs: ReadonlyMap<string, Blob>): Promise<void>; onCancel(): void }) {
  const t = useT(), [index, setIndex] = useState(0), [drafts, setDrafts] = useState<ReadonlyMap<number, DraftPhoto>>(new Map()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [cancelConfirm, setCancelConfirm] = useState(false);
  const alive = useRef(true), busyRef = useRef(false), photo = drafts.get(index), heading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { heading.current?.focus(); }, [index]);
  useEffect(() => { if (!photo) { setPreview(''); return; } const url = URL.createObjectURL(photo.blob); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function selectPhoto(file: File) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const encoded = await reencodePhoto(file), sha256 = await sha256Blob(encoded.blob);
      if (alive.current) setDrafts((old) => new Map(old).set(index, { blob: encoded.blob, photo: { photoId: `p${String(index + 1).padStart(2, '0')}`, checklistItemId: prompts[index]!.checklistItemId, takenAt: new Date().toISOString(), width: encoded.width, height: encoded.height, sha256, camera: null } }));
    } catch (e) { if (alive.current) setError(errorText(e, t)); } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (busyRef.current || !drafts.size) return;
    busyRef.current = true; setBusy(true); setError('');
    const ordered = [...drafts].sort(([a], [b]) => a - b).map(([, p]) => p);
    try { await onSave(ordered.map((p) => p.photo), new Map(ordered.map((p) => [p.photo.photoId, p.blob]))); }
    catch (e) { if (alive.current) setError(errorText(e, t)); } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="stack"><p>{t('capture.native.photoProgress', { current: Math.min(index + 1, prompts.length), total: prompts.length })}</p><h3 tabIndex={-1} ref={heading}>{prompts[index]?.text ?? t('capture.review')}</h3>
    {error ? <p role="alert" className="error-message">{error}</p> : null}{busy ? <p role="status">{t('capture.processing')}</p> : null}
    {index < prompts.length ? <><PhotoInputActions busy={busy} onPhoto={(file) => void selectPhoto(file)} />
    {preview ? <img className="capture-preview" src={preview} alt={t('room.photo', { number: index + 1 })} /> : null}
    <div className="button-row">{photo ? <><button className="secondary" disabled={busy} onClick={() => setDrafts((old) => { const next = new Map(old); next.delete(index); return next; })}>{t('capture.native.retake')}</button><button disabled={busy} onClick={() => setIndex(index + 1)}>{t('capture.native.next')}</button></> : null}<button className="secondary" disabled={busy} onClick={() => { setDrafts((old) => { const next = new Map(old); next.delete(index); return next; }); setIndex(index + 1); }}>{t('capture.native.skip')}</button></div></> : null}
    <p role="status">{t('capture.savedCount', { photos: t(drafts.size === 1 ? 'capture.photoOne' : 'capture.photoMany', { count: drafts.size }) })}</p>{!drafts.size ? <p>{t('capture.minimum')}</p> : null}
    <div className="button-row">{index > 0 ? <button className="secondary" disabled={busy} onClick={() => setIndex(index - 1)}>{t('capture.back')}</button> : null}<button disabled={busy || !drafts.size} onClick={() => void save()}>{t('capture.native.done')}</button><button className="secondary" disabled={busy} onClick={() => drafts.size ? setCancelConfirm(true) : onCancel()}>{t('capture.cancel')}</button></div>
    {cancelConfirm ? <Confirmation text={t('capture.cancelConfirm')} confirm={t('capture.discard')} onConfirm={onCancel} onCancel={() => setCancelConfirm(false)} /> : null}
  </div>;
}
