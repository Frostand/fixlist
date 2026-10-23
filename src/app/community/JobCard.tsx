import { useEffect, useState } from 'react';
import type { Account, AvailabilitySlot, JobAnalysis, Language, ScanEvidence } from '../../community/types';
import { TOOLS } from '../../community/types';
import { assistant } from '../../lib/assistant';
import { LANGUAGES, useLanguage, useT } from '../../i18n';
import { Availability, Button, Chips, Icon, skillLabel, slotLabel, toolLabel } from './UI';
export function EvidencePhoto({ evidence, caption = true }: {
    evidence: ScanEvidence;
    caption?: boolean;
}) { const t = useT(); return <figure className="c-evidence">{evidence.thumbnail ? <div className="c-photo"><img src={evidence.thumbnail} alt={t('c.job.photo', { label: evidence.label })}/>{evidence.point ? <span className="c-photo-marker" role="img" aria-label={t('c.job.marker')} style={{ left: `${100 * evidence.point.u}%`, top: `${100 * evidence.point.v}%` }}>+</span> : null}</div> : <p>{t('c.job.noPhoto')}</p>}{caption ? <figcaption>{evidence.label}</figcaption> : null}</figure>; }
export function JobCard({ analysis, evidence = [], slots = [], original = false }: {
    analysis: JobAnalysis;
    evidence?: readonly ScanEvidence[];
    slots?: readonly AvailabilitySlot[];
    original?: boolean;
}) {
    const t = useT(), language = useLanguage();
    const [translation, setTranslation] = useState<{
        title: string;
        summary: string;
    } | null>(null);
    useEffect(() => { let current = true; setTranslation(null); if (!original && language !== analysis.language && language !== 'en')
        void Promise.all([assistant.translate(analysis.title, analysis.language, language), assistant.translate(analysis.summary, analysis.language, language)]).then(([title, summary]) => { if (current && title && summary)
            setTranslation({ title, summary }); }).catch(() => { }); return () => { current = false; }; }, [analysis.title, analysis.summary, analysis.language, language, original]);
    const native = original || language === analysis.language;
    const title = native ? analysis.title : translation?.title ?? analysis.titleEnglish, summary = native ? analysis.summary : translation?.summary ?? analysis.summaryEnglish;
    return <article className="c-job-card"><h2 lang={native ? analysis.language : translation ? language : analysis.titleEnglish === analysis.title ? analysis.language : 'en'}>{title}</h2>{native && analysis.language !== 'en' && analysis.title !== analysis.titleEnglish ? <p className="c-small" lang="en">{analysis.titleEnglish}</p> : null}<p lang={native ? analysis.language : translation ? language : analysis.summaryEnglish === analysis.summary ? analysis.language : 'en'}>{summary}</p><div className="c-job-facts"><span><Icon name="clock"/>{t('c.job.time', { minutes: analysis.estimatedMinutes })}</span><span><Icon name="person"/>{t(analysis.peopleNeeded === 1 ? 'c.job.person' : 'c.job.people', { count: analysis.peopleNeeded })}</span></div>{analysis.tools.length ? <div><h3>{t('c.job.tools')}</h3><ul className="c-tags">{analysis.tools.map((x) => <li key={x}>{toolLabel(t, x)}</li>)}</ul></div> : null}<div><h3>{t('c.job.skills')}</h3><ul className="c-tags">{analysis.skills.map((s) => <li key={s}>{skillLabel(t, s)}</li>)}</ul></div><div><h3>{t('c.job.when')}</h3>{slots.length ? <ul className="c-tags">{slots.map((s) => <li key={`${s.day}-${s.part}`}>{slotLabel(t, s)}</li>)}</ul> : <p>{t('c.job.flexible')}</p>}</div>{analysis.safetyNotes.length ? <div className="c-safety"><h3>{t('c.job.safety')}</h3><ul>{analysis.safetyNotes.map((note, i) => <li key={i}>{note}</li>)}</ul></div> : null}{evidence.length ? <section><h3>{t('c.job.spot')}</h3>{evidence.map((e) => <EvidencePhoto key={e.flagId} evidence={e}/>)}</section> : null}<p className="c-engine"><Icon name="help" size={18}/>{t(analysis.engine === 'apple-on-device' ? 'c.job.ai' : 'c.job.rules')}</p></article>;
}
export function OriginalToggle({ language, original, onChange }: {
    language: Language;
    original: boolean;
    onChange(value: boolean): void;
}) { const t = useT(); return <Button kind="quiet" onClick={() => onChange(!original)}>{original ? t('c.job.translated') : t('c.job.original', { language: LANGUAGES.find((x) => x.code === language)?.nativeName })}</Button>; }
export function DraftEditor({ analysis, slots, onChange, onSlots }: {
    analysis: JobAnalysis;
    slots: readonly AvailabilitySlot[];
    onChange(a: JobAnalysis): void;
    onSlots(s: AvailabilitySlot[]): void;
}) { const t = useT(); return <div className="c-stack"><label className="c-field">{t('c.job.title')}<input value={analysis.title} maxLength={140} onChange={(e) => onChange({ ...analysis, title: e.target.value, ...(analysis.language === 'en' ? { titleEnglish: e.target.value } : {}) })}/></label><label className="c-field">{t('c.job.summary')}<textarea value={analysis.summary} maxLength={1200} onChange={(e) => onChange({ ...analysis, summary: e.target.value, ...(analysis.language === 'en' ? { summaryEnglish: e.target.value } : {}) })}/></label><label className="c-field">{t('c.job.minutes')}<input type="number" min={5} max={480} step={5} value={analysis.estimatedMinutes} onChange={(e) => onChange({ ...analysis, estimatedMinutes: Number(e.target.value) })}/></label><Chips title={t('c.job.tools')} values={TOOLS} selected={analysis.tools} label={(x) => toolLabel(t, x)} onChange={(tools) => onChange({ ...analysis, tools })}/><Availability value={slots} onChange={onSlots}/></div>; }

/** Public requester context only; address stays behind the domain visibility query. */
export function Requester({ elder, needs = [], language }: { elder: Account; needs?: readonly string[]; language: Language }) {
    const t = useT(), viewerLanguage = useLanguage();
    const sourceLanguage = LANGUAGES.find(l => l.code === language)!;
    return <div className="c-requester"><p><strong><bdi>{t('c.job.requester', { name: elder.firstName, area: elder.area })}</bdi></strong></p>
        {needs.length || language !== viewerLanguage ? <ul className="c-tags">{needs.map(need => <li key={need}>{need}</li>)}
            {language !== viewerLanguage ? <li>{t('c.job.askedIn', { language: sourceLanguage.nativeName })}</li> : null}</ul> : null}
    </div>;
}
