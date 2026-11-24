import { useId } from 'react';
import { compact, paletteSlot, strongOf, useWidth } from './chartColors';

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** Why some did not go on to the next step */
  note?: string;
  /** More about the note, shown in the hover tip */
  noteDetail?: string;
}

const BAND_H = 40;
const PCT_W = 56;
const PILL_W = 96;
const PILL_H = 20;
const NOTE_W = 110;
const SIDE = 44;
const FUNNEL_MIN = 140;
const FUNNEL_MAX = 220;
/** Width of the straight spout at the bottom, as a share of the top */
const SPOUT = 0.22;

/**
 * Conversion funnel (rule 75) — the classic cone in soft pastel (owner, 2026-11-24): one straight-sided cone of steps
 * stacked with no gaps, each a light gradient of its mark colour with a soft tinted oval rim on top, a narrow straight
 * spout at the bottom; the count sits inside in the text colour. At every step's lower edge a dotted guide in the
 * step's colour runs from its share of the first step (left) to the funnel and on to the step name in a rounded tinted
 * pill (right), with why some stopped there under the pill. Steps drop in one after another (rule 87).
 */
export function FunnelDiagram({ steps, ariaLabel, emptyText }: { steps: FunnelStep[]; ariaLabel: string; emptyText: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const first = steps[0]?.value ?? 0;
  const n = steps.length;

  const rightW = Math.max(PILL_W, NOTE_W);
  const funnelW = Math.min(Math.max(width - PCT_W - rightW - SIDE * 2, FUNNEL_MIN), FUNNEL_MAX);
  const left = Math.max(0, (width - (PCT_W + SIDE + funnelW + SIDE + rightW)) / 2);
  const pctX = left + PCT_W;
  const cx = pctX + SIDE + funnelW / 2;
  const pillX = cx + funnelW / 2 + SIDE;
  const ry = (w: number) => Math.max(3, Math.min(w * 0.045, 12));
  const topPad = ry(funnelW) + 1;
  const coneSteps = Math.max(n - 1, 1);
  const widthAt = (edge: number) => (n === 1 ? funnelW : edge >= coneSteps ? funnelW * SPOUT : funnelW - (funnelW - funnelW * SPOUT) * (edge / coneSteps));
  const yAt = (edge: number) => topPad + edge * BAND_H;
  const height = yAt(n) + ry(funnelW * SPOUT) + 22;
  const percent = (v: number) => (v === first ? '100%' : `${((v / first) * 100).toFixed(1)}%`);

  return (
    <div className="dv-pad">
      <div ref={ref} className="dv-measure">
        {!first ? (
          <p className="dv-empty is-flush">{emptyText}</p>
        ) : (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="dv-funnel" role="img" aria-label={`${ariaLabel}: ${steps.map((s) => `${s.label} ${s.value}`).join(', ')}`} key={steps.map((s) => s.value).join('|')}>
            <defs>
              {steps.map((s, i) => (
                <linearGradient key={s.key} id={`${gid}-f${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={paletteSlot(i)} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={paletteSlot(i)} stopOpacity={0.18} />
                </linearGradient>
              ))}
            </defs>

            {/* dotted guides at each step's lower edge: % → funnel side, funnel side → pill */}
            {steps.map((s, i) => {
              const isSpout = n > 1 && i === n - 1;
              const bw = isSpout ? widthAt(i) : widthAt(i + 1);
              const y = yAt(i + 1);
              const common = { y1: y, y2: y, stroke: paletteSlot(i), strokeOpacity: 0.75, strokeWidth: 1, strokeDasharray: '2 3', strokeLinecap: 'round' as const };
              return (
                <g key={`guide-${s.key}`}>
                  <line x1={pctX + 8} x2={cx - bw / 2} {...common} />
                  <line x1={cx + bw / 2} x2={pillX - 6} {...common} />
                </g>
              );
            })}

            {steps.map((s, i) => {
              const color = paletteSlot(i);
              const isSpout = n > 1 && i === n - 1;
              const tw = widthAt(i);
              const bw = isSpout ? tw : widthAt(i + 1);
              const y1 = yAt(i);
              const y2 = yAt(i + 1);
              const body = `M${cx - tw / 2},${y1} L${cx - bw / 2},${y2} A${bw / 2},${ry(bw)} 0 0 0 ${cx + bw / 2},${y2} L${cx + tw / 2},${y1} Z`;
              const mid = (y1 + ry(tw) + y2) / 2;
              return (
                <g key={s.key} className="dv-funnel-step" style={{ ['--i' as string]: i }} data-tooltip={`${s.label}: ${s.value} (${percent(s.value)})${s.note ? ` · ${s.note}${s.noteDetail ? `: ${s.noteDetail}` : ''}` : ''}`}>
                  {/* solid white backing so the pastel gradient never shows what is behind */}
                  <path d={body} fill="var(--s-panel)" />
                  <path d={body} fill={`url(#${gid}-f${i})`} />
                  {/* soft tinted oval rim on top of the step */}
                  <ellipse cx={cx} cy={y1} rx={tw / 2} ry={ry(tw)} fill={`color-mix(in srgb, ${color} 34%, var(--s-panel))`} />
                  {isSpout && <ellipse cx={cx} cy={y2} rx={bw / 2} ry={ry(bw)} fill={`color-mix(in srgb, ${color} 26%, var(--s-panel))`} />}
                  <text x={cx} y={mid + 5} textAnchor="middle" className="dv-funnel-count">
                    {compact(s.value)}
                  </text>
                </g>
              );
            })}

            {/* % on the left and the step name in a pill on the right, on the step's lower edge */}
            {steps.map((s, i) => {
              const color = paletteSlot(i);
              const edge = yAt(i + 1);
              return (
                <g key={`label-${s.key}`}>
                  <text x={pctX} y={edge + 4} textAnchor="end" className="dv-funnel-pct" fill={strongOf(color)}>
                    {percent(s.value)}
                  </text>
                  <rect x={pillX} y={edge - PILL_H / 2} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill={`color-mix(in srgb, ${color} 14%, var(--s-panel))`} stroke={`color-mix(in srgb, ${color} 40%, var(--s-panel))`} strokeWidth={1} />
                  <text x={pillX + PILL_W / 2} y={edge + 4} textAnchor="middle" className="dv-funnel-pill" fill={strongOf(color)}>
                    {s.label}
                  </text>
                  {s.note ? (
                    <text x={pillX + 2} y={edge + PILL_H / 2 + 14} className="dv-funnel-note">
                      {s.note}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
