import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { JobAnalysis, ScanEvidence } from '../../community/types';
import { scanFlagAnalysis } from '../../community';
import { useLanguage, useT } from '../../i18n';
import { catalogText } from '../../i18n/catalog';
import { getCommunityCaptureStore, type StoredCapture } from '../../lib/capture-storage';
import type { SketchFlag } from '../../lib/capture-types';
import { tourHazards, type TourHazard } from '../../lib/room-tour-geometry';
import { RoomReviewSketch } from './RoomReviewSketch';
import { buildRoomSketchGeometry } from '../../lib/room-geometry';
import { Button } from './UI';
import './room-tour.css';
const RoomPanorama = lazy(() => import('./RoomPanorama'));
export function captureSketchFlags(record: StoredCapture): SketchFlag[] {
  return (record.flags?.items ?? []).flatMap(flag => flag.status === 'suggested' && flag.bestPhotoId
    ? [{ id: `flag-${flag.checklistItemId}`, checklistItemId: flag.checklistItemId, photoId: flag.bestPhotoId, point: flag.point, label: flag.question }] : []);
}
export function hazardEvidence(record: StoredCapture, hazard: TourHazard): ScanEvidence {
  const photo = record.manifest.photos.find(p => p.photoId === hazard.sourceId);
  return { roomId: record.manifest.roomId, photoId: hazard.kind === 'panorama' ? `pano-${hazard.sourceId}` : hazard.sourceId,
    flagId: `${record.manifest.captureId}-${hazard.id}`, label: hazard.label, thumbnail: hazard.thumbnail,
    point: photo && hazard.box ? { u: hazard.box.x + hazard.box.w / 2, v: hazard.box.y + hazard.box.h / 2 } : null };
}
/** Resident and authorized local job views render the same capture bytes and saved review. */
export function RoomTour({ record, onDraft, isCurrent = () => true }: {
  record: StoredCapture; onDraft?(analysis: JobAnalysis, evidence: ScanEvidence): void; isCurrent?(): boolean;
}) {
  const t = useT(), language = useLanguage(), stops = record.manifest.tour?.stops ?? [];
  const [stopId, setStopId] = useState(stops[0]?.stopId ?? ''), [selected, setSelected] = useState<string | null>(null), [dollhouse, setDollhouse] = useState(false);
  const flags = useMemo(() => captureSketchFlags(record), [record.flags]);
  const stop = stops.find(s => s.stopId === stopId) ?? stops[0];
  const hazards = useMemo(() => stop ? tourHazards(record.manifest, record.aiReview, flags, stop) : [], [record, flags, stop]);
  // The list includes suggestions from every panorama, even when its stop is not selected.
  const allHazards = useMemo<TourHazard[]>(() => [
    ...(record.aiReview?.sources ?? []).flatMap(source => source.hazards.map((h, i) => ({ ...h, id: `ai-${source.kind}-${source.id}-${i}`, sourceId: source.id, kind: source.kind }))),
    ...flags.map(f => ({ ...f, sourceId: f.photoId, kind: 'flag' as const, detail: '', tip: '', category: 'other' as const, severity: 'medium' as const, box: null, direction: null, thumbnail: null })),
  ], [record.aiReview, flags]);
  const focused = allHazards.find(h => h.id === selected);
  function select(id: string) {
    if (!isCurrent()) return;
    const h = allHazards.find(h => h.id === id); if (h?.kind === 'panorama') setStopId(h.sourceId);
    setSelected(id);
  }

  const canSketch = !!buildRoomSketchGeometry(record.manifest, flags);
  const card = (h: TourHazard, compact = false) => <article className="c-tour-hazard" data-selected={selected === h.id} data-severity={h.severity} key={h.id}>
    <button type="button" className="c-tour-hazard-focus" onClick={() => select(h.id)} aria-pressed={selected === h.id}><strong>{h.label}</strong><small>{t(`pano.${h.severity}`)}</small></button>
    {h.thumbnail ? <img loading="lazy" src={h.thumbnail} alt={t('pano.thumbnail', { label: h.label })}/> : null}
    {h.detail ? <p>{h.detail}</p> : null}{h.tip ? <p className="c-small">{h.tip}</p> : null}
    {onDraft ? <Button kind="secondary" onClick={() => { if (isCurrent()) onDraft(scanFlagAnalysis('ai-review', h.label, language), hazardEvidence(record, h)); }}>{t('pano.ask')}</Button> : null}
    {compact ? <button type="button" className="c-tour-dismiss" aria-label={t('pano.dismiss')} onClick={() => setSelected(null)}>×</button> : null}
  </article>;
  return <section className="c-room-tour c-stack" data-room-id={record.manifest.roomId} aria-label={t('pano.title')}>
    <div className="c-tour-heading"><div><p className="c-small">{catalogText(t, 'room', record.manifest.roomId)}</p><h2>{t(stop ? 'pano.title' : 'pano.aiTitle')}</h2></div>
      {canSketch && stop ? <Button kind="secondary" onClick={() => setDollhouse(v => !v)}>{t(dollhouse ? 'pano.back' : 'pano.dollhouse')}</Button> : null}</div>
    {stop ? <>{dollhouse ? <RoomReviewSketch record={record} flags={flags} selectedId={selected} onSelect={select}/> : <Suspense fallback={<p role="status">{t('pano.loading')}</p>}><RoomPanorama stop={stop} stops={stops} panoramas={record.panoramaBlobs ?? new Map()} floorY={record.manifest.floorY} hazards={hazards} selectedId={selected} onSelect={select} onStop={id => { if (isCurrent()) { setStopId(id); setSelected(null); } }}/></Suspense>}
    <div className="c-tour-stops" role="group" aria-label={t('pano.spots')}>{stops.map((s, i) => <button type="button" key={s.stopId} aria-pressed={s.stopId === stop.stopId} onClick={() => { if (isCurrent()) { setStopId(s.stopId); setSelected(null); } }}>{t('pano.spot', { number: i + 1 })}</button>)}</div>
    <p role="status" className="c-small">{t('pano.current', { number: stops.indexOf(stop) + 1, count: stops.length })}</p>
    {stop.panorama.coverage < 0.95 ? <p className="c-small">{t('pano.coverage', { percent: Math.round(stop.panorama.coverage * 100) })}</p> : null}</> : null}
    {focused ? <div className="c-tour-focused" aria-live="polite">{card(focused, true)}</div> : null}
    <p className="c-notice">{t('pano.notice')}</p>
    {allHazards.length ? <><h3>{t('pano.suggestions', { count: allHazards.length })}</h3><div className="c-tour-hazards">{allHazards.map(h => card(h))}</div></>
      : <p className="c-small">{t(record.aiReview ? 'pano.empty' : 'pano.notReviewed')}</p>}
    <p className="c-small">{t('pano.local')}</p>
  </section>;
}
/** Only the already-authorized job route supplies this resident/epoch scope. No legacy/global-store fallback. */
export function JobRoomTours({ evidence, ownerId, resetEpoch, isCurrent = () => true }: {
  evidence: readonly ScanEvidence[]; ownerId?: string | undefined; resetEpoch?: string | undefined; isCurrent?: (() => boolean) | undefined;
}) {
  const [loaded, setLoaded] = useState<{ scope: string; records: StoredCapture[] } | null>(null), auth = useRef(isCurrent); auth.current = isCurrent;
  const rooms = [...new Set(evidence.map(item => item.roomId))], roomKey = JSON.stringify(rooms), scope = JSON.stringify([ownerId, resetEpoch, roomKey]);
  useEffect(() => {
    let alive = true; setLoaded(null);
    if (!ownerId || !resetEpoch || !auth.current()) return;
    const store = getCommunityCaptureStore(ownerId, resetEpoch);
    void (async () => {
      const records: StoredCapture[] = [];
      for (const room of JSON.parse(roomKey) as string[]) {
        if (!alive || !auth.current()) return;
        try { const record = await store.read(room); if (record?.manifest.tour) records.push(record); } catch { /* Evidence thumbnails remain available when local media is missing. */ }
      }
      if (alive && auth.current()) setLoaded({ scope, records });
    })();
    return () => { alive = false; };
  }, [ownerId, resetEpoch, roomKey, scope]);
  return <>{loaded?.scope === scope && auth.current() ? loaded.records.map(record => <RoomTour key={record.manifest.captureId} record={record} isCurrent={() => auth.current()}/>) : null}</>;
}
