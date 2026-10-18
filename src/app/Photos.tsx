import { useEffect, useState } from 'react';
import type { HouseholdPhoto } from '../domain/roles';
import { getPhotoStore } from '../lib/photo-storage';
import { useT } from '../i18n';
import { catalogText } from '../i18n/catalog';
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
