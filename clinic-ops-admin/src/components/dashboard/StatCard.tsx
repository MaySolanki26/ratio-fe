import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cx } from '../../lib/format';
import type { DashTone } from './chartColors';

export interface StatCardProps {
  label: string;
  info?: string;
  value: string;
  unit?: string;
  /** Short line under the number ("In this period", "3 overdue"); a tone adds a coloured dot */
  note?: { text: string; tone?: DashTone };
  /** Change vs the compared period in %; null = nothing to compare ("new"), undefined = no badge */
  delta?: number | null;
  /** Whether a rise is good news (green) or bad news (red) — e.g. more no-shows is bad */
  riseIsGood?: boolean;
  /** Opens the matching list (rule 70: each KPI links to its list) */
  to?: string;
  /** Kept for callers; KPI cards no longer draw an icon */
  icon?: LucideIcon;
  testId?: string;
}

function DeltaBadge({ delta, riseIsGood }: { delta: number | null; riseIsGood: boolean }) {
  if (delta === null) return <span className="dv-delta is-new">new</span>;
  const tone = delta === 0 ? 'flat' : delta > 0 === riseIsGood ? 'good' : 'bad';
  const Arrow = delta >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cx('dv-delta', `is-${tone}`)}>
      <Arrow size={12} strokeWidth={2.2} aria-hidden />
      {Math.abs(delta) > 999 ? '999+' : Math.abs(delta)}%<span className="sr-only"> vs compared period</span>
    </span>
  );
}

/**
 * Dashboard KPI card (rules 70, 74, 75): small-caps label + ⓘ, pastel icon tile in the card's own colour
 * (set per position by `.dv-stat-grid`), number in the text colour with a muted unit, a ↑/↓ change badge and a
 * short note. Links to its list when `to` is given.
 */
export function StatCard({ label, info, value, unit, note, delta, riseIsGood = true, to, testId }: StatCardProps) {
  const TONE_WORD: Record<DashTone, string> = { success: 'Good', warning: 'Needs attention', danger: 'Problem' };
  // Status dot in the top-right corner (owner, 2026-11-24): green good · amber attention · red problem;
  // hovering it says what it means — the note, then what the KPI counts
  // every card has the dot (same look everywhere): grey when the figure carries no good / bad meaning
  const dotTip = [note?.tone ? `${TONE_WORD[note.tone]}: ${note.text}` : note?.text, info].filter(Boolean).join(' — ') || label;
  const body: ReactNode = (
    <>
      {/* KPI cards carry no icon: label · number · note; the explanation is the label's hover tip */}
      <div className="dv-stat-head">
        <span className="dv-stat-label" data-tooltip={info}>
          <span className="truncate">{label}</span>
        </span>
        {/* status as a small icon, not a dot (owner, 2026-11-24): ✓ good · ⚠ attention · ! problem · i no good/bad meaning */}
        <span className={cx('dv-stat-status', `is-${note?.tone ?? 'neutral'}`)} data-tooltip={dotTip} role="img" aria-label={dotTip}>
          {(() => {
            const S = note?.tone === 'success' ? CheckCircle2 : note?.tone === 'warning' ? AlertTriangle : note?.tone === 'danger' ? AlertCircle : Info;
            return <S size={15} strokeWidth={2} aria-hidden />;
          })()}
        </span>
      </div>
      <div className="dv-stat-main">
        <span className="dv-stat-value" data-testid={testId}>
          {value}
          {unit ? <span className="dv-stat-unit">{unit}</span> : null}
        </span>
        <span className="spacer" />
        {delta !== undefined ? <DeltaBadge delta={delta} riseIsGood={riseIsGood} /> : null}
      </div>
      {/* No third line (owner, 2026-11-24): the note lives in the status dot's hover text */}
    </>
  );
  return to ? (
    <Link to={to} className="dv-stat is-link">
      {body}
    </Link>
  ) : (
    <div className="dv-stat">{body}</div>
  );
}

/** Change in % between two periods; null when there is nothing to compare with (never a fake +100%) */
export const deltaPct = (now: number, before: number): number | null => {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
};
