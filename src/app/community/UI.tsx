import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AvailabilitySlot, DayPart, MatchGap, MatchReason, Skill, Tool, Weekday } from '../../community/types';
import { LANGUAGES, useT, type Translator } from '../../i18n';
export type IconName = 'mic' | 'home' | 'help' | 'room' | 'pin' | 'person' | 'arrow' | 'back' | 'check' | 'clock' | 'message' | 'tools' | 'leaf' | 'mail' | 'close' | 'print' | 'shield' | 'replay';
const paths: Record<IconName, ReactNode> = {
    replay: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><path d="m10 9 5 3-5 3z"/></>,
    mic: <><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    home: <><path d="m3 10 9-7 9 7v11H3zM9 21v-8h6v8"/></>,
    help: <><path d="M4 5h16v15H4zM8 3v4M16 3v4M8 11h8M8 15h5"/></>,
    room: <><path d="M4 21V4h13v17M2 21h20M17 6h4v15M13 12h.01"/></>,
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    person: <><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    back: <path d="M20 12H4m6-6-6 6 6 6"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    message: <path d="M21 4H3v13h5l4 4 4-4h5zM7 9h10M7 13h6"/>,
    tools: <path d="m14 5 5 5M3 21l7-7M15 3l6 6-4 4-6-6zM4 3l4 4-1 3 14 11M3 4l4 4"/>,
    leaf: <><path d="M20 3c-12-1-18 7-13 13s14 0 13-13ZM4 21 16 9"/></>,
    mail: <path d="M3 5h18v14H3zM3 5l9 8 9-8"/>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    print: <><path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 13h12v8H6z"/></>,
    shield: <><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6"/></>,
};
export function Icon({ name, size = 24 }: {
    name: IconName;
    size?: number;
}) { return <svg className={`c-icon ${name === 'back' || name === 'arrow' ? 'c-directional' : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
export function Button({ children, kind = 'primary', icon, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
    kind?: 'primary' | 'secondary' | 'quiet' | 'clay';
    icon?: IconName;
}) { return <button type="button" className={`c-button c-${kind} ${className}`} {...rest}>{icon ? <Icon name={icon}/> : null}{children}</button>; }
export function Heading({ children, intro }: {
    children: ReactNode;
    intro?: ReactNode;
}) { const ref = useRef<HTMLHeadingElement>(null); useEffect(() => { ref.current?.focus(); }, [children]); return <header className="c-heading"><h1 ref={ref} tabIndex={-1} data-screen-heading>{children}</h1>{intro ? <p>{intro}</p> : null}</header>; }
export function Back({ onClick }: {
    onClick(): void;
}) { const t = useT(); return <Button kind="quiet" icon="back" onClick={onClick}>{t('c.back')}</Button>; }
export function Sheet({ title, children, onClose }: {
    title: string;
    children: ReactNode;
    onClose(): void;
}) {
    const ref = useRef<HTMLDialogElement>(null), id = useId();
    const t = useT();
    useEffect(() => { const dialog = ref.current; const before = document.activeElement; if (dialog && !dialog.open)
        dialog.showModal(); return () => { dialog?.close(); if (before instanceof HTMLElement && before.isConnected)
        before.focus(); }; }, []);
    return <dialog ref={ref} className="c-sheet" aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget)
        onClose(); }}><div className="c-sheet-content"><div className="c-sheet-top"><h2 id={id}>{title}</h2><Button kind="quiet" icon="close" onClick={onClose}>{t('c.close')}</Button></div>{children}</div></dialog>;
}
export function Avatar({ name, tone = 'sage' }: {
    name: string;
    tone?: string;
}) { return <span className={`c-avatar c-tone-${tone}`} aria-hidden="true">{name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>; }
export function LanguageSelect({ value, onChange }: {
    value: import('../../community/types').Language;
    onChange(value: import('../../community/types').Language): void;
}) { const t = useT(); return <label className="c-field">{t('c.language')}<select value={value} onChange={(e) => onChange(e.target.value as typeof value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>{l.nativeName}</option>)}</select></label>; }
export const skillLabel = (t: Translator, id: Skill) => t(`c.skill.${id}`);
export const toolLabel = (t: Translator, id: Tool) => t(`c.tool.${id}`);
export const slotLabel = (t: Translator, slot: AvailabilitySlot) => t('c.slot.label', { day: t(`c.slot.day${slot.day}`), part: t(`c.slot.${slot.part}`) });
export function Chips<T extends string>({ values, selected, label, onChange, title }: {
    values: readonly T[];
    selected: readonly T[];
    label(value: T): string;
    onChange(values: T[]): void;
    title: string;
}) { return <fieldset className="c-fieldset"><legend>{title}</legend><div className="c-chips">{values.map((x) => <button type="button" className="c-chip" key={x} aria-pressed={selected.includes(x)} onClick={() => onChange(selected.includes(x) ? selected.filter((v) => v !== x) : [...selected, x])}>{selected.includes(x) ? <Icon name="check" size={18}/> : null}{label(x)}</button>)}</div></fieldset>; }
const days: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const parts: DayPart[] = ['morning', 'afternoon', 'evening'];
export function Availability({ value, onChange }: {
    value: readonly AvailabilitySlot[];
    onChange(value: AvailabilitySlot[]): void;
}) { const t = useT(); return <fieldset className="c-fieldset"><legend>{t('c.setup.availability')}</legend><div className="c-availability">{days.map((day) => <div className="c-day" key={day}><strong>{t(`c.slot.day${day}`)}</strong>{parts.map((part) => { const selected = value.some((s) => s.day === day && s.part === part); return <button type="button" key={part} aria-label={slotLabel(t, { day, part })} aria-pressed={selected} onClick={() => onChange(selected ? value.filter((s) => s.day !== day || s.part !== part) : [...value, { day, part }])}>{selected ? <Icon name="check" size={16}/> : null}{t(`c.slot.${part}`)}</button>; })}</div>)}</div></fieldset>; }
export function MatchChips({ reasons, gaps = [], maxMiles = 10 }: {
    reasons: readonly MatchReason[];
    gaps?: readonly MatchGap[];
    maxMiles?: number;
}) {
    const t = useT();
    const text = (r: MatchReason | MatchGap): string => {
        switch (r.kind) {
            case 'skill': return t(`c.match.can.${r.skill}`);
            case 'tool': return t(`c.match.has.${r.tool}`);
            case 'available': return t('c.match.available', { slot: slotLabel(t, r.slot) });
            case 'distance': return t('c.match.distance', { miles: r.miles });
            case 'rating': return t('c.match.rating', { stars: r.stars.toFixed(1) });
            case 'language': return t('c.match.language', { language: LANGUAGES.find((l) => l.code === r.language)?.nativeName });
            case 'missing-skill': return t('c.match.missingSkill', { skill: skillLabel(t, r.skill).toLocaleLowerCase(t.language) });
            case 'missing-tool': return t('c.match.missingTool', { tool: toolLabel(t, r.tool).toLocaleLowerCase(t.language) });
            case 'no-shared-time': return t('c.match.noTime');
            case 'too-far': return t('c.match.tooFar', { maxMiles });
        }
    };
    return <ul className="c-tags">{reasons.map((r, i) => <li key={`r${i}`}>{text(r)}</li>)}{gaps.map((g, i) => <li className="c-gap" key={`g${i}`}>{text(g)}</li>)}</ul>;
}
