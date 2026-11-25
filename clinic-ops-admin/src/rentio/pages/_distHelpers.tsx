/** Shared helpers for the distribution & sales screens (scoped labels, exact-source notices, previews). */
import type { ReactNode } from 'react';
import { InlineAlert } from '../../components/primitives/feedback';
import type { StockRow } from '../../domain/rentio/engine';
import { fmtKg, type Grams } from '../../domain/rentio/units';

/** "RT-001/A1-PK · A1 · 120 bags · 3,000 kg available" */
export const stockOptionLabel = (r: StockRow) => `${r.lotId} · ${r.lot.grade ?? r.lot.material}${r.lot.bagSize ? ` · ${Math.floor(r.available / r.lot.bagSize)} bags` : ''} · ${fmtKg(r.available)} available`;

/** Shown when a ?focus= link points at a record outside the actor's area (or no longer open). */
export function FocusMissing({ focus, found }: { focus?: string; found: boolean }) {
  if (!focus || found) return null;
  return <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>;
}

/** Live quantity preview: one key figure plus supporting figures. */
export function Preview({ items }: { items: { label: string; g: Grams; key?: boolean; tone?: 'danger' }[] }) {
  return (
    <div className="rt-preview" role="status" aria-live="polite">
      {items.map((x) => (
        <div key={x.label} className={x.key ? 'is-key' : undefined}>
          <span>{x.label}</span>
          <strong className={x.tone === 'danger' ? 'tone-text-danger' : undefined}>{fmtKg(x.g)}</strong>
        </div>
      ))}
    </div>
  );
}

export const Hint = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;
