import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { ACCENT, compact, shareOf, softFill, toneColor, type DashTone } from './chartColors';

const iStyle = (i: number, extra?: CSSProperties): CSSProperties => ({ ['--i' as string]: i, ...extra });

/* ─────────────────────────────── Columns ─────────────────────────────── */

export interface ColumnBar {
  key: string;
  label: string;
  value: number;
  /** Shade of a bar that needs attention (e.g. receivables over 90 days); default the first palette colour */
  tone?: DashTone;
}

/**
 * Column chart for magnitude / upcoming load (rule 75): value on top of each bar, label under it, bars grow up from
 * the baseline one after another (rule 87). `tooltip` gives the hover text in plain words.
 */
export function ColumnChart({ bars, ariaLabel, tooltip, onSelect, formatValue = compact }: { bars: ColumnBar[]; ariaLabel: string; tooltip?: (bar: ColumnBar) => string; onSelect?: (key: string) => void; formatValue?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="dv-pad">
      <div className="dv-cols" role="img" aria-label={`${ariaLabel}: ${bars.map((b) => `${b.label} ${b.value}`).join(', ')}`} key={bars.map((b) => b.value).join('|')}>
        {bars.map((b, i) => {
          const fill = b.tone ? `color-mix(in srgb, ${toneColor(b.tone)} 55%, var(--s-panel))` : `color-mix(in srgb, ${ACCENT} 70%, var(--s-panel))`;
          const Tag = onSelect ? 'button' : 'div';
          return (
            <Tag key={b.key} type={onSelect ? 'button' : undefined} className="dv-col" onClick={onSelect ? () => onSelect(b.key) : undefined} data-tooltip={tooltip ? tooltip(b) : `${b.label}: ${formatValue(b.value)}`}>
              <span className="dv-col-plot">
                <span className="dv-col-val">{formatValue(b.value)}</span>
                <span className="dv-col-bar" style={iStyle(i, { height: `${Math.max(b.value ? 3 : 0, (b.value / max) * 100)}%`, background: fill })} />
              </span>
              <span className="dv-col-label">{b.label}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Split bars ─────────────────────────────── */

export interface SplitBar {
  key: string;
  label: string;
  first: number;
  second: number;
}

/** A part narrower than this share of the longest bar is too small to hold its number */
const MIN_LABEL_SHARE = 0.08;

/**
 * Stacked horizontal bars of two parts on one scale: each part's number inside it, the total at the end, the legend
 * below. Biggest first; the first `limit` rows show until the card's View all toggle opens the rest.
 */
export function SplitBars({ bars, firstLabel, secondLabel, limit = 6, expanded = false, formatValue = compact }: { bars: SplitBar[]; firstLabel: string; secondLabel: string; limit?: number; expanded?: boolean; formatValue?: (n: number) => string }) {
  const sorted = [...bars].sort((a, b) => b.first + b.second - (a.first + a.second) || a.label.localeCompare(b.label));
  const shown = expanded ? sorted : sorted.slice(0, limit);
  const max = Math.max(...sorted.map((b) => b.first + b.second), 1);
  const [c1, c2] = [softFill(0), softFill(3)];
  const part = (value: number, color: string, label: string, cls: string) =>
    value > 0 ? (
      <span className={`dv-split-part ${cls}`} style={{ flex: value, background: color, color: 'var(--s-text)' }} data-tooltip={`${label}: ${formatValue(value)}`}>
        {value / max >= MIN_LABEL_SHARE ? formatValue(value) : null}
      </span>
    ) : null;
  return (
    <div className="dv-pad">
      <ul className="dv-split" key={shown.map((b) => `${b.first}-${b.second}`).join('|')}>
        {shown.map((b, i) => {
          const total = b.first + b.second;
          return (
            <li key={b.key}>
              <span className="truncate">{b.label}</span>
              <span className="dv-split-track">
                <span className="dv-split-bar dv-grow-x" style={iStyle(i, { width: `${(total / max) * 100}%` })}>
                  {part(b.first, c1, firstLabel, b.second ? 'is-left' : 'is-solo')}
                  {part(b.second, c2, secondLabel, b.first ? 'is-right' : 'is-solo')}
                </span>
              </span>
              <strong className="num">{formatValue(total)}</strong>
            </li>
          );
        })}
      </ul>
      <div className="dv-legend-row">
        <span>
          <span className="dv-dot is-lg" style={{ background: c1 }} aria-hidden />
          {firstLabel}
        </span>
        <span>
          <span className="dv-dot is-lg" style={{ background: c2 }} aria-hidden />
          {secondLabel}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Progress rows ─────────────────────────────── */

export interface ProgressRow {
  key: string;
  label: string;
  /** Done / used part */
  value: number;
  /** The whole */
  total: number;
  /** Shown instead of the bar (e.g. "Maintenance") */
  off?: string;
}

/**
 * Utilisation per item (rule 75), quiet: name · thin accent bar on a light track · "6 / 10" and a muted %.
 * Bars grow from the left (rule 87).
 */
export function ProgressRows({ rows, unit, limit = 6, expanded = false, formatValue = compact, sort = true }: {
  rows: ProgressRow[];
  /** Word after the amount in the tooltip, e.g. "h" or "visits" */
  unit: string;
  doneLabel?: string;
  restLabel?: string;
  icon?: LucideIcon;
  limit?: number;
  expanded?: boolean;
  formatValue?: (n: number) => string;
  sort?: boolean;
}) {
  const sorted = sort ? [...rows].sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || b.value / (b.total || 1) - a.value / (a.total || 1) || a.label.localeCompare(b.label)) : rows;
  const shown = expanded ? sorted : sorted.slice(0, limit);
  return (
    <div className="dv-pad">
      <ul className="dv-progress" key={shown.map((r) => r.value).join('|')}>
        {shown.map((r, i) => {
          const part = r.total ? Math.min(r.value / r.total, 1) : 0;
          return (
            <li key={r.key}>
              <span className="dv-progress-name truncate">{r.label}</span>
              {r.off ? (
                <span className="dv-progress-off">{r.off}</span>
              ) : (
                <span className="dv-progress-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part * 100)} aria-label={`${r.label}: ${shareOf(r.value, r.total)}`} data-tooltip={`${r.label}: ${formatValue(r.value)} of ${formatValue(r.total)} ${unit}`}>
                  <span className="dv-progress-fill dv-grow-x" style={iStyle(i, { width: `${part * 100}%`, background: ACCENT })} />
                </span>
              )}
              <span className="dv-progress-end">
                <strong className="num">
                  {formatValue(r.value)}
                  <span className="muted"> / {formatValue(r.total)}</span>
                </strong>
                <span className="dv-progress-pct">{r.off ? '—' : `${Math.round(part * 100)}%`}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── Ranked bars ─────────────────────────────── */

export interface RankRow {
  key: string;
  label: string;
  value: number;
}

/**
 * Ranked list (like a "Top SKUs" card): "1. Name … value (share)" with a thin accent line under each row sized
 * against the largest. For a mix of a few parts or a top-N ranking.
 */
export function RankBars({ rows, total, formatValue = compact, limit = 8, showShare = true }: { rows: RankRow[]; total?: number; formatValue?: (n: number) => string; limit?: number; showShare?: boolean }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, limit);
  const max = Math.max(1, ...sorted.map((r) => r.value));
  const whole = total ?? rows.reduce((s2, r) => s2 + r.value, 0);
  return (
    <div className="dv-pad">
      <ol className="dv-rank" key={sorted.map((r) => r.value).join('|')}>
        {sorted.map((r, i) => (
          <li key={r.key} className={r.value ? undefined : 'is-zero'} data-tooltip={`${r.label}: ${formatValue(r.value)} (${shareOf(r.value, whole, 1)})`}>
            <span className="dv-rank-line">
              <span className="truncate">
                <span className="muted">{i + 1}.</span> {r.label}
              </span>
              <span className="dv-rank-val">
                <strong>{formatValue(r.value)}</strong>
                {showShare && <span className="muted">{shareOf(r.value, whole)}</span>}
              </span>
            </span>
            <span className="dv-rank-track">
              <span className="dv-rank-fill dv-grow-x" style={iStyle(i, { width: `${(r.value / max) * 100}%` })} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────────── Attention list ─────────────────────────────── */

export interface AttentionRow {
  id: string;
  title: string;
  /** Second line: reference · detail */
  ref?: string;
  detail: string;
  icon: LucideIcon;
  tone: DashTone;
  /** Badge on the right, e.g. "12 days" */
  badge?: { text: string; tone?: DashTone; caption?: string };
  to: string;
  tip?: string;
  /** Group key for the summary row (e.g. 'invoices') */
  group?: string;
}

export interface AttentionGroup {
  key: string;
  label: string;
  count: number;
  /** The full list of this kind (opened by View all) */
  to: string;
}

/**
 * Needs attention (rule 74), calm (owner, 2026-11-24 — "too loud"): an optional summary row of what kinds of work
 * are waiting (click one to show only that kind), then max 5 quiet rows — small grey outline icon, title,
 * reference · detail, the age / amount as plain text on the right; only the worst items carry a small red / amber
 * dot. No tinted tiles, no coloured pills: severity is shown once, quietly. Empty → "You're all caught up".
 */
export function AttentionList({ rows, emptyText, label, groups, limit = 5, only: onlyProp, onOnly }: { rows: AttentionRow[]; emptyText: string; label: string; groups?: AttentionGroup[]; limit?: number; /** Chosen kind (controlled; lets the card's View all follow the chip) */ only?: string | null; onOnly?: (key: string | null) => void }) {
  const [ownOnly, setOwnOnly] = useState<string | null>(null);
  const only = onlyProp !== undefined ? onlyProp : ownOnly;
  const setOnly = (fn: (o: string | null) => string | null) => (onOnly ? onOnly(fn(only)) : setOwnOnly(fn));
  const shown = (only ? rows.filter((r) => r.group === only) : rows).slice(0, limit);
  const visibleGroups = (groups ?? []).filter((g) => g.count > 0);
  return (
    <div className="dv-attention-wrap">
      {visibleGroups.length > 1 && (
        <div className="dv-attention-groups" role="group" aria-label="Filter by kind">
          {visibleGroups.map((g) => (
            <button key={g.key} type="button" className={cx('dv-attention-group', only === g.key && 'is-on')} aria-pressed={only === g.key} onClick={() => setOnly((o) => (o === g.key ? null : g.key))}>
              {g.label}
              <span>{g.count}</span>
            </button>
          ))}
        </div>
      )}
      {!shown.length ? (
        <p className="dv-empty is-ok">
          <span className="dv-dot is-lg" style={{ background: toneColor('success') }} aria-hidden />
          {emptyText}
        </p>
      ) : (
        <ul className="dv-attention" aria-label={label}>
          {shown.map((r) => {
            const severe = r.badge?.tone;
            return (
              <li key={r.id}>
                <Link to={r.to} className="dv-attention-row" target="_blank" rel="noopener noreferrer" aria-label={`${r.title} — opens in a new tab`}>
                  <span className="dv-attention-icon" data-tooltip={r.tip} aria-hidden>
                    <r.icon size={15} strokeWidth={1.6} />
                  </span>
                  <span className="dv-attention-main">
                    <span className="dv-attention-title">{r.title}</span>
                    <span className="dv-attention-sub">
                      {r.ref && <span className="dv-attention-ref">{r.ref}</span>}
                      {r.ref && <span aria-hidden>·</span>}
                      <span className="truncate">{r.detail}</span>
                    </span>
                  </span>
                  {r.badge && (
                    <span className="dv-attention-badge">
                      <span className="dv-attention-age">
                        {severe ? <span className="dv-dot" style={{ background: toneColor(severe) }} aria-hidden /> : null}
                        {r.badge.text}
                      </span>
                      {r.badge.caption && <small>{r.badge.caption}</small>}
                    </span>
                  )}
                  <ChevronRight size={16} strokeWidth={1.6} className="dv-attention-chev" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The list "View all" should open: the chosen kind, else the biggest kind */
export const attentionTarget = (groups: AttentionGroup[], only: string | null) => {
  const visible = groups.filter((g) => g.count > 0);
  return visible.find((g) => g.key === only) ?? [...visible].sort((a, b) => b.count - a.count)[0];
};

/* ─────────────────────────────── Heatmap ─────────────────────────────── */

/**
 * Heatmap (rule 75: "when is it busiest?" → day × hour): one rounded cell per row × column, tinted by value in the
 * main chart colour (empty cells stay a faint track), the value inside when it fits, a legend from low to high.
 */
export function Heatmap({ rows, cols, values, ariaLabel, unit, tooltip }: {
  rows: string[];
  cols: string[];
  /** values[row][col] */
  values: number[][];
  ariaLabel: string;
  unit: string;
  tooltip?: (row: string, col: string, v: number) => string;
}) {
  const max = Math.max(1, ...values.flat());
  const busiest = values.flatMap((r, ri) => r.map((v, ci) => ({ v, ri, ci }))).sort((a, b) => b.v - a.v)[0];
  return (
    <div className="dv-pad">
      <div className="dv-heat" role="img" aria-label={`${ariaLabel}. Busiest: ${busiest ? `${rows[busiest.ri]} ${cols[busiest.ci]}, ${busiest.v} ${unit}` : 'none'}`} style={{ gridTemplateColumns: `44px repeat(${cols.length}, minmax(0, 1fr))` } as CSSProperties}>
        <span />
        {cols.map((c) => (
          <span key={c} className="dv-heat-col">
            {c}
          </span>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="dv-heat-row">
            <span className="dv-heat-label">{r}</span>
            {cols.map((c, ci) => {
              const v = values[ri]?.[ci] ?? 0;
              const t = v / max;
              return (
                <span
                  key={c}
                  className="dv-heat-cell"
                  style={{ background: v ? `color-mix(in srgb, ${ACCENT} ${Math.round(10 + t * 55)}%, var(--s-panel))` : 'var(--c-chart-track)', color: 'var(--s-text)', ['--i' as string]: ri * cols.length + ci } as CSSProperties}
                  data-tooltip={tooltip ? tooltip(r, c, v) : `${r} ${c}: ${v} ${unit}`}
                >
                  {v || ''}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="dv-heat-legend">
        <span>Quiet</span>
        {[10, 28, 46, 65].map((p) => (
          <span key={p} className="dv-heat-swatch" style={{ background: `color-mix(in srgb, ${ACCENT} ${p}%, var(--s-panel))` }} />
        ))}
        <span>Busy</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────── 100% stacked bar ─────────────────────────────── */

export interface ShareSlice {
  key: string;
  label: string;
  value: number;
  /** Own colour (e.g. green for Paid); default the next mark colour */
  color?: string;
}

/**
 * One 100% stacked bar (rule 75: "what share of the whole?" when the parts are few and ordered): soft rounded
 * segments with small gaps, then a legend grid — dot · label · count · share. Quieter than a second donut.
 */
export function ShareBar({ slices, ariaLabel, formatValue = compact, summary }: { slices: ShareSlice[]; ariaLabel: string; formatValue?: (n: number) => string; /** One quiet line answering the card's question */ summary?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const colorOf = (s: ShareSlice, i: number) => s.color ?? softFill(i);
  const shown = slices.filter((s) => s.value > 0);
  return (
    <div className="dv-pad">
      <div className="dv-sharebar" role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value} (${shareOf(s.value, total)})`).join(', ')}`} key={slices.map((s) => s.value).join('|')}>
        {shown.map((s) => {
          const i = slices.indexOf(s);
          return <span key={s.key} className="dv-sharebar-seg dv-grow-x" style={{ flex: s.value, background: colorOf(s, i), ['--i' as string]: i } as CSSProperties} data-tooltip={`${s.label}: ${formatValue(s.value)} (${shareOf(s.value, total, 1)})`} />;
        })}
      </div>
      <ul className="dv-sharebar-legend">
        {slices.map((s, i) => (
          <li key={s.key} className={s.value ? undefined : 'is-zero'}>
            <span className="dv-dot is-lg" style={{ background: s.value ? colorOf(s, i) : 'var(--c-chart-track)' }} aria-hidden />
            <span className="truncate">{s.label}</span>
            <strong>{formatValue(s.value)}</strong>
            <span className="muted">{shareOf(s.value, total)}</span>
          </li>
        ))}
      </ul>
      {summary ? <p className="dv-part-summary dv-sharebar-summary">{summary}</p> : null}
    </div>
  );
}

/* ─────────────────────────────── Ranked amount bars ─────────────────────────────── */

export interface AmountRow {
  id: string;
  title: string;
  ref: string;
  amount: number;
  /** Days late — colours the bar: amber, red after `dangerAfter` days */
  days: number;
  to: string;
}

/**
 * Largest items as compact ranked bars (rule 75: "which ones matter most?"), one line each: name on the left, a soft rounded bar
 * sized by amount and tinted by how late it is (amber → red after `dangerAfter` days), the amount and days late on the
 * right. Each row opens its record in a new tab.
 */
export function AmountBars({ rows, formatValue, dangerAfter = 60 }: { rows: AmountRow[]; formatValue: (n: number) => string; dangerAfter?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ol className="dv-amounts" key={rows.map((r) => r.amount).join('|')}>
      {rows.map((r, i) => {
        const tone = r.days > dangerAfter ? 'danger' : 'warning';
        return (
          <li key={r.id}>
            <Link to={r.to} className="dv-amounts-row" target="_blank" rel="noopener noreferrer" aria-label={`${r.title}, ${formatValue(r.amount)}, ${r.days} days late — opens in a new tab`}>
              <span className="dv-amounts-who truncate">{r.title}</span>
              <span className="dv-amounts-track">
                <span className="dv-amounts-bar dv-grow-x" style={iStyle(i, { width: `${Math.max((r.amount / max) * 100, 4)}%`, background: `color-mix(in srgb, ${toneColor(tone)} 38%, var(--s-panel))` })} />
              </span>
              <strong className="dv-amounts-amt">{formatValue(r.amount)}</strong>
              <small className="dv-amounts-days" style={{ color: toneColor(tone) }}>
                {r.days}d late
              </small>
              <ChevronRight size={15} strokeWidth={1.6} className="dv-attention-chev" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────────── To-do summary (Needs attention) ─────────────────────────────── */

export interface TodoRow {
  key: string;
  icon: LucideIcon;
  tone: DashTone;
  /** Plain sentence with the count, e.g. "188 invoices are overdue" */
  title: string;
  /** How big it is, e.g. "$17,650 owed · oldest 123 days" */
  detail?: string;
  /** The action, e.g. "Chase payments" */
  action: string;
  to: string;
}

/**
 * Needs attention as plain-language to-dos (owner, 2026-11-24 — "easy to understand"): one row per kind of work —
 * a severity-tinted icon, a sentence that says what is wrong and how many, how big it is, and one action that opens
 * the right list in a new tab. Then a short "Most urgent" list of the worst items as sentences.
 */
export function TodoSummary({ todos, urgent, emptyText }: { todos: TodoRow[]; urgent: { id: string; text: string; detail: string; tone: DashTone; to: string }[]; emptyText: string }) {
  const shown = todos.filter((t) => t.title);
  if (!shown.length) {
    return (
      <p className="dv-empty is-ok">
        <span className="dv-dot is-lg" style={{ background: toneColor('success') }} aria-hidden />
        {emptyText}
      </p>
    );
  }
  return (
    <div className="dv-todo">
      <ul className="dv-todo-list">
        {shown.map((t) => (
          <li key={t.key}>
            <Link to={t.to} className="dv-todo-row" target="_blank" rel="noopener noreferrer">
              <span className="dv-todo-icon" style={{ color: toneColor(t.tone), background: `color-mix(in srgb, ${toneColor(t.tone)} 10%, var(--s-panel))` }} aria-hidden>
                <t.icon size={15} strokeWidth={1.8} />
              </span>
              <span className="dv-todo-text">
                <strong>{t.title}</strong>
                {t.detail ? <span>{t.detail}</span> : null}
              </span>
              <span className="dv-todo-action">
                {t.action}
                <ChevronRight size={14} strokeWidth={1.7} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {urgent.length ? (
        <>
          <p className="dv-subhead">Most urgent</p>
          <ul className="dv-urgent">
            {urgent.map((u) => (
              <li key={u.id}>
                <Link to={u.to} target="_blank" rel="noopener noreferrer" className="dv-urgent-row">
                  <span className="dv-dot" style={{ background: toneColor(u.tone) }} aria-hidden />
                  <span className="truncate">
                    <strong>{u.text}</strong> <span className="muted">· {u.detail}</span>
                  </span>
                  <ChevronRight size={14} strokeWidth={1.6} className="dv-attention-chev" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── Compact action table (Needs attention) ─────────────────────────────── */

export interface ActionRow {
  id: string;
  icon: LucideIcon;
  item: string;
  what: string;
  /** e.g. "121 days late" */
  when: string;
  tone: DashTone;
  amount?: string;
  action: string;
  to: string;
}

export interface ActionKind {
  key: string;
  label: string;
  count: number;
  /** Rows of this kind, most serious first */
  rows: ActionRow[];
}

/**
 * Needs attention as a SMALL table (owner, 2026-11-24): only three columns — Item (kind icon + name; what it is and
 * how late are in its hover tip), Amount, Action — with a filter of kinds above it (All · Overdue invoices ·
 * Referrals · Approvals · Tasks, each with its count). "All" shows a fair mix, most serious first. Max 6 rows;
 * every row opens its record in a new tab.
 */
export function ActionTable({ kinds, mixed, emptyText, limit = 6 }: { kinds: ActionKind[]; mixed: ActionRow[]; emptyText: string; limit?: number }) {
  const [only, setOnly] = useState<string | null>(null);
  const visible = kinds.filter((k) => k.count > 0);
  const rows = (only ? visible.find((k) => k.key === only)?.rows ?? [] : mixed).slice(0, limit);
  if (!visible.length) {
    return (
      <p className="dv-empty is-ok">
        <span className="dv-dot is-lg" style={{ background: toneColor('success') }} aria-hidden />
        {emptyText}
      </p>
    );
  }
  return (
    <div className="dv-pad">
      <div className="dv-attention-groups" role="group" aria-label="Show kind">
        <button type="button" className={cx('dv-attention-group', !only && 'is-on')} aria-pressed={!only} onClick={() => setOnly(null)}>
          All
        </button>
        {visible.map((k) => (
          <button key={k.key} type="button" className={cx('dv-attention-group', only === k.key && 'is-on')} aria-pressed={only === k.key} onClick={() => setOnly(only === k.key ? null : k.key)}>
            {k.label}
            <span>{k.count}</span>
          </button>
        ))}
      </div>
      <table className="dv-table is-compact">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Amount</th>
            <th aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-tooltip={`${r.what} · ${r.when}`}>
              <td>
                <Link to={r.to} target="_blank" rel="noopener noreferrer" className="dv-table-item">
                  <span className="dv-table-kind" style={{ color: toneColor(r.tone) }} aria-hidden>
                    <r.icon size={14} strokeWidth={1.8} />
                  </span>
                  <span className="truncate">{r.item}</span>
                  <span className="sr-only">
                    {r.what}, {r.when}
                  </span>
                </Link>
              </td>
              <td className="num">{r.amount ?? <span className="muted">—</span>}</td>
              <td className="num">
                <Link to={r.to} target="_blank" rel="noopener noreferrer" className="dv-link">
                  {r.action}
                  <ChevronRight size={13} strokeWidth={1.7} aria-hidden />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
