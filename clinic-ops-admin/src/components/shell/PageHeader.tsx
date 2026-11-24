import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { clinicModules } from '../../domain/clinic/pack';
import { createPortal } from 'react-dom';
import { InfoTip } from '../primitives/InfoTip';

export { InfoTip };

export const TOPBAR_TITLE_SLOT = 'topbar-title';

/**
 * Page header (project rule): the page title + ⓘ description tooltip render in the
 * TOP BAR (left), not in the page. No breadcrumb row. Optional `actions` render as
 * a right-aligned row in the page; list pages put their actions in the view toolbar.
 * `crumbs` is accepted for API compatibility but not rendered.
 */
export function PageHeader({ title, description, actions, onBack, backLabel }: { title: string; description?: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode; onBack?: () => void; /** Name of the previous page — shown as the path link (no back arrow, owner rule 71). */ backLabel?: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Page path (owner rules 71/73): shown only INSIDE something — the previous page links back; list pages show just the title
  const { pathname } = useLocation();
  const parts = pathname.split('/');
  const mod = clinicModules.find((m) => m.id === parts[5] && m.id !== 'home');
  useLayoutEffect(() => setSlot(document.getElementById(TOPBAR_TITLE_SLOT)), []);
  useEffect(() => {
    document.title = `${title} · Clinic Operations Admin`;
  }, [title]);
  return (
    <>
      {slot &&
        createPortal(
          <>
            {onBack ? (
              // the previous page is the path link — no separate back arrow (owner rule 71)
              <nav className="page-path" aria-label="Breadcrumb">
                <button type="button" className="page-path-link" onClick={onBack}>
                  {backLabel ?? mod?.label ?? 'Back'}
                </button>
                <span aria-hidden="true">/</span>
              </nav>
            ) : null}
            <h1 className="page-title">{title}</h1>
            {/* Owner rule (latest): no ⓘ next to page titles; the description stays available to screen readers */}
            {description && <span className="sr-only">{description}</span>}
          </>,
          slot,
        )}
      {actions && (
        <div className="page-header">
          <div className="page-actions">{actions}</div>
        </div>
      )}
    </>
  );
}

