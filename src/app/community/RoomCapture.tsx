import { useEffect, useMemo, useRef, useState } from 'react';
import { demoScenario } from '../../data/demo-scenario';
import type { JobAnalysis, ScanEvidence } from '../../community/types';
import { scanFlagAnalysis } from '../../community';
import { useLanguage, useT } from '../../i18n';
import { catalogText } from '../../i18n/catalog';
import { captureAvailability, runNativeCapture } from '../../lib/native-capture';
import { getCommunityCaptureStore, type StoredCapture } from '../../lib/capture-storage';
import { newCaptureId } from '../../lib/capture-model';
import { analyzeAndSaveFlags, ondeviceFlagCopy } from '../../lib/ondevice-flags';
import { capturePrompts, GuidedPhotoTour } from '../CaptureScreens';
import { Button, Heading, Sheet } from './UI';
import { EvidencePhoto } from './JobCard';
import { CaptureVideos } from '../CaptureVideos';
interface ReviewArea {
    checklistItemId: string;
    evidence: ScanEvidence;
    question: string;
    sample: boolean;
}
/** Authored synthetic illustration: no private photograph, remote fetch, or model result. */
function sampleThumbnail(): string {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 420;
    const x = c.getContext('2d');
    if (!x)
        throw new Error('Canvas unavailable');
    x.fillStyle = '#ede7db';
    x.fillRect(0, 0, 640, 280);
    x.fillStyle = '#b69b7d';
    x.beginPath();
    x.moveTo(0, 280);
    x.lineTo(640, 280);
    x.lineTo(640, 420);
    x.lineTo(0, 420);
    x.fill();
    x.strokeStyle = '#806f5c';
    x.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
        x.beginPath();
        x.moveTo(i * 110, 280);
        x.lineTo(i * 135 - 100, 420);
        x.stroke();
    }
    x.fillStyle = '#8eb1bc';
    x.fillRect(53, 40, 170, 160);
    x.strokeStyle = '#fff';
    x.lineWidth = 10;
    x.strokeRect(53, 40, 170, 160);
    x.beginPath();
    x.moveTo(138, 40);
    x.lineTo(138, 200);
    x.moveTo(53, 120);
    x.lineTo(223, 120);
    x.stroke();
    x.fillStyle = '#537867';
    x.fillRect(340, 202, 230, 100);
    x.fillRect(328, 238, 28, 78);
    x.fillRect(556, 238, 28, 78);
    x.fillStyle = '#e4cc9b';
    x.fillRect(363, 216, 58, 49);
    x.fillStyle = '#333f33';
    x.fillRect(353, 302, 15, 35);
    x.fillRect(544, 302, 15, 35);
    x.fillStyle = '#c56f4d';
    x.beginPath();
    x.moveTo(135, 326);
    x.lineTo(420, 320);
    x.lineTo(470, 394);
    x.lineTo(107, 403);
    x.closePath();
    x.fill();
    x.strokeStyle = '#efd6bd';
    x.lineWidth = 4;
    x.stroke();
    x.fillStyle = '#e7b482';
    x.beginPath();
    x.moveTo(107, 403);
    x.lineTo(155, 377);
    x.lineTo(156, 401);
    x.fill();
    x.fillStyle = '#384e3c';
    x.fillRect(276, 236, 13, 77);
    x.beginPath();
    x.ellipse(279, 214, 32, 49, -0.2, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#b86e4a';
    x.fillRect(259, 276, 42, 43);
    return c.toDataURL('image/jpeg', 0.75);
}
async function thumbnail(blob: Blob): Promise<string> { const image = await createImageBitmap(blob); try {
    const c = document.createElement('canvas'), scale = Math.min(1, 640 / image.width);
    c.width = Math.round(image.width * scale);
    c.height = Math.round(image.height * scale);
    const x = c.getContext('2d');
    if (!x)
        throw new Error('Canvas unavailable');
    x.drawImage(image, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
}
finally {
    image.close();
} }
export function RoomCapture({ ownerId, resetEpoch, onDraft, onType, isCurrent = () => true }: {
    isCurrent?(): boolean;
    ownerId: string;
    resetEpoch: string;
    onDraft(a: JobAnalysis, e: ScanEvidence): void;
    onType(): void;
}) {
    const t = useT(), language = useLanguage(), alive = useRef(true), epoch = useRef(0);
    const authorization = useRef(isCurrent);
    authorization.current = isCurrent;
    const store = useMemo(() => getCommunityCaptureStore(ownerId, resetEpoch), [ownerId, resetEpoch]);
    const scope = useMemo(() => ({ ownerId, resetEpoch, store }), [ownerId, resetEpoch, store]);
    const latestScope = useRef(scope), pendingNative = useRef<AbortController | null>(null), photoOperation = useRef<(() => boolean) | null>(null);
    const recordScope = useRef(scope);
    latestScope.current = scope;
    function invalidate() { epoch.current++; pendingNative.current?.abort(); pendingNative.current = null; photoOperation.current = null; }
    const [roomId, setRoomId] = useState<string | null>(null), [record, setRecord] = useState<StoredCapture | null>(null), [areas, setAreas] = useState<ReviewArea[]>([]), [phase, setPhase] = useState<'choose' | 'ready' | 'busy' | 'photos' | 'review'>('choose'), [error, setError] = useState(''), [replace, setReplace] = useState<'native' | 'photos' | null>(null), [sample, setSample] = useState(false);
    const [cleanupNotice, setCleanupNotice] = useState('');
    function retainRecord(saved: StoredCapture | null) { recordScope.current = scope; setRecord(saved); }
    useEffect(() => {
        alive.current = true;
        setRoomId(null); setRecord(null); setAreas([]); setPhase('choose'); setError(''); setCleanupNotice(''); setReplace(null); setSample(false);
        return () => { alive.current = false; invalidate(); };
    }, [scope]);
    function guard() {
        if (!alive.current || scope !== latestScope.current || !authorization.current()) return () => false;
        invalidate(); const version = epoch.current;
        return () => alive.current && scope === latestScope.current && version === epoch.current && authorization.current();
    }
    async function readAreas(saved: StoredCapture, current: () => boolean) { const next: ReviewArea[] = []; for (const flag of saved.flags?.items ?? []) {
        if (flag.status !== 'suggested' || !flag.bestPhotoId)
            continue;
        const photo = saved.manifest.photos.find((p) => p.photoId === flag.bestPhotoId), blob = saved.photos.get(flag.bestPhotoId);
        if (!photo || !blob)
            continue;
        const thumb = await thumbnail(blob);
        if (!current())
            return;
        next.push({ checklistItemId: flag.checklistItemId, question: saved.flags?.model.engine === 'clip-zero-shot' ? ondeviceFlagCopy(flag.checklistItemId).question : flag.question, sample: false, evidence: { roomId: saved.manifest.roomId, photoId: photo.photoId, flagId: `flag-${flag.checklistItemId}`, label: catalogText(t, 'check', flag.checklistItemId), thumbnail: thumb, point: flag.point ? { u: flag.point.u / photo.width, v: flag.point.v / photo.height } : null } });
    } if (current()) {
        setAreas(next);
        setSample(false);
        setPhase('review');
    } }
    async function selectRoom(id: string) { const current = guard(); if (!current()) return; setRoomId(id); setAreas([]); setSample(false); setError(''); setRecord(null); setPhase('busy'); try {
        const saved = await store.read(id);
        if (!current())
            return;
        retainRecord(saved);
        if (saved?.flags)
            await readAreas(saved, current);
        else
            setPhase('ready');
    }
    catch {
        if (current()) {
            setError(t('c.scan.captureFailed'));
            setPhase('ready');
        }
    } }
    async function analyze(id: string, current: () => boolean) { try {
        // Capture replacement is already durable. Retain its identity even when
        // the optional model step fails, so the next consent targets this save.
        const durable = await store.read(id);
        if (!current()) return;
        retainRecord(durable);
        await analyzeAndSaveFlags(id, { store, isCurrent: current });
        if (!current())
            return;
        const saved = await store.read(id);
        if (saved && current()) {
            retainRecord(saved);
            await readAreas(saved, current);
        }
    }
    catch {
        if (current()) {
            setError(t('c.scan.modelUnavailable'));
            setPhase('ready');
        }
    } }
    async function start(route: 'native' | 'photos' = 'native') { if (!roomId)
        return; const current = guard(); if (!current()) return; setError(''); setCleanupNotice(''); setPhase('busy'); try {
        if (route === 'photos') {
            photoOperation.current = current;
            setPhase('photos');
            return;
        }
        const controller = new AbortController();
        pendingNative.current = controller;
        const a = await captureAvailability();
        if (!current())
            return;
        if (!a.arkit) {
            photoOperation.current = current;
            setPhase('photos');
            return;
        }
        const outcome = await runNativeCapture({ roomId, roomName: catalogText(t, 'room', roomId), language, prompts: capturePrompts(demoScenario, roomId, t), replaceConfirmed: !!record, expectedCaptureId: record?.manifest.captureId ?? null, store, isCurrent: current, signal: controller.signal });
        if (!current())
            return;
        if (outcome.cleanupFailed) setCleanupNotice(t(outcome.status === 'completed' ? 'capture.savedCleanupFailed' : 'capture.cleanupFailed'));
        if (outcome.status === 'completed')
            await analyze(roomId, current);
        else if (outcome.status === 'unavailable' || outcome.status === 'denied') {
            photoOperation.current = current;
            setPhase('photos');
        }
        else {
            setPhase(outcome.status === 'cancelled' && record?.flags ? 'review' : 'ready');
            if (outcome.status !== 'cancelled')
                setError([t('c.scan.captureFailed'), outcome.reason].filter(Boolean).join(' '));
        }
    }
    catch {
        if (current()) {
            setError(t('c.scan.captureFailed'));
            setPhase('ready');
        }
    } }
    function useSample() {
        if (!roomId || !alive.current || scope !== latestScope.current || !authorization.current()) return;
        invalidate();
        setError('');
        try {
            // The practice picture belongs to the selected room in this local flow.
            const sampleRoomId = roomId;
            const check = demoScenario.checklist.find((c) => c.id === 'rug-check');
            if (!check) return;
            setAreas([{ checklistItemId: check.id, question: catalogText(t, 'check', check.id), sample: true,
                evidence: { roomId: sampleRoomId, photoId: 'sample-room', flagId: `sample-${check.id}`,
                    label: catalogText(t, 'check', check.id), point: { u: .23, v: .92 }, thumbnail: sampleThumbnail() } }]);
            setSample(true);
            setPhase('review');
        } catch { setError(t('c.scan.captureFailed')); }
    }
    // A retained tour must check its own guard before guard() invalidates newer work.
    const photoCurrent = photoOperation.current;
    const canStart = phase === 'ready' || (phase === 'review' && !sample && scope === recordScope.current && record?.manifest.roomId === roomId);
    return <div className="c-stack"><Heading intro={t('c.scan.body')}>{roomId ? catalogText(t, 'room', roomId) : t('c.scan.title')}</Heading>{cleanupNotice ? <p className="c-notice" role="alert">{cleanupNotice}</p> : null}{scope === recordScope.current && record && record.manifest.roomId === roomId ? <CaptureVideos record={record} ownerKey={JSON.stringify([ownerId, resetEpoch])} /> : null}{!roomId ? <div className="c-room-list">{demoScenario.rooms.map((r) => <Button key={r.id} kind="secondary" icon="room" onClick={() => void selectRoom(r.id)}>{catalogText(t, 'room', r.id)}</Button>)}</div> : <>{phase === 'busy' ? <p role="status">{t('c.scan.checking')}</p> : null}{error ? <p className="c-notice" role="status">{error}</p> : null}{phase === 'photos' ? <GuidedPhotoTour prompts={capturePrompts(demoScenario, roomId, t)} onCancel={() => { if (photoCurrent?.()) { invalidate(); setPhase(record?.flags ? 'review' : 'ready'); } }} onSave={async (photos, blobs) => { if (!photoCurrent?.()) return; const current = guard(); if (!current()) return; setPhase('busy'); try {
        await store.writeCapture({ format: 'fixlist-room-capture', version: 1, captureId: newCaptureId(), roomId, createdAt: new Date().toISOString(), mode: 'photos', floorY: null, outline: null, doors: [], photos }, blobs, !!record, current, record?.manifest.captureId ?? null);
        if (current())
            await analyze(roomId, current);
    }
    catch {
        if (current()) {
            setError(t('c.scan.captureFailed'));
            setPhase('ready');
        }
    } }}/> : null}{phase === 'review' ? <><h2>{t('c.scan.review')}</h2><p className="c-small">{t(sample ? 'c.scan.sampleNote' : 'c.scan.unverified')}</p>{areas.length ? areas.map((area) => <article className="c-review-area" key={area.evidence.flagId}><EvidencePhoto evidence={area.evidence} caption={false}/><p>{t('c.scan.question', { question: area.question })}</p><Button kind={areas.length === 1 ? 'primary' : 'secondary'} onClick={() => { if (alive.current && scope === latestScope.current && authorization.current()) onDraft(scanFlagAnalysis(area.checklistItemId, area.evidence.label, language), area.evidence); }}>{t('c.scan.ask')}</Button></article>) : <><p>{t('c.scan.empty')}</p><Button onClick={() => { if (alive.current && authorization.current()) onType(); }}>{t('c.home.type')}</Button></>}</> : null}{canStart ? <><Button icon="room" onClick={() => record ? setReplace('native') : void start()}>{t('c.scan.start')}</Button><Button kind="secondary" onClick={() => record ? setReplace('photos') : void start('photos')}>{t('room.startPhotos')}</Button></> : null}{phase !== 'busy' ? <Button kind="secondary" onClick={useSample}>{t('c.scan.sample')}</Button> : null}<Button kind="quiet" onClick={() => { invalidate(); setRoomId(null); setPhase('choose'); setError(''); setReplace(null); }}>{t('c.scan.restart')}</Button></>}<p className="c-small">{t('c.scan.privacy')}</p>{replace ? <Sheet title={t(replace === 'photos' ? 'room.startPhotos' : 'c.scan.start')} onClose={() => setReplace(null)}><p>{t('c.scan.replace')}</p><Button onClick={() => { setReplace(null); void start(replace); }}>{t('c.scan.replaceYes')}</Button></Sheet> : null}</div>;
}
