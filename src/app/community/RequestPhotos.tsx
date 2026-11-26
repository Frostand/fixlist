import { useEffect, useRef, useState } from 'react';
import { MAX_REQUEST_PHOTOS } from '../../community/request-photos';
import { prepareRequestPhoto } from '../../lib/request-photo';
import { useT } from '../../i18n';
import { Button } from './UI';

const EMPTY_PHOTOS: readonly string[] = [];

export function RequestPhotos({ photos = EMPTY_PHOTOS }: { photos?: readonly string[] | undefined }) {
    const t = useT();
    return photos.length ? <section className="c-request-photos" aria-label={t('c.photos.title')}><h3>{t('c.photos.title')}</h3><div className="c-photo-list">{photos.map((photo, index) => <img key={index} src={photo} alt={t('c.photos.alt', { number: index + 1 })} loading="lazy"/>)}</div></section> : null;
}

export function RequestPhotoEditor({ photos = EMPTY_PHOTOS, disabled = false, isCurrent = () => true, onChange, onBusyChange }: {
    photos?: readonly string[] | undefined; disabled?: boolean; isCurrent?(): boolean;
    onChange(photos: readonly string[]): void; onBusyChange?(busy: boolean): void;
}) {
    const t = useT(), input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const alive = useRef(true), pending = useRef(false), latest = useRef({ photos, disabled, isCurrent, onChange, onBusyChange });
    latest.current = { photos, disabled, isCurrent, onChange, onBusyChange };
    useEffect(() => { alive.current = true; return () => { alive.current = false; latest.current.onBusyChange?.(false); }; }, []);
    async function add(files: readonly File[]) {
        const owner = latest.current;
        if (!files.length || pending.current || owner.disabled || !owner.isCurrent()) return;
        if (files.length + owner.photos.length > MAX_REQUEST_PHOTOS) { setError(t('c.photos.limit')); return; }
        pending.current = true; setBusy(true); setError(''); owner.onBusyChange?.(true);
        try {
            const added: string[] = [];
            for (const file of files) added.push(await prepareRequestPhoto(file));
            if (alive.current && latest.current.isCurrent() && !latest.current.disabled && latest.current.photos === owner.photos) latest.current.onChange([...owner.photos, ...added]);
        } catch { if (alive.current && latest.current.isCurrent()) setError(t('c.photos.error')); }
        finally { pending.current = false; if (alive.current) { setBusy(false); latest.current.onBusyChange?.(false); } }
    }
    return <section className="c-stack c-request-photos" aria-label={t('c.photos.title')}>
        <h3>{t('c.photos.title')}</h3><p className="c-small">{t('c.photos.hint')}</p>
        <input ref={input} type="file" accept="image/*" multiple hidden disabled={disabled || busy || photos.length >= MAX_REQUEST_PHOTOS} aria-label={t('c.photos.add')} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void add(files); }}/>
        <Button kind="secondary" disabled={disabled || busy || photos.length >= MAX_REQUEST_PHOTOS} onClick={() => { if (!pending.current && !latest.current.disabled && latest.current.isCurrent()) input.current?.click(); }}>{t('c.photos.add')}</Button>
        <p className="c-small" role="status">{busy ? t('c.photos.preparing') : t('c.photos.count', { count: photos.length })}</p>
        {photos.length ? <div className="c-photo-list">{photos.map((photo, index) => <figure key={index}><img src={photo} alt={t('c.photos.alt', { number: index + 1 })}/><Button kind="secondary" disabled={disabled || busy} aria-label={t('c.photos.removeLabel', { number: index + 1 })} onClick={() => { if (!pending.current && !latest.current.disabled && latest.current.isCurrent()) { setError(''); onChange(photos.filter((_, i) => i !== index)); } }}>{t('c.photos.remove')}</Button></figure>)}</div> : null}
        {error ? <p role="alert">{error}</p> : null}
    </section>;
}
