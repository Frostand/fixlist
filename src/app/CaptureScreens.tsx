import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { DemoScenario } from '../domain/types';
import { hasScope, type DemoState, type Person } from '../domain/workflow';
import { useLanguage, useT, type MessageKey, type Translator } from '../i18n';
import { catalogText } from '../i18n/catalog';
import { buildCaptureBundle } from '../lib/capture-bundle';
import { CaptureError, newCaptureId, sha256Blob, validateCaptureManifest } from '../lib/capture-model';
import { getCaptureStore, type StoredCapture } from '../lib/capture-storage';
import { displayFlags, MAX_CAPTURE_FLAGS_BYTES, parseCaptureSuggestions } from '../lib/capture-suggestions';
import type { CaptureManifest, CapturePhoto, CaptureSuggestionItem } from '../lib/capture-types';
import { captureAvailability, runNativeCapture, shareText, type CapturePrompt } from '../lib/native-capture';
import { reencodePhoto } from '../lib/photo-storage';
import { trustedPhotoQuestions } from '../lib/scan-suggestions';
import { RoomSketch } from './RoomSketch';
import { ScreenLink, type Navigate } from './PhoneShell';
import '../styles/capture.css';

interface CaptureScreenProps { scenario: DemoScenario; state: DemoState; person: Person; navigate: Navigate; roomId: string }
export function canUseCaptures(state: DemoState, person: Person): boolean { return person.role !== 'volunteer' && hasScope(state, person.id, 'checklist'); }
export function capturePrompts(scenario: DemoScenario, roomId: string, t: Translator): CapturePrompt[] {
  return [{ checklistItemId: null, text: t('capture.overview') }, ...trustedPhotoQuestions.filter((q) => scenario.checklist.some((c) => c.id === q.checklistItemId && c.roomId === roomId))
    .map((q) => ({ checklistItemId: q.checklistItemId, text: t(`capture.prompt.${q.checklistItemId}` as MessageKey) }))];
}
function errorText(error: unknown, t: Translator): string { return error instanceof CaptureError && error.code === 'CAPTURE_MISMATCH' ? t('room.mismatch') : error instanceof Error ? error.message : t('capture.error'); }
function CaptureDenied() { const t = useT(); return <p className="notice">{t('person.noGrant')}</p>; }
function Confirmation({ text, confirm, onConfirm, onCancel }: { text: string; confirm: string; onConfirm(): void; onCancel(): void }) {
  const t = useT(), heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="card capture-confirm"><p tabIndex={-1} ref={heading}>{text}</p><div className="button-row"><button onClick={onConfirm}>{confirm}</button><button className="secondary" onClick={onCancel}>{t('capture.cancel')}</button></div></section>;
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
function AuthorizedRoomPage({ roomId, navigate }: CaptureScreenProps) {
  const t = useT(), language = useLanguage(), [store] = useState(getCaptureStore), [record, setRecord] = useState<StoredCapture | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState<'delete' | 'export' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [mode, setMode] = useState<'plan' | '3d'>('plan');
  const alive = useRef(true), urls = usePhotoUrls(record?.photos);
  useEffect(() => { alive.current = true; let active = true; void store.read(roomId).then((r) => { if (active) { setRecord(r); setLoading(false); } }).catch((e) => { if (active) { setError(errorText(e, t)); setLoading(false); } }); return () => { active = false; alive.current = false; }; }, [roomId, store]);
  async function operation(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { if (alive.current) setError(errorText(e, t)); } finally { if (alive.current) setBusy(false); } }
  async function importFlags(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !record) return;
    await operation(async () => {
      if (file.size > MAX_CAPTURE_FLAGS_BYTES) throw new CaptureError('CAPACITY', t('capture.flagsTooLarge'));
      const parsed = parseCaptureSuggestions(await file.text(), record.manifest);
      if (!parsed.ok) throw new CaptureError(parsed.code, parsed.error);
      if (!alive.current) return;
      await store.writeFlags(roomId, parsed.value);
      if (alive.current) { setRecord({ ...record, flags: parsed.value }); setSelectedId(null); setNotice(t('room.imported')); }
    });
  }
  const capture = record?.manifest;
  return <div className="stack capture-screen"><h2>{catalogText(t, 'room', roomId)}</h2><p>{t('capture.privacy')}</p>{error ? <p role="alert" className="error-message">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {loading ? <p role="status">{t('common.loading')}</p> : <><p>{capture ? t('room.saved', { date: new Date(capture.createdAt).toLocaleDateString(language), count: capture.photos.length }) : t('room.none')}</p>{capture ? <p>{t(capture.outline ? 'room.outline' : 'room.photosOnly')}</p> : null}
    <button disabled={busy || !!error && !record} onClick={() => navigate({ role: 'r', screen: 'capture', id: roomId })}>{t(capture ? 'room.replace' : 'room.start')}</button>
    {record ? <><RoomCaptureContent record={record} photoUrls={urls} selectedId={selectedId} onSelect={setSelectedId} mode={mode} onMode={setMode} navigate={navigate} />
    <section className="card stack"><button disabled={busy} onClick={() => setConfirmation('export')}>{t('room.export')}</button><label className="capture-file">{t('room.import')}<input type="file" accept=".json,application/json" aria-label={t('room.import')} disabled={busy} onChange={(event) => void importFlags(event)} /></label></section>
    <button className="secondary" disabled={busy} onClick={() => setConfirmation('delete')}>{t('room.delete')}</button>
    {confirmation ? <Confirmation text={t(confirmation === 'delete' ? 'room.deleteConfirm' : 'room.exportPrivacy')} confirm={t(confirmation === 'delete' ? 'room.delete' : 'room.send')} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); void operation(async () => {
      if (action === 'delete') { await store.remove(roomId, record.manifest.captureId); if (alive.current) { setRecord(null); setSelectedId(null); setNotice(t('room.deleted')); } }
      else { const bundle = await buildCaptureBundle(record.manifest, record.photos); if (!alive.current) return; const result = await shareText(bundle.fileName, bundle.text); if (alive.current && result.completed) setNotice(t('room.exported')); }
    }); }} /> : null}</> : null}</>}
    <ScreenLink title={t('check.rooms')} route={{ role: 'r', screen: 'check' }} navigate={navigate} />
  </div>;
}
export function RoomCaptureContent({ record, photoUrls, selectedId, onSelect, mode, onMode, navigate }: { record: StoredCapture; photoUrls: ReadonlyMap<string, string>; selectedId: string | null; onSelect(id: string): void; mode: 'plan' | '3d'; onMode(mode: 'plan' | '3d'): void; navigate: Navigate }) {
  const t = useT(), language = useLanguage(), flags = displayFlags(record.flags), capture = record.manifest;
  const sketchFlags = flags.map((f) => ({ id: f.checklistItemId, checklistItemId: f.checklistItemId, photoId: f.bestPhotoId!, point: f.point, label: f.question }));
  return <><section className="stack"><p className="muted">{t(capture.outline ? 'room.approximate' : 'room.noOutline')}</p>{capture.outline?.closed ? <div className="button-row" role="group" aria-label={t('room.view')}><button className="secondary" aria-pressed={mode === 'plan'} onClick={() => onMode('plan')}>{t('room.plan')}</button><button className="secondary" aria-pressed={mode === '3d'} onClick={() => onMode('3d')}>{t('room.threeD')}</button></div> : null}
    <RoomSketch capture={capture} photoUrls={photoUrls} flags={sketchFlags} selectedId={selectedId} onSelect={onSelect} mode={mode} /></section>
    <section className="stack"><h2>{t('room.flags')}</h2>{record.flags ? <><p>{t('room.reviewNotice')}</p><p className="muted">{t('room.modelLicense')}</p></> : null}{!flags.length ? <p>{t('room.flagsEmpty')}</p> : null}{flags.map((flag) => <article className="card capture-flag" key={flag.checklistItemId} data-selected={selectedId === flag.checklistItemId}>
      <button className="secondary capture-flag-select" aria-pressed={selectedId === flag.checklistItemId} onClick={() => onSelect(flag.checklistItemId)}>{photoUrls.get(flag.bestPhotoId!) ? <img src={photoUrls.get(flag.bestPhotoId!)} alt={t('room.photo', { number: capture.photos.findIndex((p) => p.photoId === flag.bestPhotoId) + 1 })} /> : null}{flag.question}</button>
      {language === 'es' ? <p>{t('room.original')}</p> : null}<p>{flag.limitation}</p><p>{captureScoreText(flag, record.flags!, t)}</p><strong>{t('room.notFinding')}</strong><ScreenLink title={t('room.related')} route={{ role: 'r', screen: 'question', id: flag.checklistItemId }} navigate={navigate} />
    </article>)}</section></>;
}
function captureScoreText(flag: CaptureSuggestionItem, file: NonNullable<StoredCapture['flags']>, t: Translator): string {
  return t(file.calibration ? 'room.scoreCalibrated' : 'room.scoreRaw', { score: flag.score!.toFixed(2), count: file.calibration?.trainExamples as number | undefined });
}
export function CaptureFlow(props: CaptureScreenProps) { return canUseCaptures(props.state, props.person) ? <AuthorizedCaptureFlow {...props} /> : <CaptureDenied />; }
function AuthorizedCaptureFlow({ scenario, roomId, navigate }: CaptureScreenProps) {
  const t = useT(), language = useLanguage(), [store] = useState(getCaptureStore), [phase, setPhase] = useState<'loading' | 'replace' | 'native' | 'photos' | 'denied' | 'failed'>('loading'), [reason, setReason] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false), alive = useRef(true), [captureId] = useState(newCaptureId);
  const prompts = capturePrompts(scenario, roomId, t);
  const returnToRoom = () => navigate({ role: 'r', screen: 'room', id: roomId });
  async function begin(replace: boolean) {
    setPhase('loading'); setReason('');
    try {
      const availability = await captureAvailability();
      if (!alive.current) return;
      if (!availability.arkit) { setPhase('photos'); return; }
      setPhase('native');
      const outcome = await runNativeCapture({ roomId, roomName: catalogText(t, 'room', roomId), language, prompts, replaceConfirmed: replace, store, isCurrent: () => alive.current });
      if (!alive.current) return;
      if (outcome.status === 'completed' || outcome.status === 'cancelled') returnToRoom();
      else { setPhase(outcome.status === 'denied' ? 'denied' : outcome.status === 'unavailable' ? 'photos' : 'failed'); setReason(outcome.reason ?? ''); }
    } catch (error) { if (alive.current) { setPhase('failed'); setReason(errorText(error, t)); } }
  }
  useEffect(() => {
    alive.current = true; let active = true;
    void store.read(roomId).then((r) => { if (active) { if (r) setPhase('replace'); else void begin(false); } }).catch((e) => { if (active) { setPhase('failed'); setReason(errorText(e, t)); } });
    return () => { active = false; alive.current = false; };
  }, [roomId, store]);
  if (phase === 'replace') return <Confirmation text={t('room.replaceConfirm')} confirm={t('room.replaceYes')} onConfirm={() => { setReplaceConfirmed(true); void begin(true); }} onCancel={returnToRoom} />;
  return <div className="stack capture-screen"><h2>{catalogText(t, 'room', roomId)}</h2><p>{t('capture.privacy')}</p>
    {phase === 'loading' || phase === 'native' ? <p role="status">{t('capture.preparing')}</p> : null}
    {phase === 'denied' ? <p className="notice">{t('capture.denied')}</p> : null}
    {phase === 'failed' ? <><p role="alert">{t('capture.failed')} {reason}</p><button onClick={() => void begin(replaceConfirmed)}>{t('capture.retry')}</button><button className="secondary" onClick={() => setPhase('photos')}>{t('capture.photoTour')}</button></> : null}
    {phase === 'photos' || phase === 'denied' ? <GuidedPhotoTour prompts={prompts} onCancel={returnToRoom} onSave={async (photos, blobs) => {
      const manifest: CaptureManifest = { format: 'fixlist-room-capture', version: 1, captureId, roomId, createdAt: new Date().toISOString(), mode: 'photos', floorY: null, outline: null, doors: [], photos };
      const valid = validateCaptureManifest(manifest);
      if (!valid.ok) throw new CaptureError(valid.code, valid.error);
      if (!alive.current) return;
      await store.writeCapture(valid.value, blobs, replaceConfirmed);
      if (alive.current) returnToRoom();
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
  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busyRef.current) return;
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
    {index < prompts.length ? <><div className="capture-inputs"><label className="capture-file">{t('capture.take')}<input type="file" accept="image/*" capture="environment" aria-label={t('capture.take')} disabled={busy} onChange={(e) => void selectPhoto(e)} /></label><label className="capture-file">{t('capture.choose')}<input type="file" accept="image/*" aria-label={t('capture.choose')} disabled={busy} onChange={(e) => void selectPhoto(e)} /></label></div>
    {preview ? <img className="capture-preview" src={preview} alt={t('room.photo', { number: index + 1 })} /> : null}
    <div className="button-row">{photo ? <><button className="secondary" disabled={busy} onClick={() => setDrafts((old) => { const next = new Map(old); next.delete(index); return next; })}>{t('capture.native.retake')}</button><button disabled={busy} onClick={() => setIndex(index + 1)}>{t('capture.native.next')}</button></> : null}<button className="secondary" disabled={busy} onClick={() => { setDrafts((old) => { const next = new Map(old); next.delete(index); return next; }); setIndex(index + 1); }}>{t('capture.native.skip')}</button></div></> : null}
    <p role="status">{t('capture.savedCount', { count: drafts.size })}</p>{!drafts.size ? <p>{t('capture.minimum')}</p> : null}
    <div className="button-row">{index > 0 ? <button className="secondary" disabled={busy} onClick={() => setIndex(index - 1)}>{t('capture.back')}</button> : null}<button disabled={busy || !drafts.size} onClick={() => void save()}>{t('capture.native.done')}</button><button className="secondary" disabled={busy} onClick={() => drafts.size ? setCancelConfirm(true) : onCancel()}>{t('capture.cancel')}</button></div>
    {cancelConfirm ? <Confirmation text={t('capture.cancelConfirm')} confirm={t('capture.discard')} onConfirm={onCancel} onCancel={() => setCancelConfirm(false)} /> : null}
  </div>;
}
