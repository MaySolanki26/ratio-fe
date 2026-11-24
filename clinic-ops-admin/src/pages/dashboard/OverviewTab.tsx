import { useNavigate } from 'react-router-dom';
import { CalendarCheck, ClipboardList, Hourglass, ListChecks, Receipt, Send, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { addDays, formatDate, formatTime } from '../../lib/dates';
import { formatMoney, formatMoneyWhole } from '../../lib/format';
import { pagePath, recordPeekPath, resourcePath, wsBase } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { queryRecords, recordTitle } from '../../services/runtime';
import { listApprovals } from '../../services/workflow';
import { DashCard, StatGrid, DonutChart, FunnelDiagram, StatCard, ActionTable, TrendChart, TrendLegend, ViewAllLink, type ActionKind, type ActionRow, type DashTone, type FunnelStep, type TrendSeries } from '../../components/dashboard';
import { ACTIVE, countIn, daysBetween, inRange, sum, type DashData } from './model';

const TREND: TrendSeries[] = [
  { key: 'booked', label: 'Booked' },
  { key: 'completed', label: 'Completed' },
];

/** Overview: headline KPIs, visit funnel + status mix, booked-vs-completed running total + needs attention, up next. */
export function OverviewTab({ d, actor }: { d: DashData; actor: Actor }) {
  const navigate = useNavigate();
  const ws = actor.workspaceId;
  const { cur, today } = d;

  // ── KPIs
  const curActive = countIn(cur, ACTIVE);
  const completed = countIn(cur, ['completed']);
  const noShow = countIn(cur, ['no_show']);
  const cancelled = countIn(cur, ['cancelled']);
  const closed = completed + noShow + cancelled;
  const attendance = closed ? Math.round((completed / closed) * 100) : 0;
  const waiting = d.appts.filter((a) => String(a.start).startsWith(today) && a.status === 'checked_in');
  const billedNow = sum(d.invoices.filter((i) => inRange(i, 'issueDate', d.from, d.to)), 'total');
  const openInv = d.invoices.filter((i) => ['issued', 'partially_paid'].includes(String(i.status)));
  const overdue = openInv.filter((i) => String(i.dueDate) < today);
  const myTasks = queryRecords(actor, 'tasks', { where: { assigneeId: actor.staffId } }).rows.filter((t) => t.status !== 'done');
  const myOverdue = myTasks.filter((t) => String(t.dueDate) < today);
  const newPatients = d.patients.filter((p) => inRange(p, 'registeredOn', d.from, d.to)).length;

  // ── Funnel: booked → confirmed → checked in → completed, with why some stopped
  const reached = (states: string[]) => countIn(cur, states);
  const confirmed = reached(['confirmed', 'checked_in', 'in_progress', 'completed']);
  const arrived = reached(['checked_in', 'in_progress', 'completed']);
  const stillScheduled = reached(['scheduled']);
  const funnel: FunnelStep[] = [
    { key: 'booked', label: 'Booked', value: cur.length, note: cancelled ? `${cancelled} cancelled` : undefined, noteDetail: stillScheduled ? `${stillScheduled} not confirmed yet` : undefined },
    { key: 'confirmed', label: 'Confirmed', value: confirmed, note: noShow ? `${noShow} no-shows` : undefined },
    { key: 'arrived', label: 'Checked in', value: arrived, note: arrived - completed ? `${arrived - completed} in clinic now` : undefined },
    { key: 'completed', label: 'Completed', value: completed },
  ];

  // ── Daily trend: visits booked vs completed per day (week for a quarter)
  const own = d.buckets.map((b) => {
    const rows = d.appts.filter((a) => inRange(a, 'start', b.start, b.end));
    return { booked: rows.length, completed: countIn(rows, ['completed']), missed: countIn(rows, ['cancelled', 'no_show']) };
  });
  const trend = d.buckets.map((b, i) => ({ key: b.key, label: b.label, booked: own[i].booked, completed: own[i].completed }));

  // ── Needs attention: overdue invoices, approvals, referrals due, my overdue tasks (oldest first)
  const approvals = listApprovals(actor).filter((a) => a.status === 'pending');
  const refsDue = d.referrals.filter((r) => ['received', 'in_review'].includes(String(r.status)) && String(r.dueBy) <= addDays(today, 3));
  const age = (since: string) => Math.max(0, daysBetween(since, today));

  const attentionGroups = [
    { key: 'invoices', label: 'Overdue invoices', count: overdue.length, to: resourcePath(ws, 'invoices', { view: 'v_inv_overdue' }) },
    { key: 'referrals', label: 'Referrals due', count: refsDue.length, to: resourcePath(ws, 'referrals', { view: 'v_ref_open' }) },
    { key: 'approvals', label: 'Approvals', count: approvals.length, to: `${pagePath(ws, 'work', 'inbox')}?tab=approvals` },
    { key: 'tasks', label: 'My late tasks', count: myOverdue.length, to: resourcePath(ws, 'tasks', { view: 'v_tasks_open' }) },
  ];
  const attentionTotal = overdue.length + approvals.length + refsDue.length + myOverdue.length;
  // Needs attention as a small action table: a fair mix of every kind (invoices ≤3, referrals ≤2, approval ≤1,
  // late task ≤1), most serious first (red before amber, then the longest late)
  const late = (n: number) => (n <= 0 ? 'Due today' : `${n} ${n === 1 ? 'day' : 'days'} late`);
  type Ranked = { days: number; row: ActionRow };
  const invRows: Ranked[] = [...overdue]
    .map((i) => {
      const n = age(String(i.dueDate));
      return { days: n, row: { id: i.id, icon: Receipt, item: recordTitle('patients', i.patientId, actor), what: 'Overdue invoice', when: late(n), tone: (n > 60 ? 'danger' : 'warning') as DashTone, amount: formatMoney(Number(i.balance)), action: 'Chase', to: recordPeekPath(ws, 'invoices', i.id) } };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);
  const refRows: Ranked[] = refsDue
    .map((r) => {
      const n = daysBetween(String(r.dueBy), today);
      return { days: n, row: { id: r.id, icon: Send, item: recordTitle('patients', r.patientId, actor), what: 'Referral to book', when: n > 0 ? late(n) : n === 0 ? 'Due today' : `Due in ${-n} ${-n === 1 ? 'day' : 'days'}`, tone: (n >= 0 ? 'danger' : 'warning') as DashTone, amount: undefined, action: 'Book', to: recordPeekPath(ws, 'referrals', r.id) } };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);
  const apprRows: Ranked[] = approvals.slice(0, 6).map((a) => ({ days: 0, row: { id: a.id, icon: ShieldCheck, item: `Write-off ${a.recordId}`, what: 'Needs your approval', when: 'Waiting', tone: 'warning' as DashTone, amount: formatMoney(a.amount), action: 'Review', to: `${pagePath(ws, 'work', 'inbox')}?tab=approvals` } }));
  const taskRows: Ranked[] = [...myOverdue]
    .map((t) => ({ days: age(String(t.dueDate)), row: { id: t.id, icon: ListChecks, item: String(t.title), what: 'Your task', when: late(age(String(t.dueDate))), tone: 'warning' as DashTone, amount: undefined, action: 'Open', to: recordPeekPath(ws, 'tasks', t.id) } }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);
  const actionKinds: ActionKind[] = [
    { key: 'invoices', label: 'Invoices', count: overdue.length, rows: invRows.map((x) => x.row) },
    { key: 'referrals', label: 'Referrals', count: refsDue.length, rows: refRows.map((x) => x.row) },
    { key: 'approvals', label: 'Approvals', count: approvals.length, rows: apprRows.map((x) => x.row) },
    { key: 'tasks', label: 'Tasks', count: myOverdue.length, rows: taskRows.map((x) => x.row) },
  ];
  // "All": a fair mix — up to 3 invoices, 2 referrals, 1 approval, 1 task — most serious first
  const actionRows: ActionRow[] = [...invRows.slice(0, 3), ...refRows.slice(0, 2), ...apprRows.slice(0, 1), ...taskRows.slice(0, 1)]
    .sort((a, b) => (a.row.tone === b.row.tone ? b.days - a.days : a.row.tone === 'danger' ? -1 : 1))
    .slice(0, 6)
    .map((x) => x.row);


  return (
    <>
      <StatGrid>
        {d.can.appts && (
          <StatCard label="Appointments" icon={CalendarCheck} info={`Booked, confirmed, in progress and completed visits · ${d.period.toLowerCase()}.`} value={String(curActive)} unit={`/ ${cur.length} booked`} to={resourcePath(ws, 'appointments', { view: 'v_appts_all' })} testId="kpi-appointments" />
        )}
        {d.can.appts && (
          <StatCard label="Attendance" icon={Stethoscope} info="Completed ÷ (completed + no-show + cancelled) in the period." value={closed ? String(attendance) : '—'} unit={closed ? '%' : undefined} note={!closed ? { text: 'No finished visits yet' } : noShow ? { text: `${noShow} no-shows`, tone: 'danger' } : { text: 'No no-shows', tone: 'success' }} testId="kpi-attendance" />
        )}
        {d.can.appts && (
          <StatCard label="Waiting Now" icon={Hourglass} info="Patients checked in today and not yet seen." value={String(waiting.length)} unit="patients" note={waiting.length ? { text: `Longest since ${formatTime(String(waiting[0].start))}`, tone: 'warning' } : { text: 'No one waiting', tone: 'success' }} to={resourcePath(ws, 'appointments', { view: 'v_appts_board' })} testId="kpi-waiting" />
        )}
        {d.can.patients && (
          <StatCard label="New Patients" icon={Users} info={`Patients registered · ${d.period.toLowerCase()}.`} value={String(newPatients)} note={{ text: `${d.patients.length} on the registry` }} to={resourcePath(ws, 'patients', { view: 'v_patients_new' })} testId="kpi-new-patients" />
        )}
        {d.financeVisible && (
          <StatCard label="Billed" icon={Receipt} info={`Invoice totals issued · ${d.period.toLowerCase()}.`} value={formatMoneyWhole(billedNow)} note={overdue.length ? { text: `${overdue.length} overdue`, tone: 'danger' } : { text: 'Nothing overdue', tone: 'success' }} to={resourcePath(ws, 'invoices', { view: 'v_inv_overdue' })} testId="kpi-billed" />
        )}
        <StatCard label="My Open Tasks" icon={ClipboardList} info="Tasks assigned to you that are not done." value={String(myTasks.length)} unit="tasks" note={myOverdue.length ? { text: `${myOverdue.length} overdue`, tone: 'danger' } : { text: 'All on track', tone: 'success' }} to={resourcePath(ws, 'tasks', { view: 'v_tasks_open' })} testId="kpi-tasks" />
      </StatGrid>

      {d.can.appts && (
        <div className="dv-row is-wide-right">
          {/* By Status first (owner, 2026-11-24), the funnel keeps its wide slot on the right */}
          <DashCard title="By Status" meta="In this period">
            <DonutChart
              summary={cur.length ? `${Math.round((completed / cur.length) * 100)}% completed · ${Math.round(((cancelled + noShow) / cur.length) * 100)}% cancelled or no-show` : undefined}
              ariaLabel="Visits by status"
              legendTitle="Status"
              totalLabel="visits"
              slices={[
                { key: 'booked', label: 'Booked, Not Seen Yet', value: countIn(cur, ['scheduled', 'confirmed']) },
                { key: 'in-clinic', label: 'In Clinic', value: countIn(cur, ['checked_in', 'in_progress']) },
                { key: 'completed', label: 'Completed', value: completed },
                { key: 'missed', label: 'Cancelled or No-show', value: cancelled + noShow },
              ]}
              onSliceClick={() => navigate(resourcePath(ws, 'appointments', { view: 'v_appts_all' }))}
            />
          </DashCard>
          <DashCard className="is-centered" title="Visit Funnel" meta={`Booked ${d.period.toLowerCase()}`}>
            <FunnelDiagram steps={funnel} ariaLabel="Visit funnel" emptyText="No visits booked in this period" />
          </DashCard>
        </div>
      )}

      <div className={d.can.appts ? 'dv-row is-wide-left' : 'dv-row'}>
        {d.can.appts && (
          <DashCard className="is-centered" title="Booked vs Completed" meta={d.bucketDays === 1 ? 'Per day' : d.bucketDays === 7 ? 'Per week' : 'Per month'} action={<TrendLegend series={TREND} />}>
            <TrendChart
              ariaLabel="Visits booked and completed per day"
              data={trend}
              series={TREND}
              average
              onSelect={(day) => navigate(`${wsBase(ws)}/scheduling/schedule?date=${day}`)}
              renderTooltip={(i) => (
                <>
                  <strong>{d.bucketDays === 1 ? formatDate(trend[i].key) : `${d.bucketDays === 7 ? 'Week' : 'Month'} to ${formatDate(trend[i].key)}`}</strong>
                  <span className="dv-tip-row">
                    <span className="dv-dot" style={{ background: 'var(--c-mark-1)' }} aria-hidden />
                    Booked: <strong>{own[i].booked}</strong>
                  </span>
                  <span className="dv-tip-row">
                    <span className="dv-dot" style={{ background: 'var(--c-trend-2)' }} aria-hidden />
                    Completed: <strong>{own[i].completed}</strong>
                  </span>
                  {own[i].missed > 0 && (
                    <span className="dv-tip-row">
                      <span className="dv-dot" style={{ background: 'var(--c-dot-danger)' }} aria-hidden />
                      Cancelled or no-show: <strong>{own[i].missed}</strong>
                    </span>
                  )}
                </>
              )}
            />
          </DashCard>
        )}
        {/* Needs attention sits beside the trend: a small Item · Amount · Action table with a kind filter */}
        <DashCard className="is-attention" title="Needs Attention" meta={attentionTotal ? `${attentionTotal} items · most urgent first` : undefined} action={attentionTotal ? <ViewAllLink to={attentionGroups[0].to} /> : undefined}>
          <ActionTable kinds={actionKinds} mixed={actionRows} emptyText="You're all caught up — nothing overdue or waiting on you" limit={5} />
        </DashCard>
      </div>

      {/* Up Next is hidden on the dashboard (owner, 2026-11-24); UpNextCard stays available in ./UpNext */}
    </>
  );
}

