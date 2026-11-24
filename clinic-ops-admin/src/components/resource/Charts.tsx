import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../lib/format';

/**
 * Dashboard charts (dataviz method): thin marks, recessive grid, per-mark hover tooltips,
 * legend + counts so identity is never colour-alone, and a table view.
 */

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** status colour (status job — always shown with its label and count) */
  color: string;
}

/** Part-to-whole donut with a centre total and a labelled legend (2px surface gap between segments). */
export function DonutChart({ data, total, totalLabel, label }: { data: DonutSlice[]; total: number; totalLabel: string; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const R = 52;
  const STROKE = 14;
  const C = 2 * Math.PI * R;
  const sum = data.reduce((s, d) => s + d.value, 0) || 1;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <figure className="donut" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
      <div className="donut-plot">
        <svg key={data.map((d) => d.value).join('|')} viewBox="0 0 140 140" role="img" aria-hidden="true">
          <circle cx="70" cy="70" r={R} className="donut-track" strokeWidth={STROKE} fill="none" />
          {data.map((d) => {
            if (!d.value) return null;
            const len = (d.value / sum) * C;
            const seg = (
              <circle
                key={d.key}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth={hover === d.key ? STROKE + 3 : STROKE}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
                className={cx('donut-seg', hover && hover !== d.key && 'is-dim')}
                style={{ '--i': data.indexOf(d) } as CSSProperties}
                onMouseEnter={() => setHover(d.key)}
                onMouseLeave={() => setHover(null)}
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong>{hover ? data.find((d) => d.key === hover)?.value : total}</strong>
          <span>{hover ? data.find((d) => d.key === hover)?.label : totalLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.key} className={cx(!d.value && 'is-zero', hover === d.key && 'is-hover')} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
            <span className="donut-swatch" style={{ background: d.color }} aria-hidden="true" />
            <span>{d.label}</span>
            <span className="spacer" />
            <strong>{d.value}</strong>
            <span className="donut-pct">{Math.round((d.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Single-series line/area over time with a crosshair tooltip and a table view. */
export function LineChart({ data, label, unit, onSelect, tableToggle = true }: { data: { key: string; label: string; value: number }[]; label: string; unit: string; onSelect?: (key: string) => void; /** dashboards hide the Show table link (owner rule 75) */ tableToggle?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // draw at the real pixel width so text and line weights never scale with the card
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = () => setW(Math.max(280, Math.round(el.clientWidth)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const H = 200;
  const padL = 28;
  const padB = 24;
  const padT = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = Math.ceil(max / 5) * 5;
  const x = (i: number) => padL + (i * (W - padL - 8)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - padB - (v / nice) * (H - padB - padT);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const avg = data.reduce((s, d) => s + d.value, 0) / Math.max(1, data.length);
  return (
    <figure className="chart">
      <div className="chart-head">
        <figcaption className="chart-title">{label}</figcaption>
        {tableToggle && (
          <button type="button" className="link small" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {asTable ? (
        <table className="mini-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={wrap} className="chart-svg-wrap" onMouseLeave={() => setHover(null)}>
          <svg key={data.map((d) => d.value).join('|')} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`} className="chart-svg">
            {[0, nice / 2, nice].map((t) => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">
                  {t}
                </text>
              </g>
            ))}
            <line x1={padL} x2={W} y1={y(avg)} y2={y(avg)} className="chart-ref" />
            <text x={W - 2} y={y(avg) - 5} textAnchor="end" className="chart-axis">
              avg {Math.round(avg * 10) / 10}
            </text>
            <path d={area} className="chart-area" />
            <path d={line} className="chart-line" pathLength={1} />
            {data.map((d, i) => (
              <g key={d.key}>
                <rect x={x(i) - (W - padL) / data.length / 2} y={0} width={(W - padL) / data.length} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(d.key)} style={{ cursor: onSelect ? 'pointer' : undefined }} />
                {(data.length <= 10 || i % Math.ceil(data.length / Math.max(2, Math.floor(W / 90))) === 0) && (
                  <text x={x(i)} y={H - 6} textAnchor="middle" className="chart-axis">
                    {d.label}
                  </text>
                )}
              </g>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="chart-crosshair" />
                <circle cx={x(hover)} cy={y(data[hover].value)} r={5} className="chart-dot" />
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
              <strong>{data[hover].value}</strong> {unit} · {data[hover].label}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Conversion funnel: one hue, bar length = count; count, share of the first stage and step conversion as text. */
export function FunnelChart({ stages, label }: { stages: { key: string; label: string; value: number }[]; label: string }) {
  const first = stages[0]?.value || 1;
  return (
    <figure className="funnel" aria-label={`${label}: ${stages.map((st) => `${st.label} ${st.value}`).join(', ')}`}>
      <ol className="funnel-list" key={stages.map((st) => st.value).join('|')}>
        {stages.map((st, i) => {
          const prev = i ? stages[i - 1].value : 0;
          return (
            <li key={st.key} className="funnel-step">
              <span className="funnel-head">
                <span className="funnel-label">{st.label}</span>
                <span className="spacer" />
                <strong>{st.value}</strong>
                <span className="funnel-pct">{Math.round((st.value / first) * 100)}%</span>
              </span>
              <span className="funnel-track">
                <span className="funnel-bar" style={{ width: `${Math.max(2, (st.value / first) * 100)}%`, opacity: 1 - i * 0.14, '--i': i } as CSSProperties} />
              </span>
              {i > 0 && (
                <span className="funnel-conv">
                  {prev ? Math.round((st.value / prev) * 100) : 0}% from {stages[i - 1].label.toLowerCase()}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
