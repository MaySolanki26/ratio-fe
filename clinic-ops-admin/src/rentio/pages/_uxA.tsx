/**
 * Page-layout helpers for the UX consistency round (fork A pages): URL-backed page tabs that follow
 * ?focus=, a "show top N / show all" list helper and a small pager. All built on the shared Tabs/Button.
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { Tabs } from '../../components/primitives/feedback';
import '../../styles/rentio-ux-a.css';

export interface PageTab<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/**
 * Page-level tabs kept in the URL (?tab=), so Back returns to the same tab. `focusTab` wins when a
 * link points at a record that lives in another tab.
 */
export function usePageTab<T extends string>(ids: readonly T[], fallback: T, focusTab?: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as T | null;
  const tab = asked && ids.includes(asked) ? asked : focusTab ?? fallback;
  const set = (t: T) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    next.delete('focus');
    setParams(next, { replace: true });
  };
  return [tab, set];
}

export function PageTabs<T extends string>({ tabs, value, onChange, label, children, extra }: { tabs: PageTab<T>[]; value: T; onChange: (t: T) => void; label: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="rt-pagetabs">
      <Tabs tabs={tabs} value={value} onChange={onChange} label={label} extra={extra} />
      <div className="rt-tabpanel" role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}>
        {children}
      </div>
    </div>
  );
}

/** Show the first `limit` items; a quiet button reveals the rest. Items in `keep` are always shown. */
export function useShowMore<T>(items: T[], limit: number, keep: (t: T) => boolean = () => false) {
  const [all, setAll] = useState(false);
  const visible = all || items.length <= limit ? items : items.filter((t, i) => i < limit || keep(t));
  const toggle =
    items.length > limit ? (
      <div className="rt-showmore">
        <Button variant="ghost" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all (${items.length})`}
        </Button>
      </div>
    ) : null;
  return { visible, toggle };
}

/** Simple pager for long logs (keeps one screen of rows). */
export function usePager<T>(items: T[], size: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(page, pages - 1);
  const rows = items.slice(p * size, p * size + size);
  const bar =
    pages > 1 ? (
      <div className="rt-pager" role="navigation" aria-label="Pages">
        <span className="muted small">
          {p * size + 1}–{Math.min(items.length, (p + 1) * size)} of {items.length}
        </span>
        <Button size="compact" onClick={() => setPage(p - 1)} disabledReason={p === 0 ? 'First page' : undefined}>
          Previous
        </Button>
        <Button size="compact" onClick={() => setPage(p + 1)} disabledReason={p >= pages - 1 ? 'Last page' : undefined}>
          Next
        </Button>
      </div>
    ) : null;
  return { rows, bar, reset: () => setPage(0) };
}
