import { useState } from 'react';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { Button, IconButton } from './Button';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const monthEnd = (key: string) => addDays(`${shiftMonth(key.slice(0, 7), 1)}-01`, -1);
/** "3 Nov" in the current year, "3 Nov, 2025" otherwise */
const short = (k: string, today: string) => (k.slice(0, 4) === today.slice(0, 4) ? formatDate(k).replace(/,? \d{4}$/, '') : formatDate(k));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);

/** Quick ranges shown beside the calendar */
const presets = (today: string): { label: string; from: string; to: string }[] => {
  const lastMonth = shiftMonth(today.slice(0, 7), -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'This month', from: monthStart(today), to: today },
    { label: 'Last month', from: `${lastMonth}-01`, to: monthEnd(`${lastMonth}-01`) },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
};

/**
 * Date RANGE picker (owner, 2026-11-24): quick ranges on the left, one month calendar on the right — click the first
 * day, then the last; the days between are tinted, and hovering previews the range. Footer: the range + day count,
 * Cancel · Apply. Same look as the project's DatePicker (dp-* styles); Monday-first weeks.
 */
export function DateRangeCalendar({ from, to, onApply, onCancel }: { from?: string; to?: string; onApply: (from: string, to: string) => void; onCancel: () => void }) {
  const today = todayKey();
  const [a, setA] = useState<string | null>(from ?? null);
  const [b, setB] = useState<string | null>(to ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState((to ?? from ?? today).slice(0, 7));

  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00`).getDay() + 6) % 7;
  const gridStart = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // the range on screen: the chosen one, or a preview while picking the last day
  const end = b ?? (a && hover ? hover : null);
  const lo = a && end ? (a < end ? a : end) : a;
  const hi = a && end ? (a < end ? end : a) : a;

  const pick = (d: string) => {
    if (!a || b) {
      setA(d);
      setB(null);
    } else if (d < a) {
      setB(a);
      setA(d);
    } else setB(d);
  };
  const ready = !!a && !!b;
  const presetList = presets(today);

  return (
    <div className="drp">
      <ul className="drp-presets" aria-label="Quick ranges">
        {presetList.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              className={cx('drp-preset', a === p.from && b === p.to && 'is-on')}
              onClick={() => {
                setA(p.from);
                setB(p.to);
                setMonth(p.to.slice(0, 7));
              }}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="drp-cal">
        <div className="dp-head">
          <IconButton icon="chevron-left" label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
          <strong aria-live="polite">
            {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
          </strong>
          <IconButton icon="chevron-right" label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
        </div>
        <div className="dp-weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="dp-days drp-days" role="grid" aria-label={`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`} onMouseLeave={() => setHover(null)}>
          {days.map((d) => {
            const inRange = !!lo && !!hi && d > lo && d < hi;
            const isStart = d === lo;
            const isEnd = d === hi && !!hi;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-label={formatDate(d)}
                aria-selected={isStart || isEnd || inRange}
                aria-current={d === today ? 'date' : undefined}
                className={cx('dp-day', d.slice(0, 7) !== month && 'is-outside', d === today && 'is-today', inRange && 'is-in-range', isStart && 'is-range-start', isEnd && 'is-range-end', (isStart || isEnd) && 'is-selected')}
                onClick={() => pick(d)}
                onMouseEnter={() => setHover(d)}
              >
                {Number(d.slice(8, 10))}
              </button>
            );
          })}
        </div>
        <div className="drp-foot">
          <span className="drp-sum">
            {a ? (
              <>
                <strong>
                  {short(lo!, today)}
                  {hi && hi !== lo ? ` – ${short(hi, today)}` : ''}
                </strong>
                {ready ? <span className="muted"> · {daysBetween(lo!, hi!) + 1} days</span> : <span className="muted"> · pick the last day</span>}
              </>
            ) : (
              <span className="muted">Pick the first day</span>
            )}
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => ready && onApply(lo!, hi!)}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
