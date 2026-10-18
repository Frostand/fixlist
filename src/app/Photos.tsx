import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { HouseholdPhoto } from '../domain/roles';
import { getPhotoStore } from '../lib/photo-storage';
import { useT } from '../i18n';
import { catalogText } from '../i18n/catalog';

export function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>, onPhoto: (file: File) => void) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (file) onPhoto(file);
}
export function PhotoInputActions({ busy, onPhoto }: { busy: boolean; onPhoto(file: File): void }) {
  const t = useT(), camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null);
  return <div className="button-row">
    <button type="button" className="secondary" disabled={busy} onClick={() => camera.current?.click()}>{t('scanViewer.takePhoto')}</button>
    <button type="button" className="secondary" disabled={busy} onClick={() => library.current?.click()}>{t('scanViewer.choosePhoto')}</button>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(event) => handlePhotoSelection(event, onPhoto)} />
    <input ref={library} type="file" accept="image/*" hidden disabled={busy} onChange={(event) => handlePhotoSelection(event, onPhoto)} />
  </div>;
}
export function PhotoImage({ photo }: { photo: HouseholdPhoto }) {
  const t = useT(), [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, objectUrl = '';
    void getPhotoStore().read(photo.id).then((blob) => {
      if (!alive) return;
      if (!blob) { setFailed(true); return; }
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id]);
  return url ? <img src={url} className="household-photo" width={photo.width} height={photo.height} alt={t('check.photoAlt', { question: catalogText(t, 'check', photo.checklistItemId) })} /> : <p className="muted" role="status" data-photo-pending={!failed} data-photo-failed={failed}>{t(failed ? 'check.photoMissing' : 'common.loading')}</p>;
}
