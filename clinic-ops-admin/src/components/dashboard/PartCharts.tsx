import { useMemo } from 'react';
import { compact, shareOf, softFill } from './chartColors';

/** One part of a whole, for the donut, pie and waffle */
export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Own colour (e.g. a meaning colour); default the next palette slot */
  color?: string;
}

const fillOf = (slice: Slice, index: number): string => slice.color ?? softFill(index);
/** Shade by position among the slices that have a value, so the first real slice always gets the strongest shade */
const shadeSlices = (slices: Slice[]): Slice[] => {
  let k = 0;
  return slices.map((s) => (s.color || !s.value ? s : { ...s, color: softFill(k++) }));
};
const ZERO_DOT = 'color-mix(in srgb, var(--s-text) 15%, var(--s-panel))';

/** Grey strip with the total, under a pie / waffle / donut */
const TotalStrip = ({ label, total }: { label: string; total: number }) => (
  <p className="dv-total-strip">
    <span>{label}</span>
    <strong>{compact(total)}</strong>
  </p>
);

/* ─────────────────────────────── Donut ─────────────────────────────── */

const D_RADIUS = 84;
const D_STROKE = 30;
const D_SIZE = (D_RADIUS + D_STROKE / 2 + 4) * 2;
const D_CENTER = D_SIZE / 2;
const D_GAP = 3;
const D_CORNER = 4;

const dPoint = (angle: number, radius: number): string => `${(D_CENTER + radius * Math.sin(angle)).toFixed(2)} ${(D_CENTER - radius * Math.cos(angle)).toFixed(2)}`;

/** One ring slice with rounded corners: drawn CORNER smaller, then a round-joined stroke grows it back */
const ringPath = (from: number, to: number): string => {
  const outer = D_RADIUS + D_STROKE / 2 - D_CORNER;
  const inner = D_RADIUS - D_STROKE / 2 + D_CORNER;
  const half = (to - from) / 2;
  const insetOuter = Math.min(D_CORNER / outer, half);
  const insetInner = Math.min(D_CORNER / inner, half);
  const large = to - from - 2 * insetOuter > Math.PI ? 1 : 0;
  return (
    `M${dPoint(from + insetOuter, outer)} A${outer} ${outer} 0 ${large} 1 ${dPoint(to - insetOuter, outer)} ` +
    `L${dPoint(to - insetInner, inner)} A${inner} ${inner} 0 ${large} 0 ${dPoint(from + insetInner, inner)} Z`
  );
};

/**
 * Donut for part-to-whole status (rules 73, 75): thick pastel slices with rounded corners and a gap between them,
 * the total in the middle, a Name / Count / Share table beside it. Hover dims the other slices; slices sweep in
 * one after another (rule 87). Zero slices stay in the table with a grey dot.
 */
