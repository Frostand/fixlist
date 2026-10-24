import { useEffect, useRef, useState } from 'react';
import type { AvailabilitySlot, JobAnalysis } from '../../community/types';
import { assistant } from '../../lib/assistant';
import { useT } from '../../i18n';
import type { Draft } from './Elder';
import { DraftEditor, JobCard } from './JobCard';
import { Button, Heading } from './UI';
export function DraftScreen({ draft, onChange, onPost, embedded = false }: {
    draft: Draft;
    embedded?: boolean;
    onChange(d: Draft): void;
    onPost(slots: readonly AvailabilitySlot[], analysis: JobAnalysis): boolean;
}) {
    const t = useT(), previewHeading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { if (embedded) previewHeading.current?.focus(); }, [embedded]);
    const [editing, setEditing] = useState(false);
    const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
    const [posting, setPosting] = useState(false);
    const initial = useRef(draft.analysis), alive = useRef(true), postingRef = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function post() {
        if (postingRef.current) return;
        postingRef.current = true;
        setPosting(true);
        let accepted = false;
        try {
            const submitted = structuredClone({ draft, slots });
            let analysis = submitted.draft.analysis;
            const edited = analysis.title !== initial.current.title || analysis.summary !== initial.current.summary;
            if (edited && analysis.language !== 'en') {
                const translate = async (text: string) => {
                    try { return await assistant.translate(text, analysis.language, 'en'); }
                    catch { return null; }
                };
                const [title, summary] = await Promise.all([translate(analysis.title), translate(analysis.summary)]);
                // Keep the person's actual words when translation is unavailable, never stale draft wording.
                analysis = { ...analysis, titleEnglish: title ?? analysis.title, summaryEnglish: summary ?? analysis.summary };
            }
            if (!alive.current) return;
            accepted = onPost(submitted.slots, analysis);
        } finally {
            if (!accepted) {
                postingRef.current = false;
                if (alive.current) setPosting(false);
            }
        }
    }
    return <div className="c-stack">
        {embedded ? <header className="c-heading"><h2 ref={previewHeading} tabIndex={-1}>{t('c.job.preview')}</h2><p>{t('c.job.previewBody')}</p></header> : <Heading intro={t('c.job.previewBody')}>{t('c.job.preview')}</Heading>}
        {editing ? <DraftEditor disabled={posting} analysis={draft.analysis} slots={slots} onChange={(analysis) => { if (!postingRef.current) onChange({ ...draft, analysis }); }} onSlots={(next) => { if (!postingRef.current) setSlots(next); }}/>
            : <JobCard analysis={draft.analysis} evidence={draft.evidence} slots={slots}/>}
        <Button disabled={posting || !draft.analysis.title.trim() || !draft.analysis.summary.trim() || !Number.isFinite(draft.analysis.estimatedMinutes) || draft.analysis.estimatedMinutes < 1} onClick={() => void post()}>{t(posting ? 'c.loading' : 'c.job.post')}</Button>
        <Button disabled={posting} kind="secondary" onClick={() => { if (!postingRef.current) setEditing(!editing); }}>{t(editing ? 'c.save' : 'c.job.change')}</Button>
    </div>;
}
