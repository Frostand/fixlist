import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { StoredCapture } from '../lib/capture-storage';

/** Retained local clip playback is independent of optional photo inference. */
export function CaptureVideos({ record, ownerKey }: { record: StoredCapture; ownerKey: string }) {
  const t = useT(), clip = record.videos?.clips[0], blob = clip ? record.videoBlobs?.get(clip.videoId) : undefined;
  const binding = JSON.stringify([ownerKey, record.manifest.roomId, record.manifest.captureId]);
  const [source, setSource] = useState<{ binding: string; blob: Blob; url: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const activeUrl = useRef<string | null>(null);
  useEffect(() => {
    setSource(null); setFailure(null);
    if (!blob || !clip) return;
    let url: string;
    try { url = URL.createObjectURL(blob); }
    catch { setFailure(binding); return; }
    activeUrl.current = url; setSource({ binding, blob, url });
    return () => { activeUrl.current = null; URL.revokeObjectURL(url); };
  }, [binding, blob, clip]);
  if (!clip) return null;
  const url = source?.binding === binding && source.blob === blob ? source.url : null;
  return <section className="card capture-video stack"><h2>{t('capture.video.title')}</h2>
    <p className="footnote">{t('capture.video.privacy')}</p>
    {url ? <video key={url} src={url} controls playsInline preload="metadata" aria-label={t('capture.video.title')} onError={() => { if (activeUrl.current === url) setFailure(url); }} /> : null}
    {!blob || failure === binding || url && failure === url ? <p role="alert">{t('capture.video.playbackFailed')}</p> : null}
  </section>;
}