export function DonutChart({ slices: raw, totalLabel, legendTitle, ariaLabel, onSliceClick, footerLabel, summary }: { slices: Slice[]; totalLabel: string; legendTitle: string; ariaLabel: string; onSliceClick?: (key: string) => void; footerLabel?: string; /** One quiet line under the chart answering the card's question, e.g. "79% completed · 19% lost" */ summary?: string }) {
  const slices = shadeSlices(raw);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const shown = slices.filter((s) => s.value > 0).length;
  const segs = useMemo(() => {
    const turns = slices.map((s) => (total ? (s.value / total) * Math.PI * 2 : 0));
    const gap = shown > 1 ? D_GAP / D_RADIUS : 0;
    let start = 0;
    return slices.map((s, i) => {
      const seg = { ...s, i, from: start + gap / 2, to: start + turns[i] - gap / 2 };
      start += turns[i];
      return seg;
    });
  }, [slices, total, shown]);

  return (
    <div className="dv-part">
      <div className="dv-part-row">
        <svg key={slices.map((s) => s.value).join('|')} className="dv-donut-svg" viewBox={`0 0 ${D_SIZE} ${D_SIZE}`} role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
          {total === 0 && <circle cx={D_CENTER} cy={D_CENTER} r={D_RADIUS} fill="none" stroke="var(--c-chart-track)" strokeWidth={D_STROKE} />}
          {shown === 1
            ? (() => {
                const only = segs.find((s) => s.value > 0)!;
                return <circle className="dv-seg" cx={D_CENTER} cy={D_CENTER} r={D_RADIUS} fill="none" stroke={fillOf(only, only.i)} strokeWidth={D_STROKE} data-tooltip={`${only.label}: ${only.value} (100%)`} />;
              })()
            : segs.map((s) =>
                s.value > 0 ? (
                  <path
                    key={s.key}
                    className="dv-seg"
                    style={{ ['--i' as string]: s.i }}
                    d={ringPath(s.from, s.to)}
                    fill={fillOf(s, s.i)}
                    stroke={fillOf(s, s.i)}
                    strokeWidth={D_CORNER * 2}
                    strokeLinejoin="round"
                    data-tooltip={`${s.label}: ${s.value} (${shareOf(s.value, total)})`}
                  />
                ) : null,
              )}
          <text x="50%" y="50%" textAnchor="middle" className="dv-donut-total">
            {compact(total)}
          </text>
          <text x="50%" y="61%" textAnchor="middle" className="dv-donut-caption">
            {totalLabel.charAt(0).toUpperCase() + totalLabel.slice(1)}
          </text>
        </svg>
        <table className="dv-legend-table">
          <thead>
            <tr>
              <th>{legendTitle}</th>
              <th className="num">Count</th>
              <th className="num">Share</th>
              
            </tr>
          </thead>
          <tbody>
            {slices.map((s, i) => {
              const name = (
                <>
                  <span className="dv-dot is-lg" style={{ background: s.value ? fillOf(s, i) : ZERO_DOT }} aria-hidden />
                  <span className="truncate">{s.label}</span>
                </>
              );
              return (
                <tr key={s.key} className={s.value ? undefined : 'is-zero'}>
                  <td>
                    {onSliceClick ? (
                      <button type="button" className="dv-legend-name is-btn" onClick={() => onSliceClick(s.key)}>
                        {name}
                      </button>
                    ) : (
                      <span className="dv-legend-name">{name}</span>
                    )}
                  </td>
                  <td className="num strong">{compact(s.value)}</td>
                  <td className="num muted">{shareOf(s.value, total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footerLabel ? <TotalStrip label={footerLabel} total={total} /> : null}
      {summary ? <p className="dv-part-summary">{summary}</p> : null}
    </div>
  );
}

/* ─────────────────────────────── Pie ─────────────────────────────── */

const P_SIZE = 200;
const P_CENTER = P_SIZE / 2;
const P_RADIUS = 92;
const P_PULL = 2.5;
const P_MIN_LABEL = 0.06;

const pPoint = (angle: number, radius: number, dx = 0, dy = 0): [number, number] => [P_CENTER + dx + radius * Math.sin(angle), P_CENTER + dy - radius * Math.cos(angle)];
const pStr = ([x, y]: [number, number]) => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** Pie for a top-N mix (rule 75): slices pulled slightly apart, share written inside, Name / Value / Share table, total strip. */
export function PieChart({ slices, ariaLabel, nameTitle, valueTitle, totalLabel, summary }: { slices: Slice[]; ariaLabel: string; nameTitle: string; valueTitle: string; totalLabel: string; /** One quiet line under a hairline (like the donut), instead of the grey total strip */ summary?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const wedges = useMemo(() => {
    let from = 0;
    return slices.map((s, i) => {
      const turn = total ? (s.value / total) * Math.PI * 2 : 0;
      const to = from + turn;
      const mid = (from + to) / 2;
      const dx = P_PULL * Math.sin(mid);
      const dy = -P_PULL * Math.cos(mid);
      const large = turn > Math.PI ? 1 : 0;
      const d = `M${pStr(pPoint(0, 0, dx, dy))} L${pStr(pPoint(from, P_RADIUS, dx, dy))} A${P_RADIUS} ${P_RADIUS} 0 ${large} 1 ${pStr(pPoint(to, P_RADIUS, dx, dy))} Z`;
      const [lx, ly] = pPoint(mid, P_RADIUS * 0.62, dx, dy);
      const w = { ...s, i, d, lx, ly, share: total ? s.value / total : 0 };
      from = to;
      return w;
    });
  }, [slices, total]);
  const single = wedges.filter((w) => w.value > 0).length === 1;

  return (
    <div className="dv-part">
      <div className="dv-part-row">
        <svg key={slices.map((s) => s.value).join('|')} className="dv-donut-svg" viewBox={`0 0 ${P_SIZE} ${P_SIZE}`} role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
          {total === 0 && <circle cx={P_CENTER} cy={P_CENTER} r={P_RADIUS} fill="var(--c-chart-track)" />}
          {wedges.map((w) =>
            w.value > 0 ? (
              <g key={w.key} className="dv-seg" style={{ ['--i' as string]: w.i }} data-tooltip={`${w.label}: ${w.value} (${shareOf(w.value, total)})`}>
                {single ? <circle cx={P_CENTER} cy={P_CENTER} r={P_RADIUS} fill={fillOf(w, w.i)} /> : <path d={w.d} fill={fillOf(w, w.i)} />}
                {(single || w.share >= P_MIN_LABEL) && (
                  <text x={single ? P_CENTER : w.lx} y={single ? P_CENTER : w.ly} textAnchor="middle" dominantBaseline="central" className="dv-pie-label">
                    {shareOf(w.value, total)}
                  </text>
                )}
              </g>
            ) : null,
          )}
        </svg>
        <table className="dv-legend-table">
          <thead>
            <tr>
              <th>{nameTitle}</th>
              <th className="num">{valueTitle}</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s, i) => (
              <tr key={s.key} className={s.value ? undefined : 'is-zero'}>
                <td>
                  <span className="dv-legend-name">
                    <span className="dv-dot is-lg" style={{ background: s.value ? fillOf(s, i) : ZERO_DOT }} aria-hidden />
                    <span className="truncate">{s.label}</span>
                  </span>
                </td>
                <td className="num strong">{compact(s.value)}</td>
                <td className="num muted">{shareOf(s.value, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* same footing as the donut (owner, 2026-11-24): whole %, a summary line under a hairline — no grey strip */}
      {summary ? <p className="dv-part-summary">{summary}</p> : <TotalStrip label={totalLabel} total={total} />}
    </div>
  );
}

/* ─────────────────────────────── Waffle ─────────────────────────────── */

const W_COLS = 10;
const W_ROWS = 5;
const W_CELLS = W_COLS * W_ROWS; // each square = 2%

/** Squares per part, in proportion, adding up to exactly W_CELLS (largest remainder) */
const cellCounts = (values: number[], total: number): number[] => {
  if (!total) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * W_CELLS);
  const counts = exact.map(Math.floor);
  const left = W_CELLS - counts.reduce((s, c) => s + c, 0);
  exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest)
    .slice(0, left)
    .forEach(({ i }) => {
      counts[i] += 1;
    });
  return counts;
};

/** Waffle for a few parts of one whole (e.g. payer mix): 50 rounded squares in proportion, a count + share list, total strip. */
export function WaffleChart({ slices, ariaLabel, totalLabel, compact: small = false }: { slices: Slice[]; ariaLabel: string; totalLabel: string; /** Smaller squares, no total strip (the total goes in the card meta) */ compact?: boolean }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const counts = cellCounts(
    slices.map((s) => s.value),
    total,
  );
  const cells = counts.flatMap((count, i) => Array.from({ length: count }, () => i));
  return (
    <div className={small ? 'dv-part is-compact' : 'dv-part'}>
      <div className="dv-part-row is-wrap">
        <div
          role="img"
          aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value} (${shareOf(s.value, total, 1)})`).join(', ')}`}
          className="dv-waffle"
          key={slices.map((s) => s.value).join('|')}
          style={{ gridTemplateColumns: `repeat(${W_COLS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: W_CELLS }, (_, c) => {
            const i = cells[c];
            const s = i === undefined ? undefined : slices[i];
            return <span key={c} className="dv-waffle-cell" style={{ background: s ? fillOf(s, i) : 'var(--c-chart-track)', ['--i' as string]: c }} data-tooltip={s ? `${s.label}: ${s.value} (${shareOf(s.value, total, 1)})` : undefined} />;
          })}
        </div>
        <ul className="dv-waffle-list">
          {slices.map((s, i) => (
            <li key={s.key}>
              <span className="dv-legend-name">
                <span className="dv-square" style={{ background: s.value ? fillOf(s, i) : ZERO_DOT }} aria-hidden />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="dv-waffle-val">
                <strong>{compact(s.value)}</strong>
                <span className="muted"> ({shareOf(s.value, total, 1)})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {small ? null : <TotalStrip label={totalLabel} total={total} />}
    </div>
  );
}
