import { useId, useState, type ReactNode } from 'react';
import { ACCENT, SECOND_SERIES, compact, paletteSlot, useWidth } from './chartColors';
import { pageZoom } from '../../lib/zoom';

export interface TrendSeries {
  key: string;
  label: string;
  /** Own line colour (e.g. green for Completed); default the next palette colour */
  color?: string;
}

export type TrendPoint = { key: string; label: string } & Record<string, number | string>;

const HEIGHT = 260;
const M = { top: 34, right: 28, bottom: 26, left: 40 };

/** Lines are drawn thin and soft (owner, 2026-11-24: as light as the button / card borders, never bold) */
const soft = (c: string) => `color-mix(in srgb, ${c} 72%, var(--s-panel))`;
/** Main series in the accent, comparison series in a lighter accent shade */
const colorOf = (s: TrendSeries, i: number) => s.color ?? (i === 0 ? ACCENT : i === 1 ? SECOND_SERIES : paletteSlot(i));
/** Points get a dot only while they stay readable */
const MAX_DOTS = 31;

/** A round axis maximum just above the data: 215 → 240, 12,065 → 16,000, 3 → 4 */
const niceMax = (max: number): number => {
  if (max <= 4) return 4;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].map((m) => m * pow).find((st) => st >= raw) ?? pow * 10;
  return step * 4;
};

/**
 * Smooth line through the points that never overshoots (monotone cubic, Fritsch–Carlson): a flat stretch stays flat
 * and a zero never dips below the axis.
 */
const smoothPath = (pts: [number, number][]): string => {
  const n = pts.length;
  if (n < 3) return `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
};

/** The lines' legend for a card's title row */
export function TrendLegend({ series }: { series: TrendSeries[] }) {
  return (
    <ul className="dv-trend-legend">
      {series.map((s, i) => (
        <li key={s.key}>
          <span className="dv-dot is-lg" style={{ background: colorOf(s, i) }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Trend over time (rules 73, 75, 87): lines with a soft gradient fill, dots on the points, the latest value in a
 * badge at the end of each line, a recessive grid, a crosshair tooltip and an optional dashed average line.
 * Drawn at the card's real pixel width; the lines draw left→right, then the fill fades in.
 */
export function TrendChart({ data, series, ariaLabel, formatValue = compact, renderTooltip, average, onSelect }: {
  data: TrendPoint[];
  series: TrendSeries[];
  ariaLabel: string;
  formatValue?: (n: number) => string;
  /** Own hover box for a point (default: the label and each line's value) */
  renderTooltip?: (index: number) => ReactNode;
  /** Dashed average line of the first series (rule 73) */
  average?: boolean;
  onSelect?: (key: string) => void;
}) {
  const id = useId().replace(/:/g, '');
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const plotW = Math.max(width - M.left - M.right, 40);
  const plotH = HEIGHT - M.top - M.bottom;
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const yMax = niceMax(Math.max(0, ...values));
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((t) => (yMax / 4) * t);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  const avg = average && n ? data.reduce((s, d) => s + (Number(d[series[0].key]) || 0), 0) / n : null;
  const dataKey = data.map((d) => series.map((s) => d[s.key]).join(',')).join('|');

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / pageZoom();
    setHover(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / box.width) * (n - 1)))));
  };

  return (
    <div className="dv-trend" ref={ref}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${series.map((s) => `${s.label} ${d[s.key]}`).join(', ')}`).join('; ')}`} key={dataKey}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={i === 0 ? 0.22 : 0.08} />
              <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'dv-axis-line' : 'dv-grid-line'} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="dv-tick">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          (i % labelEvery === 0 && (i === n - 1 || x(n - 1) - x(i) >= 76)) || i === n - 1 ? (
            <text key={d.key} x={x(i)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="dv-tick">
              {d.label}
            </text>
          ) : null,
        )}
        {series.map((s, si) => {
          const line = smoothPath(data.map((d, i): [number, number] => [x(i), y(Number(d[s.key]) || 0)]));
          const area = `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#${id}-${s.key})`} className="dv-trend-area" />
              <path d={line} fill="none" stroke={soft(colorOf(s, si))} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="dv-trend-line" />
            </g>
          );
        })}
        {avg !== null && (
          <g className="dv-trend-area">
            <line x1={M.left} x2={M.left + plotW} y1={y(avg)} y2={y(avg)} className="dv-avg-line" />
            <text x={M.left + 6} y={y(avg) - 6} textAnchor="start" className="dv-tick">
              avg {formatValue(Math.round(avg * 10) / 10)}
            </text>
          </g>
        )}
        {n <= MAX_DOTS &&
          series.map((s, si) =>
            data.map((d, i) => <circle key={`${s.key}-${d.key}`} cx={x(i)} cy={y(Number(d[s.key]) || 0)} r={2} fill={soft(colorOf(s, si))} className="dv-trend-area" />),
          )}
        {/* latest value in a badge above the last point of each line; an equal value sits to the left of the first */}
        {n > 0 &&
          series.map((s, si) => {
            const v = Number(data[n - 1][s.key]) || 0;
            const text = formatValue(v);
            const w = 14 + text.length * 7.2;
            const prevW = series.slice(0, si).reduce((acc, o) => {
              const ov = Number(data[n - 1][o.key]) || 0;
              return Math.abs(y(ov) - y(v)) < 24 ? acc + 14 + formatValue(ov).length * 7.2 + 4 : acc;
            }, 0);
            const cx = Math.min(x(n - 1), M.left + plotW + M.right - w / 2 - 2) - prevW;
            const top = Math.max(2, y(v) - 30);
            return (
              <g key={`badge-${s.key}`} className="dv-trend-area">
                <rect x={cx - w / 2} y={top} width={w} height={22} rx={7} fill={`color-mix(in srgb, ${colorOf(s, si)} 14%, var(--s-panel))`} stroke={`color-mix(in srgb, ${colorOf(s, si)} 35%, var(--s-panel))`} strokeWidth={1} />
                <text x={cx} y={top + 15} textAnchor="middle" className="dv-badge-text" style={{ fill: `color-mix(in srgb, ${colorOf(s, si)} 70%, var(--s-text))` }}>
                  {text}
                </text>
              </g>
            );
          })}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} className="dv-crosshair" />
            {series.map((s, si) => (
              <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r={3.5} fill={soft(colorOf(s, si))} stroke="var(--s-panel)" strokeWidth={1.5} />
            ))}
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover !== null && onSelect?.(data[hover].key)}
          style={{ cursor: onSelect ? 'pointer' : 'crosshair' }}
        />
      </svg>
      {hover !== null && (
        <div className="dv-tip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: 4 }}>
          {renderTooltip ? (
            renderTooltip(hover)
          ) : (
            <>
              <strong>{data[hover].label}</strong>
              {series.map((s, si) => (
                <span key={s.key} className="dv-tip-row">
                  <span className="dv-dot" style={{ background: colorOf(s, si) }} aria-hidden />
                  {s.label}: <strong>{formatValue(Number(data[hover][s.key]) || 0)}</strong>
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
