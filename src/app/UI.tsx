import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './PhoneShell';
import { routeHash, type Route } from './routes';
import type { Navigate } from './PhoneShell';

export function IconTile({ name, tone = 'green', children }: { name?: string; tone?: 'green' | 'amber' | 'gray' | 'red'; children?: ReactNode }) {
  return <span className="icon-tile" data-tone={tone} aria-hidden="true">{children ?? <Icon name={name ?? 'rooms'} />}</span>;
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`primary ${props.className ?? ''}`} />; }
export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`secondary ${props.className ?? ''}`} />; }
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) { return <section className="list-section">{title ? <h2 className="section-label">{title}</h2> : null}<div className="list-group">{children}</div></section>; }
interface ListRowProps { title: string; subtitle?: ReactNode; icon?: string; leading?: ReactNode; trailing?: ReactNode; route?: Route; navigate?: Navigate; onClick?(): void; destructive?: boolean }
export function ListRow({ title, subtitle, icon, leading, trailing, route, navigate, onClick, destructive }: ListRowProps) {
  const content = <>{leading ?? (icon ? <IconTile name={icon} tone={destructive ? 'red' : 'green'} /> : null)}<span className="list-row-copy"><span className="list-row-title">{title}</span>{subtitle ? <span className="list-row-subtitle">{subtitle}</span> : null}</span>{trailing ? <span className="list-row-value">{trailing}</span> : null}<Icon name="chevron" /></>;
  return route ? <a className="list-row" href={routeHash(route)} onClick={(event) => { if (navigate) { event.preventDefault(); navigate(route); } }}>{content}</a> : <button className={`list-row${destructive ? ' destructive' : ''}`} onClick={onClick}>{content}</button>;
}
export function StatusPill({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'gray' }) { return <span className="status-pill" data-tone={tone}>{children}</span>; }
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) { return <progress className="progress-bar" value={value} max={max || 1} aria-label={label} />; }
export function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false }: { label: string; value: T | null; options: readonly { value: T; label: string }[]; onChange(value: T): void; disabled?: boolean }) {
  return <div className="segmented-control" role="group" aria-label={label}>{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
export function EmptyState({ icon, title, body, action, onAction }: { icon: string; title: string; body: string; action?: string; onAction?(): void }) { return <section className="empty-state card"><IconTile name={icon} /><h2>{title}</h2><p className="muted">{body}</p>{action ? <PrimaryButton onClick={onAction}>{action}</PrimaryButton> : null}</section>; }
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); heading.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><h2 id="sheet-title" tabIndex={-1} ref={heading}>{title}</h2>{children}</dialog>;
}
