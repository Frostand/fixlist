import { useEffect, useRef, useState } from 'react';
import type { CaptureStore, StoredCapture } from '../../lib/capture-storage';
import { analyzeAndSaveVision, prepareVision, visionAvailability, type VisionAvailability } from '../../lib/vision-hazards';
import { useT } from '../../i18n';
import { Button } from './UI';
export function VisionReviewControl({ record, store, isCurrent, onSaved }: { record: StoredCapture; store: CaptureStore; isCurrent(): boolean; onSaved(record: StoredCapture): void }) {
  const t = useT(), auth = useRef(isCurrent), saved = useRef(onSaved); auth.current = isCurrent; saved.current = onSaved;
  const [availability, setAvailability] = useState<VisionAvailability | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState<number | null>(null), [line, setLine] = useState(''), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null), mounted = useRef(true);
  async function analyze(current: () => boolean, signal: AbortSignal) {
    setBusy(true); setError('');
    try {
      await analyzeAndSaveVision(record.manifest.roomId, { store, isCurrent: current, signal, onProgress: p => { if (current()) setLine(t(p.kind === 'panorama' ? 'pano.checkingSpot' : 'pano.checkingPhoto', { number: p.current, count: p.total })); } });
      const next = await store.read(record.manifest.roomId); if (next && current()) saved.current(next);
    } catch { if (current()) setError(t('pano.aiFailed')); }
    finally { if (current()) { setBusy(false); setLine(''); setProgress(null); } }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); operation.current = controller;
    const captureId = record.manifest.captureId;
    const current = () => mounted.current && !controller.signal.aborted && auth.current();
    setAvailability(null); setError(''); setBusy(false); setProgress(null); setLine('');
    void (async () => {
      const a = await visionAvailability(); if (!current()) return; setAvailability(a);
      if (a.state === 'ready' && a.available && !record.aiReview && captureId === record.manifest.captureId) await analyze(current, controller.signal);
    })();
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); };
  }, [record.manifest.captureId, store]);
  async function download() {
    if (busy || !auth.current()) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && auth.current();
    setBusy(true); setProgress(0); setError(''); setLine(t('pano.downloading'));
    try {
      await prepareVision({ isCurrent: current, signal: controller.signal, onProgress: p => { if (current()) { setProgress(p.fraction); setLine(t(p.phase === 'load' ? 'pano.loadingAI' : 'pano.downloading')); } } });
      const a = await visionAvailability(); if (!current()) return; setAvailability(a); setProgress(null); await analyze(current, controller.signal);
    } catch { if (current()) { setError(t('pano.aiFailed')); setBusy(false); setLine(''); setProgress(null); } }
  }
  return <section className="c-vision-panel c-stack" aria-label={t('pano.aiTitle')}><h3>{t('pano.aiTitle')}</h3>
    <p className="c-small">{t('pano.notice')}</p>
    {!availability ? <p role="status">{t('pano.aiChecking')}</p> : availability.state === 'unsupported' ? <p role="status">{t('pano.unsupported')}</p> : null}
    {availability && ['needs-download', 'downloading'].includes(availability.state) && !busy ? <><p className="c-small">{t('pano.downloadNote')}</p><Button onClick={() => void download()}>{t('pano.download', { size: `${Math.ceil((availability.model?.bytes ?? 0) / 1024 / 1024)} MB` })}</Button></> : null}
    {busy ? <><p role="status">{line || t('pano.aiChecking')}</p>{progress !== null ? <progress aria-label={line} value={progress} max={1}/> : null}<Button kind="quiet" onClick={() => { operation.current?.abort(); setBusy(false); setLine(''); setProgress(null); }}>{t('pano.cancel')}</Button></> : null}
    {error ? <p role="alert">{error}</p> : null}
    {availability?.state === 'ready' && availability.available && !busy ? <Button kind="secondary" onClick={() => { operation.current?.abort(); const controller = new AbortController(); operation.current = controller; void analyze(() => mounted.current && !controller.signal.aborted && auth.current(), controller.signal); }}>{t(record.aiReview ? 'pano.checkAgain' : 'pano.check')}</Button> : null}
  </section>;
}
