/**
 * Owner dashboard graphs — two compact, zero-baseline stacked bars drawn from the SAME ledger rows as the
 * tables. Every segment is mutually exclusive, so a bar's total equals physical stock (or dispatched kg):
 *  1. Factory finished stock by grade: free to sell | reserved (shippable) | held or expired (incl. any
 *     reservation now at risk). Reserved and held are never stacked twice.
 *  2. Delivery outcome by distributor (factory shipments): received good | damaged held | on the road |
 *     open exception in transit (short / refused) | returned to factory | settled by approval.
 * Each chart has a legend, units, an accessible table equivalent and drill-through links.
 */
import { Link } from 'react-router-dom';
import type { StockRow } from '../../domain/rentio/engine';
import type { RentioState } from '../../domain/rentio/types';
import { fmtKg, type Grams, sum } from '../../domain/rentio/units';
import { Details } from '../ui';

interface Seg {
  key: string;
  label: string;
  color: string;
}
interface Bar {
  id: string;
  label: string;
  to: string;
  values: Record<string, Grams>;
}

function StackedBars({ title, caption, segs, bars, unit = 'kg', empty }: { title: string; caption: string; segs: Seg[]; bars: Bar[]; unit?: string; empty: string }) {
  const total = (b: Bar) => sum(segs.map((s) => b.values[s.key] ?? 0));
  const max = Math.max(1, ...bars.map(total));
  return (
    <figure className="rt-chart" aria-label={title}>
      <figcaption className="rt-chart-head">
        <strong>{title}</strong>
        <span className="muted small">{caption}</span>
      </figcaption>
      <ul className="rt-chart-legend" aria-label="Legend">
        {segs.map((s) => (
          <li key={s.key}>
            <span className="rt-chart-swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      {bars.length === 0 ? (
        <p className="rt-empty">{empty}</p>
      ) : (
        <div className="rt-chart-rows" aria-hidden="true">
          {bars.map((b) => (
            <Link key={b.id} to={b.to} className="rt-chart-row" tabIndex={-1}>
              <span className="rt-chart-label">{b.label}</span>
              <span className="rt-chart-track">
                {segs.map((s) => {
                  const v = b.values[s.key] ?? 0;
                  return v > 0 ? <span key={s.key} className="rt-chart-seg" style={{ width: `${(v * 100) / max}%`, background: s.color }} title={`${s.label}: ${fmtKg(v)}`} /> : null;
                })}
              </span>
              <span className="rt-chart-total">{fmtKg(total(b))}</span>
            </Link>
          ))}
          <div className="rt-chart-axis">
            <span>0 {unit}</span>
            <span>{fmtKg(max)}</span>
          </div>
        </div>
      )}
      {bars.length > 0 && (
        <Details summary="Show as table (same figures)">
          <table className="rt-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{title.includes('grade') ? 'Grade' : 'Distributor'}</th>
                {segs.map((s) => (
                  <th key={s.key} scope="col" className="num">{s.label}</th>
                ))}
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.id}>
                  <th scope="row">
                    <Link to={b.to}>{b.label}</Link>
                  </th>
                  {segs.map((s) => (
                    <td key={s.key} className="num">{fmtKg(b.values[s.key] ?? 0)}</td>
                  ))}
                  <td className="num"><strong>{fmtKg(total(b))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Details>
      )}
    </figure>
  );
}

/** Finished stock by grade — exclusive split of physical kg in F1. */
export function FinishedByGradeChart({ fin, base }: { fin: StockRow[]; base: string }) {
  const grades = [...new Set(fin.map((r) => r.lot.grade ?? '—'))].sort();
  const bars: Bar[] = grades.map((g) => {
    const rs = fin.filter((r) => (r.lot.grade ?? '—') === g);
    const sell = rs.filter((r) => r.sellable);
    const blocked = rs.filter((r) => !r.sellable);
    return { id: g, label: g, to: `${base}/stock/godowns`, values: { free: sum(sell.map((r) => r.available)), reserved: sum(sell.map((r) => r.reserved)), held: sum(blocked.map((r) => r.qty)) } };
  });
  const atRisk = sum(fin.map((r) => r.reservedAtRisk));
  return (
    <StackedBars
      title="Factory finished stock by grade"
      caption={`kg in F1 · each bar = physical stock${atRisk ? ` · held includes ${fmtKg(atRisk)} reserved on held stock (at risk)` : ''}`}
      segs={[
        { key: 'free', label: 'Free to sell', color: 'var(--s-success)' },
        { key: 'reserved', label: 'Reserved (shippable)', color: 'var(--s-info)' },
        { key: 'held', label: 'Held / expired', color: 'var(--s-warning)' },
      ]}
      bars={bars}
      empty="No finished stock in F1."
    />
  );
}

/** Delivery outcome per distributor from factory shipments — exclusive split of dispatched kg. */
export function DeliveryOutcomeChart({ s, base, visible }: { s: RentioState; base: string; visible: (distributorId: string) => boolean }) {
  const left = new Map<string, Grams>();
  const returned = new Map<string, Grams>();
  for (const m of s.movements) {
    if (m.to?.startsWith('TRN:')) left.set(m.to, (left.get(m.to) ?? 0) + m.qty);
    if (m.from?.startsWith('TRN:')) {
      left.set(m.from, (left.get(m.from) ?? 0) - m.qty);
      if (m.kind === 'return-receive') returned.set(m.from, (returned.get(m.from) ?? 0) + m.qty);
    }
  }
  const by = new Map<string, Record<string, Grams>>();
  for (const sh of s.shipments.filter((x) => x.toDistributor && !x.fromDistributor && visible(x.toDistributor))) {
    const d = sh.toDistributor!;
    const v = by.get(d) ?? { good: 0, damaged: 0, road: 0, exception: 0, returned: 0, settled: 0 };
    const shipped = sum(sh.lines.map((l) => l.qty));
    const open = Math.max(0, left.get(sh.transitLoc) ?? 0);
    const ret = returned.get(sh.transitLoc) ?? 0;
    const good = sh.receipt?.good ?? 0;
    const dmg = sh.receipt?.damaged ?? 0;
    v.good += good;
    v.damaged += dmg;
    if (sh.receipt) v.exception += open;
    else v.road += open;
    v.returned += ret;
    v.settled += Math.max(0, shipped - good - dmg - open - ret);
    by.set(d, v);
  }
  const bars: Bar[] = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, values]) => ({ id: d, label: d, to: `${base}/distribution/distributors?d=${d}`, values }));
  return (
    <StackedBars
      title="Delivery outcome by distributor"
      caption="kg dispatched from the factory · physical delivery only (payment is tracked by Accounts)"
      segs={[
        { key: 'good', label: 'Received good', color: 'var(--s-success)' },
        { key: 'damaged', label: 'Damaged (held)', color: 'var(--s-warning)' },
        { key: 'road', label: 'On the road', color: 'var(--s-info)' },
        { key: 'exception', label: 'Short / refused — in transit', color: 'var(--s-danger)' },
        { key: 'returned', label: 'Returned to factory', color: 'var(--s-text-muted)' },
        { key: 'settled', label: 'Settled by approval', color: 'var(--s-border-strong)' },
      ]}
      bars={bars}
      empty="No factory shipments yet."
    />
  );
}
