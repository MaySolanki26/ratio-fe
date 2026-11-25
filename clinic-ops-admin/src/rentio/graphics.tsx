/**
 * Rentio graphical views — flow diagrams and charts drawn from the SAME derived figures as the tables
 * (never separate numbers). Shared rules for every graphic:
 *  - zero-baseline, exclusive segments (a bar's total is the real total; nothing counted twice);
 *  - identity never by colour alone: legend + direct labels where wide enough + text status;
 *  - every graphic has a "Show as table (same figures)" view;
 *  - categorical slots come from the validated reference palette (--rt-c1…c5, light/dark steps in
 *    rentio.css, checked with the dataviz validator); status meaning uses the status tokens only.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../lib/format';
import { userName } from '../domain/rentio/access';
import type { RunEvent, StageRun } from '../domain/rentio/types';
import { fmtDuration, fmtKg, type Grams, sum } from '../domain/rentio/units';
import { Details } from './ui';
import { StatusChip } from '../components/primitives/feedback';
import type { Tone } from '../metadata/types';

// ---------------------------------------------------------------- colours by job

/** Categorical slots (fixed order, never cycled). */
export const CAT = ['var(--rt-c1)', 'var(--rt-c2)', 'var(--rt-c3)', 'var(--rt-c4)', 'var(--rt-c5)'];
/** Status meaning — reserved for state, always paired with a text label. */
export const STATUS = { good: 'var(--s-success)', info: 'var(--s-info)', warn: 'var(--s-warning)', bad: 'var(--s-danger)', muted: 'var(--rt-neutral)', faint: 'var(--rt-neutral-2)' };

/** Where every kilogram of a stage run went (categories in this fixed order). */
export const MASS_SEGS: Seg[] = [
  { key: 'forward', label: 'Good output', color: CAT[0] },
  { key: 'rework', label: 'Rework (re-peel)', color: CAT[1] },
  { key: 'husk', label: 'Husk', color: CAT[2] },
  { key: 'churi', label: 'Churi', color: CAT[3] },
  { key: 'reject', label: 'Cleaning rejects', color: CAT[4] },
  { key: 'loss', label: 'Recorded loss', color: STATUS.muted, pattern: true },
  { key: 'residual', label: 'Not processed (back to queue)', color: STATUS.faint },
];

export interface Seg {
  key: string;
  label: string;
  color: string;
  /** hatch texture as secondary encoding */
  pattern?: boolean;
  /** legend-only swatch style (e.g. outline / dashed marker) */
  swatch?: 'outline' | 'dashed';
  /** drawn (e.g. free capacity) but not part of the quantity total */
  notCounted?: boolean;
}

export interface BarRow {
  id: string;
  label: ReactNode;
  /** plain text for the table/aria */
  text: string;
  to?: string;
  values: Record<string, number>;
  note?: string;
}

const pct = (v: number, max: number) => `${Math.max(0, (v * 100) / (max || 1))}%`;

/**
 * Horizontal stacked bars of mutually exclusive parts (zero baseline). Direct labels appear inside a
 * segment when it is wide enough; every value is also in the hover text and the table view.
 */
