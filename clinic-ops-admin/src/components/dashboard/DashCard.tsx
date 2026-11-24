import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, GripVertical } from 'lucide-react';
import { cx } from '../../lib/format';
import { gripKeys, useDashLayout } from './Layout';

/**
 * Dashboard card (rule 70): bordered, 52px head with title · muted meta · optional action on the right.
 * Drag and place (owner, 2026-11-24): the title bar is the drag handle — a grip shows on hover; drop the card on
 * another card to swap them. Arrow keys on the grip move it with the keyboard. The title is the card's id.
 */
export function DashCard({ title, meta, action, children, className }: { title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const { dragging, over, cardProps, handleProps, moveBy } = useDashLayout();
  return (
    <section className={cx('dv-card', className, dragging === title && 'is-dragging', over === title && 'is-drop-target')} aria-label={title} data-card={title} {...cardProps(title)}>
      <header className="dv-card-head" {...handleProps(title)}>
        <span className="dv-card-grip" role="button" tabIndex={0} aria-label={`Move ${title} — drag, or use the arrow keys`} data-tooltip="Drag to move" onKeyDown={gripKeys(moveBy, title)}>
          <GripVertical size={14} strokeWidth={1.8} aria-hidden />
        </span>
        <h2 className="dv-card-title">{title}</h2>
        {meta ? <span className="dv-card-meta">{meta}</span> : null}
        <span className="spacer" />
        {action}
      </header>
      <div className="dv-card-body">{children}</div>
    </section>
  );
}

/** Blue "View all ›" link for a card's title row */
export function ViewAllLink({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    // Dashboard links open in a new tab so the dashboard stays where you left it (owner, 2026-11-24)
    <Link className="dv-link" to={to} target="_blank" rel="noopener noreferrer">
      {label}
      <ChevronRight size={14} strokeWidth={1.6} aria-hidden />
    </Link>
  );
}

/** "View all (7) ›" / "Show top 5" in a card's title row, so a chart shows its top rows and opens the rest in place. */
export function ViewAllToggle({ expanded, total, limit, onToggle }: { expanded: boolean; total: number; limit: number; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <button type="button" className="dv-link" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? `Show top ${limit}` : `View all (${total})`}
      <ChevronRight size={14} strokeWidth={1.6} aria-hidden className={cx('dv-link-chev', expanded && 'is-up')} />
    </button>
  );
}

/** Muted line for a card with nothing to draw */
export const CardEmpty = ({ children }: { children: ReactNode }) => <p className="dv-empty">{children}</p>;

/** KPI row: all cards on one line at every width (rule 100b) — compact cards, sideways scroll on phones, never a second row */
export function StatGrid({ children, label = 'Key figures' }: { children: ReactNode; label?: string }) {
  const n = Children.toArray(children).filter(isValidElement).length;
  return (
    <section className="dv-stat-grid" aria-label={label} style={{ ['--n' as string]: Math.max(n, 1) } as CSSProperties}>
      {children}
    </section>
  );
}
