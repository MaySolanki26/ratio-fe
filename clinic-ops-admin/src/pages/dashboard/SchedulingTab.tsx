import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CalendarX, Clock3, MonitorSmartphone, UserX } from 'lucide-react';
import { addDays, formatWeekday } from '../../lib/dates';
import { resourcePath, wsBase } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { getDb } from '../../services/db';
import { activeMasterValues } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { CardEmpty, ColumnChart, DashCard, DonutChart, Heatmap, ProgressRows, SplitBars, StatCard, StatGrid, ViewAllToggle, WaffleChart } from '../../components/dashboard';
import { ACTIVE, UPCOMING, countIn, type DashData } from './model';

/** Clinic opening day used for room utilisation (10 bookable hours) */
const DAY_MIN = 10 * 60;

/** Scheduling: no-shows, cancellations, visit mix, clinician load, busy times, room usage, the week ahead. */
export function SchedulingTab({ d, actor }: { d: DashData; actor: Actor }) {
  const navigate = useNavigate();
  const ws = actor.workspaceId;
  const { cur, today } = d;
  const [cliniciansOpen, setCliniciansOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);

  const noShow = countIn(cur, ['no_show']);
  const cancelled = countIn(cur, ['cancelled']);
  const tele = cur.filter((a) => a.visitMode === 'telehealth').length;
  const teleShare = cur.length ? Math.round((tele / cur.length) * 100) : 0;
  const avgLen = cur.length ? Math.round(cur.reduce((s, a) => s + (Number(a.durationMin) || 0), 0) / cur.length) : 0;
  const next7 = d.appts.filter((a) => String(a.start).slice(0, 10) >= today && String(a.start).slice(0, 10) <= addDays(today, 6) && UPCOMING.includes(String(a.status)));

  const types = activeMasterValues('appointmentType');
  const typeSlices = types.map((t) => ({ key: t.key, label: t.label, value: cur.filter((a) => a.appointmentType === t.key).length }));
  const channels = activeMasterValues('bookingChannel');
  const channelSlices = channels.map((c) => ({ key: c.key, label: c.label, value: cur.filter((a) => a.bookingChannel === c.key).length }));

  // Clinician load: visits completed in the period vs visits booked for the next 7 days, per clinician
  const byClinician = new Map<string, { done: number; ahead: number }>();
  const bump = (id: unknown, part: 'done' | 'ahead') => {
    if (!id) return;
    const row = byClinician.get(String(id)) ?? { done: 0, ahead: 0 };
    row[part] += 1;
    byClinician.set(String(id), row);
  };
  cur.filter((a) => a.status === 'completed').forEach((a) => bump(a.clinicianId, 'done'));
  next7.forEach((a) => bump(a.clinicianId, 'ahead'));
  const clinicianBars = [...byClinician.entries()].map(([id, r]) => ({ key: id, label: recordTitle('staff', id, actor), first: r.done, second: r.ahead }));

  // Busy times: visits by weekday × start hour (heatmap answers "which day and hour is busiest?")
  const HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const HEAT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const heat = HEAT_DAYS.map(() => HEAT_HOURS.map(() => 0));
  cur.forEach((a) => {
    if (!ACTIVE.includes(String(a.status))) return;
    const start = String(a.start);
    const dow = new Date(`${start.slice(0, 10)}T00:00:00`).getDay(); // 0 Sun … 6 Sat
    const h = Number(start.slice(11, 13));
    const ci = HEAT_HOURS.indexOf(h);
    if (dow >= 1 && dow <= 6 && ci >= 0) heat[dow - 1][ci] += 1;
  });
  const peak = heat.flatMap((r, ri) => r.map((v, ci) => ({ v, ri, ci }))).sort((a, b) => b.v - a.v)[0];
  const hourLabel = (h: number) => (h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`);

  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((day) => ({ key: day, label: i0(formatWeekday(day)), value: next7.filter((a) => String(a.start).startsWith(day)).length }));

  const rooms = d.can.rooms ? getDb().records.rooms.filter((r) => r.workspaceId === ws && r.roomType !== 'telehealth') : [];
  const roomRows = rooms.map((r) => {
    const minutes = getDb()
      .records.appointments.filter((a) => a.workspaceId === ws && a.roomId === r.id && String(a.start).startsWith(today) && ACTIVE.includes(String(a.status)))
      .reduce((s, a) => s + Number(a.durationMin), 0);
    return { key: r.id, label: String(r.name), value: Math.round((minutes / 60) * 10) / 10, total: DAY_MIN / 60, off: r.status !== 'available' ? String(r.status).replace(/_/g, ' ') : undefined };
  });

  // one line that answers the card's question, like By Status: the total and the most booked type
  const topType = [...typeSlices].sort((a, b) => b.value - a.value)[0];
  const typeSummary = cur.length && topType ? `${cur.length} visits · most booked: ${topType.label} (${Math.round((topType.value / cur.length) * 100)}%)` : undefined;

  return (
    <>
      <StatGrid>
        <StatCard label="No-shows" icon={UserX} info="Visits where the patient did not come, in the period." value={String(noShow)} unit={cur.length ? `${Math.round((noShow / cur.length) * 100)}% of booked` : undefined} note={noShow ? { text: 'Follow up to rebook', tone: 'danger' } : { text: 'None this period', tone: 'success' }} to={resourcePath(ws, 'appointments', { view: 'v_appts_all' })} />
        <StatCard label="Cancelled" icon={CalendarX} value={String(cancelled)} unit={cur.length ? `${Math.round((cancelled / cur.length) * 100)}% of booked` : undefined} note={{ text: 'Slots freed in this period' }} />
        <StatCard label="Telehealth" icon={MonitorSmartphone} info="Share of visits held by video." value={String(teleShare)} unit="%" note={{ text: `${tele} of ${cur.length} visits` }} />
        <StatCard label="Avg Visit Length" icon={Clock3} value={String(avgLen)} unit="min" note={{ text: 'Booked duration' }} />
        <StatCard label="Next 7 Days" icon={CalendarClock} info="Appointments booked from today for the coming week." value={String(next7.length)} unit="booked" note={{ text: `${next7.filter((a) => a.status === 'scheduled').length} not confirmed yet`, tone: next7.some((a) => a.status === 'scheduled') ? 'warning' : 'success' }} to={resourcePath(ws, 'appointments', { view: 'v_appts_upcoming' })} />
      </StatGrid>

      <div className="dv-row is-halves">
        <DashCard title="Visit Types" meta="By visits booked">
          {cur.length ? <DonutChart ariaLabel="Visits by type" legendTitle="Type" totalLabel="visits" slices={typeSlices} summary={typeSummary} /> : <CardEmpty>No visits booked in this period</CardEmpty>}
        </DashCard>
        <DashCard className="is-centered" title="Busy Times" meta={peak?.v ? `By weekday and start hour · busiest ${HEAT_DAYS[peak.ri]} ${hourLabel(HEAT_HOURS[peak.ci])}` : 'By weekday and start hour'}>
          {cur.length ? (
            <Heatmap
              ariaLabel="Visits by weekday and start hour"
              rows={HEAT_DAYS}
              cols={HEAT_HOURS.map(hourLabel)}
              values={heat}
              unit="visits"
              tooltip={(r, c, v) => `${r} ${c}: ${v} ${v === 1 ? 'visit' : 'visits'} starting`}
            />
          ) : (
            <CardEmpty>No visits booked in this period</CardEmpty>
          )}
        </DashCard>
      </div>

      <div className="dv-row is-halves">
        <DashCard title="Clinician Load" meta="Completed vs booked next 7 days" action={<ViewAllToggle expanded={cliniciansOpen} total={clinicianBars.length} limit={6} onToggle={() => setCliniciansOpen((o) => !o)} />}>
          {clinicianBars.length ? <SplitBars bars={clinicianBars} firstLabel="Completed in period" secondLabel="Booked next 7 days" limit={6} expanded={cliniciansOpen} /> : <CardEmpty>No visits booked in this period</CardEmpty>}
        </DashCard>
        <DashCard title="The Week Ahead" meta="Booked, next 7 days">
          <ColumnChart ariaLabel="Appointments booked for the next 7 days" bars={week} tooltip={(b) => `${b.value} booked · ${b.label}`} onSelect={(day) => navigate(`${wsBase(ws)}/scheduling/schedule?date=${day}`)} />
        </DashCard>
      </div>

      <div className="dv-row is-halves">
        {roomRows.length > 0 && (
          <DashCard title="Room Usage" meta="Booked hours today" action={<ViewAllToggle expanded={roomsOpen} total={roomRows.length} limit={5} onToggle={() => setRoomsOpen((o) => !o)} />}>
            <ProgressRows rows={roomRows} unit="h" doneLabel="Booked" restLabel="Free" limit={5} expanded={roomsOpen} />
          </DashCard>
        )}
        <DashCard title="Booked Via" meta={`How ${cur.length} visits were booked`}>
          {cur.length ? <WaffleChart compact ariaLabel="Visits by booking channel" totalLabel="Total visits" slices={channelSlices} /> : <CardEmpty>No visits booked in this period</CardEmpty>}
        </DashCard>
      </div>
    </>
  );
}

/** "Fri, 16 Oct" → "Fri 16" */
const i0 = (s: string) => {
  const [wd, rest] = s.split(', ');
  return `${wd} ${rest?.split(' ')[0] ?? ''}`.trim();
};
