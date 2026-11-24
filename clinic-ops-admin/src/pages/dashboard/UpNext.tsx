import { Link } from 'react-router-dom';
import { ChevronRight, MonitorSmartphone } from 'lucide-react';
import { addDays, addMinutes, formatTime, formatWeekday, toLocalDateTime } from '../../lib/dates';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import type { RecordData } from '../../metadata/types';
import type { Actor } from '../../services/authz';
import { getResource, masterValue } from '../../services/registry';
import { availableTransitions, recordTitle, transitionRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { useToast } from '../../components/primitives/feedback';
import { CardEmpty, DashCard, ViewAllLink } from '../../components/dashboard';
import { UPCOMING, type DashData } from './model';

const MAX_ROWS = 5; // top 5 only, then View all (owner, 2026-11-24)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "in 25 min" / "in 2 h 10 min" / "now" for a start time today */
const startsIn = (start: string, now: string) => {
  const mins = Math.round((Date.parse(start) - Date.parse(now)) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
};

/**
 * Up Next (rule 74): the next appointments grouped by day (Today · Tomorrow · weekday), each row on one grid —
 * time (+ "in 25 min" for today) · patient with avatar and visit type · clinician and room · status chip · next step
 * (today only) or ›. Rows open the appointment.
 */
export function UpNextCard({ d, actor }: { d: DashData; actor: Actor }) {
  const toast = useToast();
  const ws = actor.workspaceId;
  const now = toLocalDateTime(new Date());
  const tomorrow = addDays(d.today, 1);
  const all = d.appts.filter((a) => UPCOMING.includes(String(a.status)) && addMinutes(String(a.start), Number(a.durationMin)) >= now);
  const rows = all.slice(0, MAX_ROWS);
  const dayTitle = (day: string) => (day === d.today ? 'Today' : day === tomorrow ? 'Tomorrow' : formatWeekday(day));
  const res = getResource('appointments');

  return (
    <DashCard title="Up Next" meta={all.length ? `${plural(all.length, 'appointment')} coming up${all.length > MAX_ROWS ? ` · next ${MAX_ROWS} shown` : ''}` : undefined} action={<ViewAllLink to={resourcePath(ws, 'appointments', { view: 'v_appts_upcoming' })} />}>
      {rows.length ? (
        <div className="dv-tickets" role="list" aria-label="Upcoming appointments">
          {rows.map((a) => {
            const day = String(a.start).slice(0, 10);
            return <UpNextTicket key={a.id} a={a} dayLabel={day === d.today ? '' : dayTitle(day)} isToday={day === d.today} now={now} actor={actor} ws={ws} res={res} onDone={(msg, ok) => toast(msg, ok ? 'success' : 'danger')} />;
          })}
        </div>
      ) : (
        <CardEmpty>No upcoming appointments — new bookings show up here.</CardEmpty>
      )}
    </DashCard>
  );
}

const TONE_FG: Record<string, string> = {
  success: 'var(--chip-success-fg)',
  warning: 'var(--chip-warning-fg)',
  danger: 'var(--chip-danger-fg)',
  info: 'var(--chip-info-fg)',
  accent: 'var(--c-link)',
  neutral: 'var(--s-text-muted)',
};

/**
 * One appointment as a small ticket (owner, 2026-11-24 redesign — "who's next and what do I do?"): time and
 * "in 24 min" on top, the patient in bold with the visit type, clinician · room, then status (dot + text) and the
 * next step ("Check in ›") at the bottom. Tickets sit in a grid (≈4 per row), so the card stays short.
 * The ticket opens the appointment in a new tab.
 */
function UpNextTicket({ a, dayLabel, isToday, now, actor, ws, res, onDone }: { a: RecordData; dayLabel: string; isToday: boolean; now: string; actor: Actor; ws: string; res: ReturnType<typeof getResource>; onDone: (msg: string, ok: boolean) => void }) {
  const mv = masterValue('appointmentStatus', a.status);
  const next = isToday ? availableTransitions(actor, res, a).find((t) => !t.disabledReason && !t.confirm) : undefined;
  const name = recordTitle('patients', a.patientId, actor);
  const tele = a.visitMode === 'telehealth' || !a.roomId;
  const tone = TONE_FG[mv?.tone ?? 'neutral'] ?? TONE_FG.neutral;
  return (
    <div className="dv-ticket" role="listitem">
      <Link to={recordPeekPath(ws, 'appointments', a.id)} className="dv-ticket-link" target="_blank" rel="noopener noreferrer" aria-label={`${name}, ${formatTime(String(a.start))} — opens in a new tab`}>
        <span className="dv-ticket-time">
          <strong>{formatTime(String(a.start))}</strong>
          <small>{dayLabel || (isToday ? startsIn(String(a.start), now) : '')}</small>
        </span>
        <span className="dv-ticket-name truncate">{name}</span>
        <span className="dv-ticket-type truncate">{masterValue('appointmentType', a.appointmentType)?.label ?? 'Visit'}</span>
        <span className="dv-ticket-where">
          <span className="truncate">{recordTitle('staff', a.clinicianId, actor)}</span>
          <span aria-hidden>·</span>
          {tele ? <MonitorSmartphone size={12} strokeWidth={1.7} aria-hidden /> : null}
          <span className="truncate">{tele ? 'Telehealth' : recordTitle('rooms', a.roomId, actor)}</span>
        </span>
      </Link>
      <span className="dv-ticket-foot">
        <span className="dv-ticket-status" style={{ color: tone }}>
          <span className="dv-dot" style={{ background: tone }} aria-hidden />
          {mv?.label}
        </span>
        {next ? (
          <button
            type="button"
            className="dv-link"
            onClick={() => {
              try {
                transitionRecord(actor, 'appointments', a.id, next.to, a.version);
                onDone(`${a.id}: ${next.action}`, true);
              } catch (e) {
                onDone(e instanceof ServiceError ? e.message : 'Failed', false);
              }
            }}
          >
            {next.action}
            <ChevronRight size={13} strokeWidth={1.7} aria-hidden />
          </button>
        ) : null}
      </span>
    </div>
  );
}