export function StackBars({
  title,
  caption,
  segs,
  rows,
  rowHeader = 'Item',
  format = fmtKg,
  empty = 'Nothing to show.',
  max: fixedMax,
  focus,
}: {
  title: string;
  caption?: string;
  segs: Seg[];
  rows: BarRow[];
  rowHeader?: string;
  format?: (n: number) => string;
  empty?: string;
  /** common scale (e.g. capacity); default = largest row total */
  max?: number;
  focus?: string;
}) {
  const used = segs.filter((s) => rows.some((r) => (r.values[s.key] ?? 0) > 0));
  const total = (r: BarRow) => sum(used.filter((s) => !s.notCounted).map((s) => r.values[s.key] ?? 0));
  const drawn = (r: BarRow) => sum(used.map((s) => r.values[s.key] ?? 0));
  const max = fixedMax ?? Math.max(1, ...rows.map(drawn));
  return (
    <figure className="rt-chart rt-viz" aria-label={title}>
      <figcaption className="rt-chart-head">
        <strong>{title}</strong>
        {caption && <span className="muted small">{caption}</span>}
      </figcaption>
      {used.length > 1 && <Legend segs={used} />}
      {rows.length === 0 || used.length === 0 ? (
        <p className="rt-empty">{empty}</p>
      ) : (
        <div className="rt-chart-rows">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="rt-chart-label">{r.label}</span>
                <span className="rt-chart-track" role="img" aria-label={`${r.text}: ${used.map((s) => `${s.label} ${format(r.values[s.key] ?? 0)}`).join(', ')}`}>
                  {used.map((s) => {
                    const v = r.values[s.key] ?? 0;
                    if (v <= 0) return null;
                    const w = (v * 100) / max;
                    return (
                      <span key={s.key} className={cx('rt-chart-seg', s.pattern && 'is-hatch')} style={{ width: pct(v, max), background: s.color }} data-tooltip={`${r.text} · ${s.label}: ${format(v)}`}>
                        {w >= 14 && <span className="rt-seg-label">{format(v)}</span>}
                      </span>
                    );
                  })}
                </span>
                <span className="rt-chart-total">
                  {format(total(r))}
                  {r.note && <span className="rt-chart-note">{r.note}</span>}
                </span>
              </>
            );
            return r.to ? (
              <Link key={r.id} to={r.to} className={cx('rt-chart-row', focus === r.id && 'is-focus')}>
                {inner}
              </Link>
            ) : (
              <div key={r.id} className={cx('rt-chart-row', focus === r.id && 'is-focus')}>
                {inner}
              </div>
            );
          })}
          <div className="rt-chart-axis" aria-hidden="true">
            <span>0</span>
            <span>{format(max)}</span>
          </div>
        </div>
      )}
      {rows.length > 0 && used.length > 0 && (
        <Details summary="Show as table (same figures)">
          <div className="rt-table-wrap">
            <table className="rt-table">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th scope="col">{rowHeader}</th>
                  {used.map((s) => (
                    <th key={s.key} scope="col" className="num">{s.label}</th>
                  ))}
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.to ? <Link to={r.to}>{r.text}</Link> : r.text}</th>
                    {used.map((s) => (
                      <td key={s.key} className="num">{format(r.values[s.key] ?? 0)}</td>
                    ))}
                    <td className="num"><strong>{format(total(r))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Details>
      )}
    </figure>
  );
}

