import { lazy, Suspense, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { CommunityApp } from './CommunityApp';
import '../../styles/community.css';
const ClassicApp = lazy(() => import('../App').then((m) => ({ default: m.App })));
export function usesClassic(mode: string | null, hash: string): boolean { return mode === 'classic' || ['#/r/', '#/v/', '#/start', '#/people', '#/guide'].some((prefix) => hash.startsWith(prefix)); }
function readMode() { try {
    return localStorage.getItem('fixlist.mode');
}
catch {
    return null;
} }
export function Root() {
    const [hash, setHash] = useState(() => typeof window === 'undefined' ? '' : window.location.hash);
    const [mode, setMode] = useState(() => typeof window === 'undefined' ? null : readMode());
    const t = useT();
    useEffect(() => { const sync = () => { setHash(window.location.hash); setMode(readMode()); }; window.addEventListener('hashchange', sync); window.addEventListener('storage', sync); return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('storage', sync); }; }, []);
    if (usesClassic(mode, hash))
        return <><Suspense fallback={<p role="status">{t('c.loading')}</p>}><ClassicApp /></Suspense><button className="c-back-new" onClick={() => { try {
            localStorage.removeItem('fixlist.mode');
        }
        catch { /* In-memory mode still works. */ } window.location.hash = '/c/home'; setMode(null); setHash('#/c/home'); }}>{t('c.backNew')}</button></>;
    return <CommunityApp />;
}