export function Legend({ segs }: { segs: Seg[] }) {
  return (
    <ul className="rt-chart-legend" aria-label="Legend">
      {segs.map((s) => (
        <li key={s.key}>
          <span className={cx('rt-chart-swatch', s.pattern && 'is-hatch', s.swatch && `is-${s.swatch}`)} style={s.swatch ? undefined : { background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** One 100% strip (part-to-whole) — e.g. where all of a lot went. */
export function ShareStrip({ title, caption, segs, values, format = fmtKg }: { title: string; caption?: string; segs: Seg[]; values: Record<string, number>; format?: (n: number) => string }) {
  return <StackBars title={title} caption={caption} segs={segs} rows={[{ id: 'all', label: 'Total', text: 'Total', values }]} format={format} rowHeader="" />;
}

// ---------------------------------------------------------------- flow chain (process / stock / order flows)

export interface FlowNode {
  key: string;
  label: string;
  /** main figure, e.g. "2,950 kg" */
  value: string;
  /** magnitude for the in-node bar (same unit across nodes) */
  magnitude?: number;
  sub?: string;
  /** state in words (+ tone for the chip) — never colour alone */
  status?: { label: string; tone: 'good' | 'info' | 'warn' | 'bad' | 'muted' };
  to?: string;
  /** side exits: material leaving the main flow at this step */
  exits?: { label: string; value: string; tone?: 'muted' | 'warn' }[];
  /** highlight (e.g. current step / bottleneck) */
  current?: boolean;
  done?: boolean;
}

/**
 * Process-flow diagram: steps left→right (top→bottom on phones) joined by arrows, each with its quantity,
 * a magnitude bar on one shared scale, status in words and side exits (by-products, rejects, loss).
 */
export function FlowChain({ title, caption, nodes, unitNote }: { title: string; caption?: string; nodes: FlowNode[]; unitNote?: string }) {
  const max = Math.max(1, ...nodes.map((n) => n.magnitude ?? 0));
  const TONE: Record<NonNullable<FlowNode['status']>['tone'], Tone> = { good: 'success', info: 'info', warn: 'warning', bad: 'danger', muted: 'neutral' };
  return (
    <figure className="rt-chart rt-viz rt-fc-wrap" aria-label={title}>
      <figcaption className="rt-chart-head">
        <strong>{title}</strong>
        {caption && <span className="muted small">{caption}</span>}
      </figcaption>
      {/* equal-width, equal-height steps in one row; wraps to 4 per row / one column in narrow cards (container queries) */}
      <ol className={cx('rt-fc', nodes.length > 5 && 'is-long')} style={{ ['--n' as string]: nodes.length }}>
        {nodes.map((n, i) => {
          const body = (
            <>
              <span className="rt-fc-top">
                <span className="rt-fc-label" title={n.label}>
                  {n.label}
                </span>
                <span className="rt-fc-step" aria-hidden="true">
                  {n.done ? '✓' : i + 1}
                </span>
              </span>
              <span className="rt-fc-value">{n.value}</span>
              <span className="rt-fc-bar" aria-hidden="true">
                {n.magnitude !== undefined && <span style={{ width: pct(n.magnitude, max) }} />}
              </span>
              <span className="rt-fc-sub" title={n.sub}>
                {n.sub ?? ' '}
              </span>
              <span className="rt-fc-status">{n.status ? <StatusChip label={n.status.label} tone={TONE[n.status.tone]} /> : null}</span>
            </>
          );
          return (
            <li key={n.key} className={cx('rt-fc-node', n.current && 'is-current', n.done && 'is-done')} aria-current={n.current ? 'step' : undefined}>
              {n.to ? (
                <Link to={n.to} className="rt-fc-box">
                  {body}
                </Link>
              ) : (
                <div className="rt-fc-box">{body}</div>
              )}
              {n.exits && n.exits.length > 0 && (
                <ul className="rt-fc-exits" aria-label={`Leaving the flow at ${n.label}`}>
                  {n.exits.map((x) => (
                    <li key={x.label} className={cx(x.tone === 'warn' && 'is-warn')} title={`${x.label} ${x.value}`}>
                      <span aria-hidden="true">↳</span>
                      <span className="rt-fc-exit-label">{x.label}</span>
                      <strong>{x.value}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {i < nodes.length - 1 && <span className="rt-fc-arrow" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {unitNote && <p className="muted small rt-fc-note">{unitNote}</p>}
    </figure>
  );
}

// ---------------------------------------------------------------- run timeline (planned vs actual)

interface Interval {
  from: number;
  to: number;
  kind: 'run' | 'hold';
  reason?: string;
}

function intervals(events: RunEvent[], end: number): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'complete') break;
    const next = events[i + 1];
    const to = next ? Date.parse(next.at) : end;
    if (e.type === 'start' || e.type === 'resume') out.push({ from: Date.parse(e.at), to, kind: 'run' });
    if (e.type === 'hold') out.push({ from: Date.parse(e.at), to, kind: 'hold', reason: e.reason });
  }
  return out;
}

const hm = (ms: number, withDay: boolean) =>
  new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false, ...(withDay ? { day: '2-digit', month: 'short' } : {}) });

/**
 * Gantt-style timeline per run: working time and holds as segments, the planned finish as a dashed
 * marker, time past the plan outlined as late, a "now" line for open runs.
 */
export function RunTimeline({ title, caption, runs, now, labelOf }: { title: string; caption?: string; runs: StageRun[]; now: string; labelOf: (r: StageRun) => string }) {
  if (!runs.length)
    return (
      <figure className="rt-chart rt-viz" aria-label={title}>
        <figcaption className="rt-chart-head">
          <strong>{title}</strong>
        </figcaption>
        <p className="rt-empty">No runs to show.</p>
      </figure>
    );
  const nowMs = Date.parse(now);
  const ends = runs.map((r) => (r.completedAt ? Date.parse(r.completedAt) : nowMs));
  const t0 = Math.min(...runs.map((r) => Date.parse(r.events[0].at)));
  const t1 = Math.max(...ends, ...runs.map((r) => Date.parse(r.baselineFinish)));
  const span = Math.max(1, t1 - t0);
  // runs spread over days: each bar is scaled to its own run (start → later of finish/plan), times in words
  const each = span > 24 * 3_600_000 && runs.length > 1;
  const rowRange = (i: number) => {
    const a = Date.parse(runs[i].events[0].at);
    return [a, Math.max(a + 1, ends[i], Date.parse(runs[i].baselineFinish))] as const;
  };
  let cur: readonly [number, number] = [t0, t1];
  const x = (t: number) => `${((t - cur[0]) * 100) / Math.max(1, cur[1] - cur[0])}%`;
  const w = (a: number, b: number) => `${Math.max(0.4, ((b - a) * 100) / Math.max(1, cur[1] - cur[0]))}%`;
  const withDay = span > 20 * 3_600_000 || new Date(t0).getDate() !== new Date(t1).getDate();
  // three ticks (start / middle / end) so labels never collide in a half-width card
  const ticks = [0, 0.5, 1].map((f) => t0 + f * span);
  const open = runs.some((r) => !r.completedAt);
  return (
    <figure className="rt-chart rt-viz" aria-label={title}>
      <figcaption className="rt-chart-head">
        <strong>{title}</strong>
        {caption && <span className="muted small">{caption}</span>}
      </figcaption>
      <Legend
        segs={[
          { key: 'run', label: 'Working', color: CAT[0] },
          { key: 'hold', label: 'On hold', color: STATUS.warn, pattern: true },
          { key: 'late', label: 'Past planned finish', color: 'transparent', swatch: 'outline' },
          { key: 'plan', label: 'Planned finish', color: 'transparent', swatch: 'dashed' },
        ]}
      />
      <div className="rt-tl">
        {runs.map((r, i) => {
          cur = each ? rowRange(i) : [t0, t1];
          const end = ends[i];
          const base = Date.parse(r.baselineFinish);
          const ivs = intervals(r.events, end);
          const late = end > base;
          const held = sum(ivs.filter((v) => v.kind === 'hold').map((v) => v.to - v.from));
          const working = sum(ivs.filter((v) => v.kind === 'run').map((v) => v.to - v.from));
          return (
            <div key={r.id} className="rt-tl-row">
              <span className="rt-tl-label">{labelOf(r)}</span>
              <span className="rt-tl-track" role="img" aria-label={`${labelOf(r)}: started ${hm(Date.parse(r.events[0].at), true)}, planned finish ${hm(base, true)}, ${r.completedAt ? `finished ${hm(end, true)}` : 'still open'}; working ${fmtDuration(working)}, on hold ${fmtDuration(held)}${late ? `, late ${fmtDuration(end - base)}` : ''}`}>
                {ivs.map((v, k) => (
                  <span key={k} className={cx('rt-tl-seg', v.kind === 'hold' && 'is-hold')} style={{ left: x(v.from), width: w(v.from, v.to) }} data-tooltip={`${v.kind === 'hold' ? `On hold${v.reason ? ` — ${v.reason}` : ''}` : 'Working'}: ${hm(v.from, withDay)}–${hm(v.to, withDay)} (${fmtDuration(v.to - v.from)})`} />
                ))}
                {late && <span className="rt-tl-late" style={{ left: x(base), width: w(base, end) }} data-tooltip={`Past planned finish by ${fmtDuration(end - base)}`} />}
                <span className="rt-tl-plan" style={{ left: x(base) }} data-tooltip={`Planned finish ${hm(base, true)}`} />
              </span>
              <span className="rt-tl-meta">
                {fmtDuration(working)} working{held ? ` · ${fmtDuration(held)} held` : ''}
                {late ? <span className="tone-text-danger"> · late {fmtDuration(end - base)}</span> : ''}
                {!r.completedAt && <span className="muted"> · open</span>}
                {each && <span className="muted"> · {hm(Date.parse(r.events[0].at), true)}</span>}
              </span>
            </div>
          );
        })}
        {each && <p className="muted small">Runs span several days — each bar is scaled to its own run (start to the later of finish and plan).</p>}
        {!each && (() => { cur = [t0, t1]; return null; })()}
        <div className="rt-tl-axis" aria-hidden="true" hidden={each}>
          <span className="rt-tl-label" />
          <span className="rt-tl-ticks">
            {ticks.map((t, k) => (
              <span key={k} style={{ left: x(t) }}>
                {hm(t, withDay)}
              </span>
            ))}
            {open && nowMs <= t1 && <span className="rt-tl-now" style={{ left: x(nowMs) }} />}
          </span>
          <span className="rt-tl-meta" />
        </div>
      </div>
      <Details summary="Show as table (same figures)">
        <div className="rt-table-wrap">
          <table className="rt-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Started</th>
                <th scope="col">Planned finish</th>
                <th scope="col">Finished</th>
                <th scope="col" className="num">Working</th>
                <th scope="col" className="num">On hold</th>
                <th scope="col" className="num">Late</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const ivs = intervals(r.events, ends[i]);
                const base = Date.parse(r.baselineFinish);
                return (
                  <tr key={r.id}>
                    <th scope="row">{labelOf(r)}</th>
                    <td>{hm(Date.parse(r.events[0].at), true)}</td>
                    <td>{hm(base, true)}</td>
                    <td>{r.completedAt ? hm(ends[i], true) : 'open'}</td>
                    <td className="num">{fmtDuration(sum(ivs.filter((v) => v.kind === 'run').map((v) => v.to - v.from)))}</td>
                    <td className="num">{fmtDuration(sum(ivs.filter((v) => v.kind === 'hold').map((v) => v.to - v.from)))}</td>
                    <td className="num">{ends[i] > base ? fmtDuration(ends[i] - base) : '—'}</td>
                    <td>{userName(r.ownerId)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Details>
    </figure>
  );
}

// ---------------------------------------------------------------- mass balance of runs

/** Rows for MASS_SEGS from stage runs (completed outputs). */
export function massRows(runs: StageRun[], label: (r: StageRun) => string, to?: (r: StageRun) => string): BarRow[] {
  return runs.map((r) => {
    const v: Record<string, number> = {};
    for (const o of r.outputs) v[o.kind] = (v[o.kind] ?? 0) + o.qty;
    const added = sum(r.additions.map((a) => a.qty));
    return { id: r.id, label: label(r), text: label(r), to: to?.(r), values: v, note: added ? `incl. ${fmtKg(added)} oil added` : undefined };
  });
}

// ---------------------------------------------------------------- genealogy diagram

export interface TreeNode {
  id: string;
  title: string;
  sub: string;
  live: Grams;
  children: TreeNode[];
  to?: string;
}

/** Lot genealogy as a connected tree; each node shows what is still physically live. */
export function GenealogyTree({ title, caption, root, scale }: { title: string; caption?: string; root: TreeNode; scale: Grams }) {
  const Node = ({ n }: { n: TreeNode }) => (
    <li>
      <span className={cx('rt-tree-node', n.live > 0 ? 'is-live' : 'is-used')}>
        <span className="rt-tree-id">{n.to ? <Link to={n.to}>{n.id}</Link> : n.id}</span>
        <span className="rt-tree-sub">{n.sub}</span>
        <span className="rt-tree-bar" aria-hidden="true">
          <span style={{ width: pct(n.live, scale) }} />
        </span>
        <span className="rt-tree-live">{n.live > 0 ? `${fmtKg(n.live)} here now` : 'fully moved on'}</span>
      </span>
      {n.children.length > 0 && (
        <ul>
          {n.children.map((c) => (
            <Node key={c.id} n={c} />
          ))}
        </ul>
      )}
    </li>
  );
  return (
    <figure className="rt-chart rt-viz" aria-label={title}>
      <figcaption className="rt-chart-head">
        <strong>{title}</strong>
        {caption && <span className="muted small">{caption}</span>}
      </figcaption>
      <ul className="rt-tree">
        <Node n={root} />
      </ul>
    </figure>
  );
}

/** Two charts side by side (stack on narrow screens). */
export const ChartGrid = ({ children }: { children: ReactNode }) => <div className="rt-charts">{children}</div>;
